import { createHash, randomBytes, randomUUID } from "node:crypto";
import { codecs } from "@danielsharp/redis";
import { eq, gt, lt, sql } from "drizzle-orm";
import { env } from "../config/env";
import { aiConnectionTable, aiUsageTable } from "../db/schema";
import { db, type Executor } from "../providers/db";
import { logger } from "../providers/logger";
import { redis } from "../providers/redis";
import * as chatgpt from "./chatgpt";
import { secretBox } from "./secret-box";

const CONNECTION_ID = "chatgpt";
const PENDING_TTL_MS = 10 * 60 * 1000;
/** A safe guess for Hungarian; only used to cap a stream and to estimate a cut-off call. */
const CHARS_PER_TOKEN = 3;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type AiUnavailableReason = "not_configured" | "not_connected" | "reconnect" | "no_model" | "plan_limit";

export class AiUnavailable extends Error {
  constructor(readonly reason: AiUnavailableReason) {
    super(`AI is unavailable: ${reason}`);
    this.name = "AiUnavailable";
  }
}

export class AiLimitReached extends Error {
  constructor(readonly window: "hour" | "day") {
    super(`The ${window}ly AI token limit is reached`);
    this.name = "AiLimitReached";
  }
}

type SealedTokens = Pick<chatgpt.Tokens, "accessToken" | "refreshToken" | "idToken">;

function box() {
  if (!env.AI_TOKEN_KEY) throw new AiUnavailable("not_configured");
  return secretBox(env.AI_TOKEN_KEY);
}

/** The single connection row, created on first use with this deployment's host id. */
async function connectionRow(ex: Executor = db) {
  const [existing] = await ex.select().from(aiConnectionTable).where(eq(aiConnectionTable.id, CONNECTION_ID));
  if (existing) return existing;
  await ex.insert(aiConnectionTable).values({ id: CONNECTION_ID, hostId: `urn:uuid:${randomUUID()}` }).onConflictDoNothing();
  const [created] = await ex.select().from(aiConnectionTable).where(eq(aiConnectionTable.id, CONNECTION_ID));
  return created!;
}

function tokenColumns(tokens: chatgpt.Tokens) {
  const sealed: SealedTokens = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, idToken: tokens.idToken };
  return {
    sealedTokens: box().seal(sealed),
    expiresAt: tokens.expiresAt,
    earliestRefreshAt: tokens.earliestRefreshAt ?? null,
    updatedAt: new Date(),
  };
}

const pendingKey = (state: string) => `ai:pending:${state}`;

/** Starts a sign-in: the PKCE verifier waits in Redis for the pasted callback, keyed by its state. */
export async function startConnecting() {
  box();
  const row = await connectionRow();
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  await redis.set(pendingKey(state), { codeVerifier }, codecs.json(), { expiration: { type: "PX", value: PENDING_TTL_MS } });
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return chatgpt.authorizeUrl({ clientId: row.clientId ?? undefined, hostId: row.hostId, state, nonce, codeChallenge });
}

export class CallbackRejected extends Error {
  constructor(readonly reason: "malformed" | "expired" | "denied") {
    super(`The ChatGPT callback was rejected: ${reason}`);
    this.name = "CallbackRejected";
  }
}

/** Finishes a sign-in from the address the browser landed on after consent. */
export async function finishConnecting(callbackUrl: string) {
  let params: URLSearchParams;
  try {
    params = new URL(callbackUrl).searchParams;
  } catch {
    throw new CallbackRejected("malformed");
  }
  if (params.get("error")) throw new CallbackRejected("denied");
  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code) throw new CallbackRejected("malformed");
  const pending = await redis.get(pendingKey(state), codecs.json<{ codeVerifier: string }>());
  if (!pending) throw new CallbackRejected("expired");
  await redis.del(pendingKey(state));

  const row = await connectionRow();
  const clientId = params.get("client_id") ?? row.clientId;
  if (!clientId) throw new CallbackRejected("malformed");
  const tokens = await chatgpt.exchangeCode({ clientId, code, codeVerifier: pending.codeVerifier });
  await db
    .update(aiConnectionTable)
    .set({ clientId, ...tokenColumns(tokens), accountEmail: chatgpt.emailOf(tokens.idToken) ?? null, broken: false })
    .where(eq(aiConnectionTable.id, CONNECTION_ID));
}

export async function disconnect() {
  await db
    .update(aiConnectionTable)
    .set({ sealedTokens: null, expiresAt: null, earliestRefreshAt: null, accountEmail: null, broken: false, updatedAt: new Date() })
    .where(eq(aiConnectionTable.id, CONNECTION_ID));
}

/**
 * A usable access token, refreshed inside OpenAI's refresh window. The row lock makes concurrent
 * callers wait for one refresh instead of each spending the rotating refresh token.
 */
export async function accessToken(): Promise<string> {
  const token = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(aiConnectionTable).where(eq(aiConnectionTable.id, CONNECTION_ID)).for("update");
    if (!row?.sealedTokens || !row.clientId) throw new AiUnavailable("not_connected");
    if (row.broken) throw new AiUnavailable("reconnect");
    const tokens = box().open<SealedTokens>(row.sealedTokens);
    const now = Date.now();
    const expiresAt = row.expiresAt?.getTime() ?? 0;
    const refreshFrom = row.earliestRefreshAt?.getTime() ?? expiresAt - 5 * 60 * 1000;
    if (now < refreshFrom) return tokens.accessToken;

    try {
      const fresh = await chatgpt.refreshTokens({ clientId: row.clientId, refreshToken: tokens.refreshToken });
      await tx
        .update(aiConnectionTable)
        .set(tokenColumns({ ...fresh, idToken: fresh.idToken ?? tokens.idToken }))
        .where(eq(aiConnectionTable.id, CONNECTION_ID));
      return fresh.accessToken;
    } catch (error) {
      logger.warn("ChatGPT token refresh failed", error as any);
      // Still valid: carry on, and the next call retries the refresh.
      if (now < expiresAt) return tokens.accessToken;
      return undefined;
    }
  });
  if (token !== undefined) return token;
  // Marked after the transaction: throwing inside it would roll this update back too.
  await db.update(aiConnectionTable).set({ broken: true, updatedAt: new Date() }).where(eq(aiConnectionTable.id, CONNECTION_ID));
  throw new AiUnavailable("reconnect");
}

async function tokensSince(since: Date) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsageTable.totalTokens}), 0)`.mapWith(Number) })
    .from(aiUsageTable)
    .where(gt(aiUsageTable.minute, since));
  return row!.total;
}

export async function usage() {
  const now = Date.now();
  return { lastHour: await tokensSince(new Date(now - HOUR_MS)), lastDay: await tokensSince(new Date(now - DAY_MS)) };
}

/** The last day's buckets rolled up by hour, oldest first. */
export function usageByHour() {
  const hour = sql<Date>`date_trunc('hour', ${aiUsageTable.minute})`.mapWith((value) => new Date(value));
  return db
    .select({
      hour,
      calls: sql<number>`sum(${aiUsageTable.calls})`.mapWith(Number),
      totalTokens: sql<number>`sum(${aiUsageTable.totalTokens})`.mapWith(Number),
      estimatedCalls: sql<number>`sum(${aiUsageTable.estimatedCalls})`.mapWith(Number),
    })
    .from(aiUsageTable)
    .where(gt(aiUsageTable.minute, new Date(Date.now() - DAY_MS)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

async function recordUsage(counts: chatgpt.Usage, estimated: boolean) {
  const minute = new Date(Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS);
  const added = { calls: 1, ...counts, estimatedCalls: estimated ? 1 : 0 };
  await db
    .insert(aiUsageTable)
    .values({ minute, ...added })
    .onConflictDoUpdate({
      target: aiUsageTable.minute,
      set: {
        calls: sql`${aiUsageTable.calls} + ${added.calls}`,
        inputTokens: sql`${aiUsageTable.inputTokens} + ${added.inputTokens}`,
        outputTokens: sql`${aiUsageTable.outputTokens} + ${added.outputTokens}`,
        totalTokens: sql`${aiUsageTable.totalTokens} + ${added.totalTokens}`,
        estimatedCalls: sql`${aiUsageTable.estimatedCalls} + ${added.estimatedCalls}`,
      },
    });
  await db.delete(aiUsageTable).where(lt(aiUsageTable.minute, new Date(Date.now() - DAY_MS - MINUTE_MS)));
}

export async function status() {
  const row = await connectionRow();
  return {
    configured: env.AI_TOKEN_KEY !== undefined,
    connected: row.sealedTokens !== null,
    broken: row.broken,
    accountEmail: row.accountEmail,
    model: row.model,
    hourlyTokenLimit: row.hourlyTokenLimit,
    dailyTokenLimit: row.dailyTokenLimit,
    maxOutputTokens: row.maxOutputTokens,
    usage: await usage(),
    usageByHour: await usageByHour(),
  };
}

export type AiSettings = { model: string | null; hourlyTokenLimit: number; dailyTokenLimit: number; maxOutputTokens: number };

export async function saveSettings(settings: AiSettings) {
  await connectionRow();
  await db
    .update(aiConnectionTable)
    .set({ ...settings, updatedAt: new Date() })
    .where(eq(aiConnectionTable.id, CONNECTION_ID));
}

export const models = async () => chatgpt.listModels(await accessToken());

/**
 * The one way AI is used: refused once the last hour or day has used its share of the owner's
 * plan, cut off at the output cap, and recorded against those windows afterwards.
 */
export async function ask(request: Pick<chatgpt.StreamRequest, "instructions" | "input" | "format">) {
  const row = await connectionRow();
  if (!row.model) throw new AiUnavailable("no_model");
  const used = await usage();
  if (used.lastHour >= row.hourlyTokenLimit) throw new AiLimitReached("hour");
  if (used.lastDay >= row.dailyTokenLimit) throw new AiLimitReached("day");

  let result: Awaited<ReturnType<typeof chatgpt.respond>>;
  try {
    result = await chatgpt.respond({
      accessToken: await accessToken(),
      model: row.model,
      ...request,
      maxOutputChars: row.maxOutputTokens * CHARS_PER_TOKEN,
    });
  } catch (error) {
    if (error instanceof chatgpt.ChatGptError && error.code?.startsWith("subscription_sharing_usage")) throw new AiUnavailable("plan_limit");
    throw error;
  }

  const estimated = {
    inputTokens: Math.ceil(((request.instructions?.length ?? 0) + request.input.length) / CHARS_PER_TOKEN),
    outputTokens: Math.ceil(result.text.length / CHARS_PER_TOKEN),
  };
  const counts = result.usage ?? { ...estimated, totalTokens: estimated.inputTokens + estimated.outputTokens };
  await recordUsage(counts, result.usage === undefined);
  return { text: result.text, truncated: result.truncated, usage: counts };
}

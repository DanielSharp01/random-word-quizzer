import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiConnectionTable, aiUsageTable, usersTable } from "../../src/db/schema";
import { db } from "../../src/providers/db";
import { fakeOpenAI } from "../support/fake-openai";
import { newUser, type Client } from "../support/helpers";

let openai: ReturnType<typeof fakeOpenAI>;

beforeEach(async () => {
  // The connection is a single row shared by the whole app, so each test starts from none.
  await db.delete(aiUsageTable);
  await db.delete(aiConnectionTable);
  openai = fakeOpenAI();
});

afterEach(() => openai.restore());

async function newOwner() {
  const u = await newUser();
  await db.update(usersTable).set({ isOwner: true }).where(eq(usersTable.id, u.id));
  return u;
}

/** Runs the sign-in the way the page does: start, follow the URL, paste the callback back. */
async function connect(owner: Client, clientId = "oaiapp_test") {
  const start = await owner.post("/ai/connection/start");
  const authorize = new URL(start.body.authorizeUrl);
  const state = authorize.searchParams.get("state")!;
  const callback = `http://127.0.0.1:1455/auth/callback?code=code-1&state=${state}&client_id=${clientId}`;
  return { authorize, finish: await owner.post("/ai/connection/finish", { callbackUrl: callback }) };
}

const settings = { model: "gpt-test", hourlyTokenLimit: 1000, dailyTokenLimit: 5000, maxOutputTokens: 500 };

const connectionRow = async () => (await db.select().from(aiConnectionTable))[0]!;

describe("the ChatGPT connection", () => {
  it("is only for the owner", async () => {
    const u = await newUser();
    expect((await u.get("/ai/connection")).status).toBe(403);
    expect((await u.post("/ai/connection/start")).status).toBe(403);
    expect((await u.post("/ai/try", { input: "szia" })).status).toBe(403);
  });

  it("registers on first sign-in and exchanges the code with the PKCE verifier", async () => {
    const owner = await newOwner();
    const { authorize, finish } = await connect(owner);

    expect(authorize.origin + authorize.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(authorize.searchParams.get("agent_name_hint")).toBe("Quizzer");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:1455/auth/callback");

    expect(finish.status).toBe(200);
    expect(finish.body).toMatchObject({ configured: true, connected: true, broken: false, accountEmail: "owner@example.com" });

    const [exchange] = openai.callsTo("/oauth/token");
    expect(exchange!.form!.get("client_id")).toBe("oaiapp_test");
    expect(exchange!.form!.get("resource")).toBe("https://api.openai.com/v1");
    const challenge = createHash("sha256").update(exchange!.form!.get("code_verifier")!).digest("base64url");
    expect(challenge).toBe(authorize.searchParams.get("code_challenge"));
  });

  it("keeps the tokens sealed at rest", async () => {
    const owner = await newOwner();
    await connect(owner);
    const row = await connectionRow();
    expect(row.sealedTokens).toMatch(/^v1\./);
    expect(row.sealedTokens).not.toContain("access-1");
    expect(row.sealedTokens).not.toContain("refresh-1");
  });

  it("signs in again with the issued client and the same host", async () => {
    const owner = await newOwner();
    const first = await connect(owner);
    const { authorize } = await connect(owner);
    expect(authorize.searchParams.get("client_id")).toBe("oaiapp_test");
    expect(authorize.searchParams.has("agent_name_hint")).toBe(false);
    expect(authorize.searchParams.get("ext_agent_host_id")).toBe(first.authorize.searchParams.get("ext_agent_host_id"));
  });

  it("refuses a callback it didn't start, a reused one, and a denied consent", async () => {
    const owner = await newOwner();
    const unknown = await owner.post("/ai/connection/finish", { callbackUrl: "http://127.0.0.1:1455/auth/callback?code=c&state=nope&client_id=x" });
    expect(unknown.body).toMatchObject({ reason: "expired" });

    const start = await owner.post("/ai/connection/start");
    const state = new URL(start.body.authorizeUrl).searchParams.get("state");
    const callbackUrl = `http://127.0.0.1:1455/auth/callback?code=c&state=${state}&client_id=oaiapp_test`;
    expect((await owner.post("/ai/connection/finish", { callbackUrl })).status).toBe(200);
    expect((await owner.post("/ai/connection/finish", { callbackUrl })).body).toMatchObject({ reason: "expired" });

    const denied = await owner.post("/ai/connection/finish", { callbackUrl: "http://127.0.0.1:1455/auth/callback?error=access_denied" });
    expect(denied.status).toBe(400);
    expect(denied.body).toMatchObject({ reason: "denied" });
  });

  it("lists only the models meant to be listed", async () => {
    const owner = await newOwner();
    await connect(owner);
    expect((await owner.get("/ai/models")).body).toEqual({ models: [{ slug: "gpt-test", name: "GPT Test" }] });
  });

  it("forgets the tokens on disconnect", async () => {
    const owner = await newOwner();
    await connect(owner);
    expect((await owner.delete("/ai/connection")).status).toBe(204);
    expect((await owner.get("/ai/connection")).body).toMatchObject({ connected: false, accountEmail: null });
    expect((await owner.get("/ai/models")).body).toMatchObject({ reason: "not_connected" });
  });
});

describe("refreshing", () => {
  it("refreshes inside OpenAI's window and keeps the rotated refresh token", async () => {
    const owner = await newOwner();
    await connect(owner);
    await db.update(aiConnectionTable).set({ earliestRefreshAt: new Date(Date.now() - 1000) });

    await owner.get("/ai/models");
    const [, refresh] = openai.callsTo("/oauth/token");
    expect(refresh!.form!.get("grant_type")).toBe("refresh_token");
    expect(refresh!.form!.get("refresh_token")).toBe("refresh-1");
    expect(openai.callsTo("/models").at(-1)!.authorization).toBe("Bearer access-2");

    await owner.get("/ai/models");
    expect(openai.callsTo("/oauth/token")).toHaveLength(2);
    expect(openai.callsTo("/models").at(-1)!.authorization).toBe("Bearer access-2");
  });

  it("refreshes once when several requests find the token due at the same time", async () => {
    const owner = await newOwner();
    await connect(owner);
    await db.update(aiConnectionTable).set({ earliestRefreshAt: new Date(Date.now() - 1000) });

    const results = await Promise.all([owner.get("/ai/models"), owner.get("/ai/models"), owner.get("/ai/models")]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(openai.callsTo("/oauth/token").filter((c) => c.form!.get("grant_type") === "refresh_token")).toHaveLength(1);
  });

  it("keeps using a still-valid token when a refresh fails, and asks to reconnect once it expires", async () => {
    const owner = await newOwner();
    await connect(owner);
    openai.state.refreshFails = true;
    await db.update(aiConnectionTable).set({ earliestRefreshAt: new Date(Date.now() - 1000) });
    expect((await owner.get("/ai/models")).status).toBe(200);
    expect(openai.callsTo("/models").at(-1)!.authorization).toBe("Bearer access-1");

    await db.update(aiConnectionTable).set({ expiresAt: new Date(Date.now() - 1000) });
    const expired = await owner.get("/ai/models");
    expect(expired.status).toBe(503);
    expect(expired.body).toMatchObject({ reason: "reconnect" });
    expect((await owner.get("/ai/connection")).body).toMatchObject({ broken: true });

    openai.state.refreshFails = false;
    await connect(owner);
    expect((await owner.get("/ai/connection")).body).toMatchObject({ broken: false });
  });
});

describe("asking", () => {
  it("needs a model picked first", async () => {
    const owner = await newOwner();
    await connect(owner);
    const res = await owner.post("/ai/try", { input: "szia" });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ reason: "no_model" });
  });

  it("streams the answer with store off and records what it used", async () => {
    const owner = await newOwner();
    await connect(owner);
    await owner.put("/ai/settings", settings);

    const res = await owner.post("/ai/try", { input: "Mi az ellenőrzés?" });
    expect(res.body).toEqual({ text: "Szia világ!", truncated: false, usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 } });
    const [request] = openai.callsTo("/responses");
    expect(request!.json).toMatchObject({ model: "gpt-test", store: false, stream: true });
    expect(request!.json).not.toHaveProperty("max_output_tokens");
    // A try is the bare prompt: nothing added around it.
    expect(request!.json).not.toHaveProperty("instructions");
    expect(request!.json.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "Mi az ellenőrzés?" }] }]);

    await owner.post("/ai/try", { input: "Még egyszer" });
    const status = (await owner.get("/ai/connection")).body;
    expect(status.usage).toEqual({ lastHour: 80, lastDay: 80 });
    // Summed, since the two calls may straddle a minute or an hour.
    const hours = status.usageByHour as { calls: number; totalTokens: number }[];
    expect(hours.reduce((sum, h) => sum + h.calls, 0)).toBe(2);
    expect(hours.reduce((sum, h) => sum + h.totalTokens, 0)).toBe(80);
  });

  it("stops once the last hour or day has used its limit", async () => {
    const owner = await newOwner();
    await connect(owner);
    await owner.put("/ai/settings", { ...settings, hourlyTokenLimit: 40 });
    expect((await owner.post("/ai/try", { input: "egy" })).status).toBe(200);
    const hour = await owner.post("/ai/try", { input: "kettő" });
    expect(hour.status).toBe(429);
    expect(hour.body).toMatchObject({ window: "hour" });

    await owner.put("/ai/settings", { ...settings, dailyTokenLimit: 40 });
    expect((await owner.post("/ai/try", { input: "három" })).body).toMatchObject({ window: "day" });

    // A bucket older than the window no longer counts, and is cleared out on the next write.
    await db.update(aiUsageTable).set({ minute: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    expect((await owner.post("/ai/try", { input: "négy" })).status).toBe(200);
    expect((await db.select().from(aiUsageTable)).map((b) => b.totalTokens)).toEqual([40]);
  });

  it("cuts a long answer off at the output cap and estimates what it used", async () => {
    const owner = await newOwner();
    await connect(owner);
    await owner.put("/ai/settings", { ...settings, maxOutputTokens: 50 });
    openai.state.deltas = Array.from({ length: 100 }, () => "hosszú szöveg ");

    const res = await owner.post("/ai/try", { input: "Írj sokat" });
    expect(res.body.truncated).toBe(true);
    expect(res.body.text.length).toBe(150);
    const [bucket] = await db.select().from(aiUsageTable);
    expect(bucket).toMatchObject({ calls: 1, estimatedCalls: 1, outputTokens: 50 });
  });

  it("says when the owner's plan itself is out of quota", async () => {
    const owner = await newOwner();
    await connect(owner);
    await owner.put("/ai/settings", settings);
    openai.state.failWith = "subscription_sharing_usage_limit_exceeded";
    const res = await owner.post("/ai/try", { input: "szia" });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ reason: "plan_limit" });
  });
});

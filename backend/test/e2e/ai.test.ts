import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiConnectionTable, aiUsageTable, usersTable } from "../../src/db/schema";
import { db } from "../../src/providers/db";
import { buildDocx } from "../support/docx";
import { fakeOpenAI } from "../support/fake-openai";
import { blanksAttempt, newUser, type Client } from "../support/helpers";

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

describe("AI questions", () => {
  const generated = {
    questions: [
      { question: "Mi az ellenőrzés célja?", answer: "A feladatok törvényes végrehajtása.", keyPoints: ["törvényes végrehajtás"], sourceBlock: 1 },
      { question: "Mik az alapelvei?", answer: "A törvényesség és a szakszerűség.", keyPoints: ["törvényesség", "szakszerűség"], sourceBlock: 3 },
    ],
  };

  /** Answers like the real model would: questions for generation, a verdict for grading. */
  function respondLikeTheModel() {
    openai.state.respond = (request) =>
      request.text.format.name === "questions"
        ? JSON.stringify(generated)
        : JSON.stringify({ verdict: "almost", feedback: "A szakszerűség kimaradt." });
  }

  async function documentFor(u: Client, paragraphs = [
    { text: "Az ellenőrzés célja", style: "Heading1" as const },
    { text: "Az ellenőrzés célja a feladatok törvényes végrehajtása." },
    { text: "Az ellenőrzés alapelvei", style: "Heading1" as const },
    { text: "Alapelve a törvényesség és a szakszerűség." },
  ]) {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(await buildDocx(paragraphs))], "Szabályzat.docx"));
    return (await u.postForm("/documents", form)).body.id as string;
  }

  async function sharedPlan() {
    const owner = await newOwner();
    await connect(owner);
    await owner.put("/ai/settings", settings);
    respondLikeTheModel();
    return owner;
  }

  it("splits the document into sections at its headings", async () => {
    const u = await newUser();
    const documentId = await documentFor(u);
    const { body } = await u.get(`/documents/${documentId}/sections`);
    expect(body.sections.map((s: { title: string }) => s.title)).toEqual(["Az ellenőrzés célja", "Az ellenőrzés alapelvei"]);
    expect(body.wholeIsSampled).toBe(false);
  });

  it("writes questions on the owner's plan for anyone, keeping the key back until answered", async () => {
    await sharedPlan();
    const friend = await newUser();
    const documentId = await documentFor(friend);

    const res = await friend.post(`/documents/${documentId}/attempts`, { kind: "questions", section: null, count: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "questions", section: "Teljes dokumentum", questions: [{ position: 0, answered: null }, { position: 1, answered: null }] });
    expect(JSON.stringify(res.body)).not.toContain("törvényes végrehajtás.");

    const [request] = openai.callsTo("/responses");
    expect(request!.json.input[0].content[0].text).toContain("[1] Az ellenőrzés célja a feladatok törvényes végrehajtása.");
    expect(request!.json.text.format).toMatchObject({ type: "json_schema", strict: true, name: "questions" });
  });

  it("asks for questions about one section only", async () => {
    await sharedPlan();
    const u = await newUser();
    const documentId = await documentFor(u);
    const res = await u.post(`/documents/${documentId}/attempts`, { kind: "questions", section: 1, count: 2 });
    expect(res.body.section).toBe("Az ellenőrzés alapelvei");
    const text = openai.callsTo("/responses")[0]!.json.input[0].content[0].text as string;
    expect(text).toBe("[2] Az ellenőrzés alapelvei\n[3] Alapelve a törvényesség és a szakszerűség.");
  });

  it("grades a close answer without AI and the rest with it, once each", async () => {
    await sharedPlan();
    const u = await newUser();
    const documentId = await documentFor(u);
    const { body: attempt } = await u.post(`/documents/${documentId}/attempts`, { kind: "questions", section: null, count: 2 });
    const callsAfterGenerating = openai.callsTo("/responses").length;

    const matched = await u.post(`/attempts/${attempt.id}/questions/0/answer`, { answer: "a feladatok törvényes végrehajtása" });
    expect(matched.body.answered).toMatchObject({ verdict: "correct", checkedBy: "match", feedback: null, answer: "A feladatok törvényes végrehajtása." });
    expect(openai.callsTo("/responses")).toHaveLength(callsAfterGenerating);

    const graded = await u.post(`/attempts/${attempt.id}/questions/1/answer`, { answer: "Csak a törvényesség." });
    expect(graded.body.answered).toMatchObject({
      verdict: "almost",
      checkedBy: "ai",
      feedback: "A szakszerűség kimaradt.",
      keyPoints: ["törvényesség", "szakszerűség"],
      source: "Alapelve a törvényesség és a szakszerűség.",
    });
    const grading = openai.callsTo("/responses").at(-1)!.json;
    expect(grading.text.format.name).toBe("evaluation");
    expect(grading.input[0].content[0].text).toContain("A tanuló válasza: Csak a törvényesség.");

    expect((await u.post(`/attempts/${attempt.id}/questions/1/answer`, { answer: "újra" })).status).toBe(409);
    expect((await u.post(`/attempts/${attempt.id}/questions/9/answer`, { answer: "x" })).status).toBe(404);
    expect((await u.get(`/attempts/${attempt.id}`)).body.questions.map((q: { answered: { verdict: string } }) => q.answered.verdict)).toEqual(["correct", "almost"]);
  });

  it("lists past attempts of both kinds with their scores", async () => {
    await sharedPlan();
    const u = await newUser();
    const documentId = await documentFor(u);
    const { body: blanks } = await blanksAttempt(u, documentId, { percent: 60, minLength: 4 });
    await u.post(`/attempts/${blanks.id}/answers`, { blank: 0, guess: "" });
    const { body: questions } = await u.post(`/documents/${documentId}/attempts`, { kind: "questions", section: null, count: 2 });
    await u.post(`/attempts/${questions.id}/questions/0/answer`, { answer: "A feladatok törvényes végrehajtása." });

    const { body } = await u.get("/attempts");
    expect(body.attempts).toEqual([
      expect.objectContaining({ id: questions.id, kind: "questions", title: "Szabályzat", itemCount: 2, score: { correct: 1, almost: 0, wrong: 0 } }),
      expect.objectContaining({ id: blanks.id, kind: "blanks", itemCount: blanks.blankCount, score: { correct: 0, almost: 0, wrong: 1 } }),
    ]);
    expect((await u.get(`/attempts?documentId=${documentId}`)).body.attempts).toHaveLength(2);
    expect((await (await newUser()).get("/attempts")).body.attempts).toEqual([]);
  });

  it("samples sections of a document too long to send whole", async () => {
    await sharedPlan();
    const u = await newUser();
    // Three sections of about 10 000 characters: only two fit in one call.
    const long = await documentFor(
      u,
      ["Első rész", "Második rész", "Harmadik rész"].flatMap((title) => [{ text: title, style: "Heading1" as const }, { text: `${title} szövege. `.repeat(500) }]),
    );
    expect((await u.get(`/documents/${long}/sections`)).body.wholeIsSampled).toBe(true);

    const res = await u.post(`/documents/${long}/attempts`, { kind: "questions", section: null, count: 2 });
    expect(res.status).toBe(201);
    expect(res.body.section).toBe("Teljes dokumentum");
    const request = openai.callsTo("/responses").at(-1)!.json;
    const sent = request.input[0].content[0].text as string;
    expect(sent.length).toBeLessThanOrEqual(24_000);
    expect(sent.split("\n\n")).toHaveLength(2);
    expect(request.instructions).toContain("különböző helyeiről");
  });

  it("says when AI isn't set up", async () => {
    await sharedPlan();
    const u = await newUser();
    await db.delete(aiConnectionTable);
    const short = await documentFor(u);
    const off = await u.post(`/documents/${short}/attempts`, { kind: "questions", section: null, count: 3 });
    expect(off.status).toBe(503);
    expect(off.body).toMatchObject({ reason: "no_model" });
  });

  it("leaves no attempt behind when the AI answer is unusable", async () => {
    await sharedPlan();
    openai.state.respond = () => "ez nem JSON";
    const u = await newUser();
    const documentId = await documentFor(u);
    const res = await u.post(`/documents/${documentId}/attempts`, { kind: "questions", section: null, count: 2 });
    expect(res.status).toBe(502);
    expect((await u.get("/attempts")).body.attempts).toEqual([]);
  });
});

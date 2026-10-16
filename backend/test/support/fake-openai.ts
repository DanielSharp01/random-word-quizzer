import { vi } from "vitest";

const OPENAI = /^https:\/\/(auth|api)\.openai\.com\//;

type Call = { url: string; form: URLSearchParams | undefined; json: any; authorization: string | undefined };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sse(events: unknown[]) {
  const body = events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

/** An unsigned JWT is enough: the app reads the email claim without verifying the signature. */
const idToken = (email: string) => `e30.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.sig`;

/**
 * Stands in for auth.openai.com and api.openai.com behind fetch. The test server runs in this
 * process, so its outgoing calls land here, while the tests' own requests to it pass through.
 */
export function fakeOpenAI() {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  const state = {
    issued: 0,
    refreshFails: false,
    deltas: ["Szia", " világ!"],
    usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 },
    failWith: undefined as string | undefined,
    /** Answers a Responses request by its body, e.g. by the schema it asks for; the deltas otherwise. */
    respond: undefined as ((request: any) => string) | undefined,
  };

  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!OPENAI.test(url)) return real(input, init);
    const body = init?.body;
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      form: body instanceof URLSearchParams ? body : undefined,
      json: typeof body === "string" ? JSON.parse(body) : undefined,
      authorization: headers.get("authorization") ?? undefined,
    });

    if (url.endsWith("/oauth/token")) {
      const form = body as URLSearchParams;
      if (form.get("grant_type") === "refresh_token" && state.refreshFails) return json(400, { error: "invalid_grant" });
      state.issued++;
      const now = Math.floor(Date.now() / 1000);
      return json(200, {
        access_token: `access-${state.issued}`,
        refresh_token: `refresh-${state.issued}`,
        id_token: idToken("owner@example.com"),
        expires_in: 3600,
        earliest_refresh_at: now + 3300,
        token_type: "Bearer",
      });
    }
    if (url.endsWith("/models")) {
      return json(200, {
        models: [
          { slug: "gpt-test", display_name: "GPT Test", visibility: "list" },
          { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide" },
        ],
      });
    }
    if (url.endsWith("/responses")) {
      if (state.failWith) return sse([{ type: "response.failed", response: { error: { code: state.failWith } } }]);
      return sse([
        { type: "response.created" },
        ...(state.respond ? [state.respond(JSON.parse(String(body)))] : state.deltas).map((delta) => ({ type: "response.output_text.delta", delta })),
        { type: "response.completed", response: { usage: state.usage } },
      ]);
    }
    return json(404, { error: "not_found" });
  });

  return {
    state,
    calls,
    callsTo: (path: string) => calls.filter((c) => c.url.endsWith(path)),
    restore: () => spy.mockRestore(),
  };
}

/**
 * Sign in with ChatGPT, plan-usage flavour: the app registers itself on first sign-in
 * (dynamic_agent_client), and inference runs on the signed-in person's ChatGPT plan.
 * https://developers.openai.com/siwc/token-sharing-open-source
 */
const AUTH = "https://auth.openai.com/api/accounts";
const API = "https://api.openai.com/v1";
const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

/**
 * Only loopback callbacks are allowed. Nothing listens there: the browser shows an error page and
 * the owner pastes its address back into the app, which is enough to finish the exchange.
 */
export const REDIRECT_URI = "http://127.0.0.1:1455/auth/callback";

export class ChatGptError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ChatGptError";
  }
}

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  idToken: string | undefined;
  expiresAt: Date;
  /** OpenAI refuses refreshes before this, usually a few minutes before the access token expires. */
  earliestRefreshAt: Date | undefined;
};

export function authorizeUrl(request: { clientId: string | undefined; hostId: string; state: string; nonce: string; codeChallenge: string }) {
  const params = new URLSearchParams({
    client_id: request.clientId ?? "dynamic_agent_client",
    // Only on the first registration; later sign-ins reuse the issued client.
    ...(request.clientId ? {} : { agent_name_hint: "Quizzer" }),
    ext_agent_host_id: request.hostId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    resource: API,
    state: request.state,
    nonce: request.nonce,
    code_challenge_method: "S256",
    code_challenge: request.codeChallenge,
  });
  return `${AUTH}/authorize?${params}`;
}

async function failure(res: Response) {
  const text = await res.text();
  let code: string | undefined;
  try {
    const body = JSON.parse(text) as { error?: string | { code?: string } };
    code = typeof body.error === "string" ? body.error : body.error?.code;
  } catch {}
  return new ChatGptError(res.status, code, `ChatGPT request failed with ${res.status}${code ? ` (${code})` : ""}`);
}

async function tokenRequest(form: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${AUTH}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, resource: API }),
  });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    id_token?: string;
    expires_in: number;
    earliest_refresh_at?: number;
  };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    idToken: body.id_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
    earliestRefreshAt: body.earliest_refresh_at ? new Date(body.earliest_refresh_at * 1000) : undefined,
  };
}

export const exchangeCode = (request: { clientId: string; code: string; codeVerifier: string }) =>
  tokenRequest({ grant_type: "authorization_code", client_id: request.clientId, code: request.code, code_verifier: request.codeVerifier, redirect_uri: REDIRECT_URI });

export const refreshTokens = (request: { clientId: string; refreshToken: string }) =>
  tokenRequest({ grant_type: "refresh_token", client_id: request.clientId, refresh_token: request.refreshToken });

/** The token came straight from OpenAI over TLS, so its claims are read without verifying the signature. */
export function emailOf(idToken: string | undefined) {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email : undefined;
  } catch {
    return undefined;
  }
}

export async function listModels(accessToken: string) {
  const res = await fetch(`${API}/models`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { models?: { slug: string; display_name?: string; visibility?: string }[] };
  return (body.models ?? []).filter((m) => m.visibility === "list").map((m) => ({ slug: m.slug, name: m.display_name ?? m.slug }));
}

export type Usage = { inputTokens: number; outputTokens: number; totalTokens: number };

export type StreamRequest = {
  accessToken: string;
  model: string;
  instructions?: string;
  input: string;
  /** Strict structured output: the answer is JSON matching this schema. */
  format?: { name: string; schema: Record<string, unknown> };
  /** This flow rejects max_output_tokens, so the stream is cut off here instead. */
  maxOutputChars: number;
};

/** One streamed Responses call. `usage` is missing when the stream was cut off before OpenAI reported it. */
export async function respond(request: StreamRequest): Promise<{ text: string; usage: Usage | undefined; truncated: boolean }> {
  const abort = new AbortController();
  const res = await fetch(`${API}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${request.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: request.model,
      // Both are required for plan usage.
      store: false,
      stream: true,
      ...(request.instructions ? { instructions: request.instructions } : {}),
      input: [{ role: "user", content: [{ type: "input_text", text: request.input }] }],
      ...(request.format ? { text: { format: { type: "json_schema", strict: true, ...request.format } } } : {}),
    }),
    signal: abort.signal,
  });
  if (!res.ok || !res.body) throw await failure(res);

  let text = "";
  let buffer = "";
  try {
    for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const data = buffer
          .slice(0, end)
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6);
        buffer = buffer.slice(end + 2);
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data) as {
          type: string;
          delta?: string;
          response?: { usage?: { input_tokens: number; output_tokens: number; total_tokens: number }; error?: { code?: string; message?: string } };
        };
        if (event.type === "response.output_text.delta") {
          text += event.delta ?? "";
          if (text.length > request.maxOutputChars) {
            abort.abort();
            return { text: text.slice(0, request.maxOutputChars), usage: undefined, truncated: true };
          }
        } else if (event.type === "response.completed") {
          const usage = event.response?.usage;
          return {
            text,
            usage: usage && { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens },
            truncated: false,
          };
        } else if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
          const error = event.response?.error;
          throw new ChatGptError(502, error?.code, error?.message ?? `ChatGPT ${event.type}`);
        }
      }
    }
  } finally {
    abort.abort();
  }
  throw new ChatGptError(502, undefined, "The ChatGPT stream ended without completing");
}

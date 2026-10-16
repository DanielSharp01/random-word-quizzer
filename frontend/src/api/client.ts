/** A non-2xx answer. The body's fields stay on it, such as `current` on a 409. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.reason === "string" ? body.reason : typeof body.error === "string" ? body.error : `HTTP ${status}`);
  }

  get reason() {
    return typeof this.body.reason === "string" ? this.body.reason : undefined;
  }

  /** The stored row a 409 sends back, so the client can show it without another request. */
  get current() {
    return this.body.current;
  }
}

/** fetch rejects only when the request never got an answer. */
export class OfflineError extends Error {
  constructor() {
    super("No connection");
  }
}

export const isConflict = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 409;

function toLogin(): never {
  const returnTo = location.pathname + location.search;
  location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  throw new ApiError(401, { reason: "Signed out" });
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new OfflineError();
  }
  if (res.status === 401) toLogin();
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, parsed && typeof parsed === "object" ? parsed : {});
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: (path: string) => request<void>("DELETE", path),
};

export const query = (params: Record<string, string | undefined>) => {
  const defined = Object.entries(params).filter((p): p is [string, string] => p[1] !== undefined);
  return defined.length ? `?${new URLSearchParams(defined)}` : "";
};

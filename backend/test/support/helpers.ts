import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll } from "vitest";
import { createApp, onError } from "../../src/app";
import { usersTable } from "../../src/db/schema";
import { session } from "../../src/providers/auth";
import { db, pool } from "../../src/providers/db";
import { closeRedis, initializeRedis } from "../../src/providers/redis";

let started: Promise<{ base: string; server: Server }> | undefined;

function start() {
  started ??= (async () => {
    await initializeRedis();
    const app = createApp();
    const server = createServer(app.requestListener({ onError }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`, server };
  })();
  return started;
}

afterAll(async () => {
  if (!started) return;
  const { server } = await started;
  await new Promise((resolve) => server.close(resolve));
  await closeRedis();
  await pool.end();
});

export type Res = { status: number; body: any; headers: Headers };

/** A fresh person with a live session; every test works in its own account, so files run in parallel. */
export async function newUser() {
  await start();
  const sub = randomUUID();
  const [user] = await db.insert(usersTable).values({ googleSub: sub, email: `${sub}@example.com`, name: "Test" }).returning();
  const google = { sub, email: undefined, emailVerified: undefined, hostedDomain: undefined, name: undefined, givenName: undefined, familyName: undefined, picture: undefined, locale: undefined };
  const { sessionId } = await session.issue({ userId: user!.id, google });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const { base } = await start();
    // fetch sets a FormData body's multipart content type itself, boundary included.
    const json = body !== undefined && !(body instanceof FormData);
    const res = await fetch(base + path, {
      method,
      headers: { cookie: `__Host-auth=${sessionId}`, ...(json ? { "content-type": "application/json" } : {}), ...headers },
      ...(body === undefined ? {} : { body: json ? JSON.stringify(body) : (body as FormData) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  };
  return {
    id: user!.id,
    get: (path: string, headers?: Record<string, string>) => call("GET", path, undefined, headers),
    post: (path: string, body: unknown = {}) => call("POST", path, body),
    postForm: (path: string, form: FormData) => call("POST", path, form),
    put: (path: string, body: unknown) => call("PUT", path, body),
    delete: (path: string) => call("DELETE", path),
  };
}

export type Client = Awaited<ReturnType<typeof newUser>>;

/** A request without a session; the path is from the server root, so it reaches /auth too. */
export async function anonymous(path: string, headers: Record<string, string> = {}) {
  const { base } = await start();
  return fetch(new URL(path, base), { redirect: "manual", headers });
}

export const uuid = () => randomUUID();

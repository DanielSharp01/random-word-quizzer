import { googleOauth, type GoogleIdentity } from "@danielsharp/auth/google";
import { env } from "../config/env";
import { cookieScheme, authentication } from "@danielsharp/http-auth";
import { sessionProvider } from "@danielsharp/auth";
import { redis } from "./redis";
import { codecs } from "@danielsharp/redis";

export const google = googleOauth({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
});

export type Auth = {
  userId: string;
  google: GoogleIdentity;
};

export const session = sessionProvider<Auth>(
  {
    setSession: (sessionId, data, expiresAt) =>
      redis.set(`session:${sessionId}`, data, codecs.json(), {
        expiration: { type: "PXAT", value: expiresAt.getTime() },
      }),
    getSession: (sessionId) =>
      redis.get(`session:${sessionId}`, codecs.json<Auth>()),
    deleteSession: (sessionId) => redis.del(`session:${sessionId}`),
  },
  {
    expiresInMs: 60 * 60 * 24 * 7 * 1000,
  },
);

export const authCookie = cookieScheme("__Host-auth", {
  httpOnly: true,
  secure: true,
  path: "/",
  sameSite: "lax",
});

export const auth = authentication({
  scheme: authCookie,
  sessionProvider: session,
});

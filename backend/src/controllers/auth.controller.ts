import { randomUUID } from "node:crypto";
import { flashCookie, resRedirect, validateParams, validateQuery } from "@danielsharp/typeline-http";
import { stop, selectInput, tapInput } from "@danielsharp/typeline";
import { oauthCallback } from "@danielsharp/http-auth";
import { zodJsonString } from "@danielsharp/zod";
import { rootRouter } from "../routers";
import z from "zod";
import { authCookie, google, session } from "../providers/auth";
import { db } from "../providers/db";
import { UserRepository } from "../repositories/user.repo";
import { issuePkce } from "@danielsharp/auth";
import { env } from "../config/env";

const users = new UserRepository(db);
// Built from configuration, not the request, so a proxy in front can't change where Google sends the code.
const googleCallback = `${env.API_HOST}/auth/google/callback`;

const flashOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;
// A stale or tampered invite cookie just means signing in without one.
const inviteCookie = flashCookie("__Host-auth-invite", z.string().max(100).optional().catch(undefined), {
  ...flashOptions,
  maxAge: 15 * 60 * 1000,
});
const googleCookie = flashCookie("__Host-auth-google", zodJsonString(z.object({ codeVerifier: z.string(), nonce: z.string() })), {
  ...flashOptions,
  maxAge: 5 * 60 * 1000,
});

export function authController() {
  // Checked before Google so a dead link says so up front; the callback checks it again when it's claimed.
  rootRouter.get("/auth/invite/:token", (line) =>
    line
      .pipe(validateParams(z.object({ token: z.string().min(1).max(100) })))
      .pipe(async ({ params }, ctx) => {
        if (!(await users.isInviteLive(params.token))) return "/login?error=invite_expired";
        inviteCookie.set(params.token, ctx);
        return "/auth/google/authorize?returnTo=/";
      })
      .pipe(resRedirect(302)),
  );

  rootRouter.get("/auth/google/authorize", (line) =>
    line
      .pipe(validateQuery(z.object({ returnTo: z.string().default("/") })))
      .pipe(({ query }, ctx) => {
        const { codeVerifier, codeChallenge } = issuePkce();
        const nonce = randomUUID();
        googleCookie.set(JSON.stringify({ codeVerifier, nonce }), ctx);
        return google.getAuthorizationUrl({ redirectUri: googleCallback, state: query.returnTo, codeChallenge, nonce });
      })
      .pipe(resRedirect(302)),
  );

  rootRouter.get("/auth/google/callback", (line) =>
    line
      // Taken before the Google cookie so it's spent even when the callback fails.
      .pipe(inviteCookie.take("invite"))
      .pipe(googleCookie.take("pkce"))
      .pipe(oauthCallback({ provider: google, redirectUri: googleCallback, onError: { redirect: "/login" } }))
      .pipe(async ({ identity, state, invite }, { res }) => {
        const user = await users.signInWithGoogle(identity, invite);
        if (!user) {
          res.redirect("/login?error=not_invited");
          return stop();
        }
        return { session: await session.issue({ userId: user.id, google: identity }), returnTo: state };
      })
      .pipe(tapInput(selectInput((x) => x.session, authCookie.set)))
      .pipe(selectInput((x) => x.returnTo, resRedirect(302, { sameOrigin: true }))),
  );

  rootRouter.get("/auth/logout", (line) =>
    line
      .pipe(async (_, ctx) => {
        const sessionId = await authCookie.read(ctx);
        if (sessionId) {
          await session.revoke(sessionId);
        }
      })
      .pipe((_, ctx) => authCookie.clear(ctx))
      .pipe(selectInput(() => "/login", resRedirect(302))),
  );
}

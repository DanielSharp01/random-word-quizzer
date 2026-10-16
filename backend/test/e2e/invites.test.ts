import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { usersTable } from "../../src/db/schema";
import { db } from "../../src/providers/db";
import { UserRepository } from "../../src/repositories/user.repo";
import { anonymous } from "../support/helpers";

const users = new UserRepository(db);
const google = (sub = randomUUID()) => ({ sub, email: `${sub}@example.com`, name: "Signed in" }) as Parameters<UserRepository["signInWithGoogle"]>[0];

describe("signing in with Google", () => {
  it("lets a known account in and keeps its profile current", async () => {
    const sub = randomUUID();
    const [user] = await db.insert(usersTable).values({ googleSub: sub, name: "Old" }).returning();
    expect(await users.signInWithGoogle(google(sub))).toEqual({ id: user!.id });
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user!.id));
    expect(row!.name).toBe("Signed in");
  });

  it("turns an unknown account away without an invite", async () => {
    expect(await users.signInWithGoogle(google())).toBeUndefined();
  });

  it("links an unknown account to the invited user, once", async () => {
    const { id, token } = await users.invite("Friend");
    const identity = google();
    expect(await users.signInWithGoogle(identity, token)).toEqual({ id });
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    expect(row).toMatchObject({ googleSub: identity.sub, inviteTokenHash: null, inviteExpiresAt: null });
    expect(await users.signInWithGoogle(google(), token)).toBeUndefined();
    expect(await users.signInWithGoogle(identity)).toEqual({ id });
  });

  it("refuses an expired invite", async () => {
    const { id, token } = await users.invite("Late");
    await db.update(usersTable).set({ inviteExpiresAt: new Date(Date.now() - 1000) }).where(eq(usersTable.id, id));
    expect(await users.signInWithGoogle(google(), token)).toBeUndefined();
  });

  it("renews an invite, and the old link stops working", async () => {
    const old = await users.invite("Slow");
    const renewed = await users.renewInvite(old.id);
    expect(renewed?.id).toBe(old.id);
    expect(await users.isInviteLive(old.token)).toBe(false);
    expect(await users.signInWithGoogle(google(), renewed!.token)).toEqual({ id: old.id });
    expect(await users.renewInvite(old.id)).toBeUndefined();
  });
});

describe("invite link", () => {
  it("starts Google sign-in with the invite in a cookie", async () => {
    const { token } = await users.invite("Friend");
    const res = await anonymous(`/auth/invite/${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/google/authorize?returnTo=/");
    expect(res.headers.get("set-cookie")).toContain(`__Host-auth-invite=${token}`);
  });

  it("sends a cancelled Google sign-in to the login page and spends both cookies", async () => {
    const google = encodeURIComponent(JSON.stringify({ codeVerifier: "verifier", nonce: "nonce" }));
    const res = await anonymous("/auth/google/callback?error=access_denied", {
      cookie: `__Host-auth-google=${google}; __Host-auth-invite=token`,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=oauth_denied");
    const cleared = res.headers.getSetCookie();
    expect(cleared.some((c) => c.startsWith("__Host-auth-google=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(cleared.some((c) => c.startsWith("__Host-auth-invite=;") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("sends a dead link to the login page", async () => {
    const res = await anonymous(`/auth/invite/${randomUUID()}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=invite_expired");
  });
});

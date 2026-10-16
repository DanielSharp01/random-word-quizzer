import { hashToken, issueExpiringToken } from "@danielsharp/auth";
import type { GoogleIdentity } from "@danielsharp/auth/google";
import { and, eq, gt, isNull } from "drizzle-orm";
import { usersTable } from "../db/schema";
import type { Db, Executor } from "../providers/db";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function newInvite() {
  const { token, idHash, expiresAt } = issueExpiringToken(INVITE_TTL_MS);
  return { token, inviteTokenHash: idHash, inviteExpiresAt: expiresAt };
}

const unusedInvite = (token: string) =>
  and(eq(usersTable.inviteTokenHash, hashToken(token)), gt(usersTable.inviteExpiresAt, new Date()), isNull(usersTable.googleSub));

export class UserRepository {
  constructor(private db: Db) {}

  /**
   * Known Google accounts sign in and keep email and name current. An unknown one gets in only
   * by claiming a live invite, which links it to the invited user and spends the invite.
   */
  async signInWithGoogle(identity: GoogleIdentity, inviteToken?: string): Promise<{ id: string } | undefined> {
    const profile = { email: identity.email ?? null, name: identity.name ?? null };
    const [known] = await this.db.update(usersTable).set(profile).where(eq(usersTable.googleSub, identity.sub)).returning({ id: usersTable.id });
    if (known || !inviteToken) return known;
    const [invited] = await this.db
      .update(usersTable)
      .set({ googleSub: identity.sub, ...profile, inviteTokenHash: null, inviteExpiresAt: null })
      .where(unusedInvite(inviteToken))
      .returning({ id: usersTable.id });
    return invited;
  }

  async isInviteLive(token: string) {
    const [user] = await this.db.select({ id: usersTable.id }).from(usersTable).where(unusedInvite(token));
    return !!user;
  }

  async invite(name: string) {
    const { token, ...invite } = newInvite();
    const [user] = await this.db.insert(usersTable).values({ name, ...invite }).returning({ id: usersTable.id });
    return { id: user!.id, token };
  }

  /** A new link for someone who hasn't signed in yet; the old link stops working. */
  async renewInvite(userId: string) {
    const { token, ...invite } = newInvite();
    const [user] = await this.db
      .update(usersTable)
      .set(invite)
      .where(and(eq(usersTable.id, userId), isNull(usersTable.googleSub)))
      .returning({ id: usersTable.id });
    return user && { id: user.id, token };
  }
}

export async function findUser(ex: Executor, id: string) {
  const [user] = await ex.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, isOwner: usersTable.isOwner }).from(usersTable).where(eq(usersTable.id, id));
  return user;
}

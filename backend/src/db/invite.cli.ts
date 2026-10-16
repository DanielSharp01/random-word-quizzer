/**
 * `pnpm invite "<name>"` makes a user who can sign in once through the printed link;
 * `pnpm invite --renew <user id>` replaces the link of someone who hasn't used theirs yet.
 */
import { db, pool } from "../providers/db";
import { INVITE_TTL_MS, inviteLink, UserRepository } from "../repositories/user.repo";

const users = new UserRepository(db);
const [first, second] = process.argv.slice(2);

const invite = first === "--renew" ? second && (await users.renewInvite(second)) : first && (await users.invite(first));
await pool.end();

if (!invite) {
  console.error(first === "--renew" ? "No user with that id is waiting on an invite." : 'Usage: pnpm invite "<name>" | pnpm invite --renew <user id>');
  process.exit(1);
}
console.log(`User ${invite.id}`);
console.log(inviteLink(invite.token));
console.log(`Expires in ${INVITE_TTL_MS / 86_400_000} days.`);

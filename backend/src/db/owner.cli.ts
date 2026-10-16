/**
 * `pnpm make-owner <email>` lets that person connect the shared ChatGPT plan and set its limits;
 * `pnpm make-owner --revoke <email>` takes it away. They must have signed in at least once.
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../providers/db";
import { usersTable } from "./schema";

const [first, second] = process.argv.slice(2);
const revoke = first === "--revoke";
const email = revoke ? second : first;

const updated = email
  ? await db.update(usersTable).set({ isOwner: !revoke }).where(eq(usersTable.email, email)).returning({ id: usersTable.id })
  : [];
await pool.end();

if (updated.length === 0) {
  console.error(email ? `No signed-in user with the email ${email}.` : 'Usage: pnpm make-owner <email> | pnpm make-owner --revoke <email>');
  process.exit(1);
}
console.log(`${email} is ${revoke ? "no longer an" : "now an"} owner.`);

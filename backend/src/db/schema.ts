import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * One row per person; Google's subject id is the stable key, since email can change. An invited
 * person exists before their first sign-in, without a Google account, until the invite is used.
 */
export const usersTable = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  googleSub: text().unique(),
  email: text(),
  name: text(),
  /** SHA-256 of the token in the invite link; the link itself is never stored. */
  inviteTokenHash: text().unique(),
  inviteExpiresAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
});

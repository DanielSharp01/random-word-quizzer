import { integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Block } from "../quiz/blanks";

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const verdictEnum = pgEnum("verdict", ["correct", "almost", "wrong"]);
export const almostReasonEnum = pgEnum("almost_reason", ["accent", "typo"]);

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

const owner = () =>
  uuid()
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" });

/** An uploaded document, kept as its text blocks; the original file isn't stored. */
export const documentsTable = pgTable("documents", {
  id: uuid().primaryKey().defaultRandom(),
  userId: owner(),
  title: text().notNull(),
  blocks: jsonb().$type<Block[]>().notNull(),
  createdAt: createdAt(),
});

/** One run through a document. The blanks aren't stored: the seed and settings rebuild them. */
export const attemptsTable = pgTable("attempts", {
  id: uuid().primaryKey().defaultRandom(),
  userId: owner(),
  documentId: uuid()
    .notNull()
    .references(() => documentsTable.id, { onDelete: "cascade" }),
  seed: integer().notNull(),
  percent: integer().notNull(),
  minLength: integer().notNull(),
  createdAt: createdAt(),
});

/** One guess per blank; a blank can't be answered twice in the same attempt. */
export const answersTable = pgTable(
  "answers",
  {
    attemptId: uuid()
      .notNull()
      .references(() => attemptsTable.id, { onDelete: "cascade" }),
    blank: integer().notNull(),
    guess: text().notNull(),
    verdict: verdictEnum().notNull(),
    reason: almostReasonEnum(),
    answeredAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.blank] })],
);

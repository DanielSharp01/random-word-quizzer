import { boolean, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  /** Can connect the shared ChatGPT plan and set its limits. */
  isOwner: boolean().notNull().default(false),
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

/**
 * The owner's ChatGPT plan, shared by everyone's AI requests; a single row. Kept on disconnect,
 * without tokens, so a later sign-in reuses the registered client and host id.
 */
export const aiConnectionTable = pgTable("ai_connection", {
  id: text().primaryKey().default("chatgpt"),
  /** Stable per deployment; OpenAI ties the registered client to it. */
  hostId: text().notNull(),
  /** The oaiapp_ client issued by the first sign-in. */
  clientId: text(),
  /** Access, refresh and ID tokens, sealed with AI_TOKEN_KEY. */
  sealedTokens: text(),
  expiresAt: timestamp({ withTimezone: true }),
  earliestRefreshAt: timestamp({ withTimezone: true }),
  accountEmail: text(),
  /** Set when a refresh failed after the access token expired; only a new sign-in clears it. */
  broken: boolean().notNull().default(false),
  model: text(),
  hourlyTokenLimit: integer().notNull().default(50_000),
  dailyTokenLimit: integer().notNull().default(300_000),
  maxOutputTokens: integer().notNull().default(2_000),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tokens used per minute, summed over the last hour and day to enforce the limits. Buckets older
 * than a day are deleted as new ones are written, so this never holds more than about 1440 rows.
 */
export const aiUsageTable = pgTable("ai_usage", {
  minute: timestamp({ withTimezone: true }).primaryKey(),
  calls: integer().notNull().default(0),
  inputTokens: integer().notNull().default(0),
  outputTokens: integer().notNull().default(0),
  totalTokens: integer().notNull().default(0),
  /** Calls cut off before OpenAI reported usage; their counts are estimates. */
  estimatedCalls: integer().notNull().default(0),
});

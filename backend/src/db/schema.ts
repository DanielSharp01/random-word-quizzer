import { boolean, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Block } from "../quiz/blanks";
import type { BlockRange } from "../quiz/sections";

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const verdictEnum = pgEnum("verdict", ["correct", "almost", "wrong"]);
export const almostReasonEnum = pgEnum("almost_reason", ["accent", "typo"]);
export const attemptKindEnum = pgEnum("attempt_kind", ["blanks", "questions"]);
/** How a question's answer was judged: matched against the reference without AI, or by AI. */
export const checkedByEnum = pgEnum("checked_by", ["match", "ai"]);

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

/**
 * One run through a document, kept so past scores can be looked back on. A blanks attempt doesn't
 * store its blanks: the seed and settings rebuild them. A questions attempt stores its questions.
 */
export const attemptsTable = pgTable("attempts", {
  id: uuid().primaryKey().defaultRandom(),
  userId: owner(),
  documentId: uuid()
    .notNull()
    .references(() => documentsTable.id, { onDelete: "cascade" }),
  kind: attemptKindEnum().notNull().default("blanks"),
  seed: integer(),
  percent: integer(),
  minLength: integer(),
  /** The blocks a questions attempt was generated from, end exclusive. */
  fromBlock: integer(),
  toBlock: integer(),
  /** The parts a blanks attempt covers; missing means the whole document. */
  ranges: jsonb().$type<BlockRange[]>(),
  /** How a blanks attempt chose its parts, kept to name it: a section's title or a count of random ones. */
  scopeLabel: text(),
  /** The rules that picked a blanks attempt's blanks; missing means 1, from before rules were versioned. */
  blankRules: integer(),
  /** Blanks or questions in the attempt; missing on blanks attempts made before it was stored. */
  itemCount: integer(),
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

/** An AI-generated question with its answer key, and the person's answer once given. */
export const questionsTable = pgTable(
  "questions",
  {
    attemptId: uuid()
      .notNull()
      .references(() => attemptsTable.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    /** The block the question was written from, shown with the feedback. */
    sourceBlock: integer().notNull(),
    question: text().notNull(),
    answer: text().notNull(),
    /** What a good answer must contain; the grading checks for these. */
    keyPoints: jsonb().$type<string[]>().notNull(),
    guess: text(),
    verdict: verdictEnum(),
    feedback: text(),
    checkedBy: checkedByEnum(),
    answeredAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.position] })],
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

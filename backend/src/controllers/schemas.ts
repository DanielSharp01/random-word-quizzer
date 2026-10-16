import { z } from "zod";

export const idParams = z.object({ id: z.uuid() });

const blockKindSchema = z.enum(["heading", "paragraph", "listItem"]);
const verdictSchema = z.enum(["correct", "almost", "wrong"]);

export const blockSchema = z.object({ kind: blockKindSchema, text: z.string() });

export const documentSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  blockCount: z.int(),
  createdAt: z.date(),
});

/**
 * For estimating blanks on the page: `candidates[n]` words of n letters the blanking rules could pick
 * (the last slot n or more), and `total` words.
 */
export const blankStatsSchema = z.object({ candidates: z.int().array(), total: z.int() });

export const sectionSchema = z.object({
  index: z.int(),
  title: z.string(),
  titled: z.boolean(),
  fromBlock: z.int(),
  toBlock: z.int(),
  chars: z.int(),
  blankStats: blankStatsSchema,
});

const segmentSchema = z.union([z.object({ text: z.string() }), z.object({ blank: z.int(), length: z.int() })]);

export const answerSchema = z.object({
  blank: z.int(),
  guess: z.string(),
  verdict: verdictSchema,
  reason: z.enum(["accent", "typo"]).nullable(),
  /** The word that was blanked, so the page can show it once the blank is answered. */
  answer: z.string(),
});

/** The answer key and the grading only appear once the question is answered. */
export const questionSchema = z.object({
  position: z.int(),
  question: z.string(),
  answered: z
    .object({
      guess: z.string(),
      verdict: verdictSchema,
      feedback: z.string().nullable(),
      checkedBy: z.enum(["match", "ai"]),
      answer: z.string(),
      keyPoints: z.string().array(),
      /** The passage the question was written from. */
      source: z.string(),
    })
    .nullable(),
});

const attemptBase = { id: z.uuid(), documentId: z.uuid(), title: z.string(), createdAt: z.date() };

export const attemptSchema = z.discriminatedUnion("kind", [
  z.object({
    ...attemptBase,
    kind: z.literal("blanks"),
    /** Which part of the document: "Teljes dokumentum", a section's title, or how many random sections. */
    scope: z.string(),
    percent: z.int(),
    minLength: z.int(),
    blankCount: z.int(),
    /** `gapBefore`: text was skipped between this block and the one before it. */
    blocks: z.object({ kind: blockKindSchema, segments: segmentSchema.array(), gapBefore: z.literal(true).optional() }).array(),
    answers: answerSchema.array(),
  }),
  z.object({
    ...attemptBase,
    kind: z.literal("questions"),
    /** The section the questions were written from, or "Teljes dokumentum" for the whole of it. */
    section: z.string(),
    questions: questionSchema.array(),
  }),
]);

export const historySchema = z.object({
  attempts: z
    .object({
      id: z.uuid(),
      kind: z.enum(["blanks", "questions"]),
      documentId: z.uuid(),
      title: z.string(),
      itemCount: z.int(),
      score: z.object({ correct: z.int(), almost: z.int(), wrong: z.int() }),
      createdAt: z.date(),
    })
    .array(),
});

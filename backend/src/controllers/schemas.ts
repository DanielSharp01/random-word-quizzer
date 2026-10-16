import { z } from "zod";

export const idParams = z.object({ id: z.uuid() });

const blockKindSchema = z.enum(["heading", "paragraph", "listItem"]);

export const blockSchema = z.object({ kind: blockKindSchema, text: z.string() });

export const documentSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  blockCount: z.int(),
  createdAt: z.date(),
});

const segmentSchema = z.union([z.object({ text: z.string() }), z.object({ blank: z.int(), length: z.int() })]);

export const answerSchema = z.object({
  blank: z.int(),
  guess: z.string(),
  verdict: z.enum(["correct", "almost", "wrong"]),
  reason: z.enum(["accent", "typo"]).nullable(),
  /** The word that was blanked, so the page can show it once the blank is answered. */
  answer: z.string(),
});

export const attemptSchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  title: z.string(),
  percent: z.int(),
  minLength: z.int(),
  blankCount: z.int(),
  blocks: z.object({ kind: blockKindSchema, segments: segmentSchema.array() }).array(),
  answers: answerSchema.array(),
});

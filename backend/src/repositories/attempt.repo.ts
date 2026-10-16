import { and, asc, eq } from "drizzle-orm";
import { answersTable, attemptsTable, documentsTable } from "../db/schema";
import type { Executor } from "../providers/db";
import type { BlankSettings } from "../quiz/blanks";
import type { Checked } from "../quiz/check";

export class AttemptRepository {
  constructor(private db: Executor) {}

  async create(userId: string, documentId: string, seed: number, settings: BlankSettings) {
    const [attempt] = await this.db
      .insert(attemptsTable)
      .values({ userId, documentId, seed, ...settings })
      .returning({ id: attemptsTable.id });
    return attempt!;
  }

  /** The attempt with what's needed to rebuild its blanks. */
  async find(userId: string, id: string) {
    const [attempt] = await this.db
      .select({
        id: attemptsTable.id,
        documentId: attemptsTable.documentId,
        title: documentsTable.title,
        blocks: documentsTable.blocks,
        seed: attemptsTable.seed,
        percent: attemptsTable.percent,
        minLength: attemptsTable.minLength,
      })
      .from(attemptsTable)
      .innerJoin(documentsTable, eq(documentsTable.id, attemptsTable.documentId))
      .where(and(eq(attemptsTable.id, id), eq(attemptsTable.userId, userId)));
    return attempt;
  }

  answers(attemptId: string) {
    return this.db
      .select({ blank: answersTable.blank, guess: answersTable.guess, verdict: answersTable.verdict, reason: answersTable.reason })
      .from(answersTable)
      .where(eq(answersTable.attemptId, attemptId))
      .orderBy(asc(answersTable.blank));
  }

  /** False when the blank was already answered. */
  async saveAnswer(attemptId: string, blank: number, guess: string, { verdict, reason }: Checked) {
    const saved = await this.db
      .insert(answersTable)
      .values({ attemptId, blank, guess, verdict, reason: reason ?? null })
      .onConflictDoNothing()
      .returning({ blank: answersTable.blank });
    return saved.length > 0;
  }
}

import { and, asc, count, desc, eq, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
import { answersTable, attemptsTable, documentsTable, questionsTable } from "../db/schema";
import type { Executor } from "../providers/db";
import type { BlankSettings } from "../quiz/blanks";
import type { Checked, Verdict } from "../quiz/check";
import type { Evaluation, GeneratedQuestion } from "../quiz/questions";

export type Score = Record<Verdict, number>;

const emptyScore = (): Score => ({ correct: 0, almost: 0, wrong: 0 });

export class AttemptRepository {
  constructor(private db: Executor) {}

  async createBlanks(userId: string, documentId: string, seed: number, settings: BlankSettings, itemCount: number) {
    const [attempt] = await this.db
      .insert(attemptsTable)
      .values({ userId, documentId, kind: "blanks", seed, ...settings, itemCount })
      .returning({ id: attemptsTable.id });
    return attempt!;
  }

  /** The attempt and its questions together, so a failed insert leaves no empty attempt behind. */
  async createQuestions(userId: string, documentId: string, fromBlock: number, toBlock: number, questions: GeneratedQuestion[]) {
    return this.db.transaction(async (tx) => {
      const [attempt] = await tx
        .insert(attemptsTable)
        .values({ userId, documentId, kind: "questions", fromBlock, toBlock, itemCount: questions.length })
        .returning({ id: attemptsTable.id });
      await tx.insert(questionsTable).values(questions.map((q, position) => ({ attemptId: attempt!.id, position, ...q })));
      return attempt!;
    });
  }

  /** The attempt with its document's blocks, which both kinds need to show it. */
  async find(userId: string, id: string) {
    const [attempt] = await this.db
      .select({
        id: attemptsTable.id,
        kind: attemptsTable.kind,
        documentId: attemptsTable.documentId,
        title: documentsTable.title,
        blocks: documentsTable.blocks,
        seed: attemptsTable.seed,
        percent: attemptsTable.percent,
        minLength: attemptsTable.minLength,
        fromBlock: attemptsTable.fromBlock,
        toBlock: attemptsTable.toBlock,
        createdAt: attemptsTable.createdAt,
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

  questions(attemptId: string) {
    return this.db.select().from(questionsTable).where(eq(questionsTable.attemptId, attemptId)).orderBy(asc(questionsTable.position));
  }

  async question(attemptId: string, position: number) {
    const [question] = await this.db
      .select()
      .from(questionsTable)
      .where(and(eq(questionsTable.attemptId, attemptId), eq(questionsTable.position, position)));
    return question;
  }

  /** False when the question was already answered. */
  async answerQuestion(attemptId: string, position: number, guess: string, evaluation: Evaluation) {
    const saved = await this.db
      .update(questionsTable)
      .set({ guess, ...evaluation, answeredAt: new Date() })
      .where(and(eq(questionsTable.attemptId, attemptId), eq(questionsTable.position, position), isNull(questionsTable.guess)))
      .returning({ position: questionsTable.position });
    return saved.length > 0;
  }

  /** Past attempts, newest first, each with its score so far. */
  async history(userId: string, documentId?: string) {
    const where: SQL[] = [eq(attemptsTable.userId, userId)];
    if (documentId) where.push(eq(attemptsTable.documentId, documentId));
    const attempts = await this.db
      .select({
        id: attemptsTable.id,
        kind: attemptsTable.kind,
        documentId: attemptsTable.documentId,
        title: documentsTable.title,
        itemCount: attemptsTable.itemCount,
        createdAt: attemptsTable.createdAt,
      })
      .from(attemptsTable)
      .innerJoin(documentsTable, eq(documentsTable.id, attemptsTable.documentId))
      .where(and(...where))
      .orderBy(desc(attemptsTable.createdAt));
    const ids = attempts.map((a) => a.id);
    if (ids.length === 0) return [];

    const tallies = [
      ...(await this.db
        .select({ attemptId: answersTable.attemptId, verdict: answersTable.verdict, n: count() })
        .from(answersTable)
        .where(inArray(answersTable.attemptId, ids))
        .groupBy(answersTable.attemptId, answersTable.verdict)),
      ...(await this.db
        .select({ attemptId: questionsTable.attemptId, verdict: questionsTable.verdict, n: count() })
        .from(questionsTable)
        .where(and(inArray(questionsTable.attemptId, ids), isNotNull(questionsTable.verdict)))
        .groupBy(questionsTable.attemptId, questionsTable.verdict)),
    ];
    const scores = new Map<string, Score>();
    for (const { attemptId, verdict, n } of tallies) {
      const score = scores.get(attemptId) ?? emptyScore();
      score[verdict!] += n;
      scores.set(attemptId, score);
    }
    return attempts.map((a) => ({ ...a, score: scores.get(a.id) ?? emptyScore() }));
  }
}

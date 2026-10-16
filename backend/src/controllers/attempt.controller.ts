import { BadRequest, Conflict, jsonResSend, NotFound, validateBody, validateParams, validateQuery } from "@danielsharp/typeline-http";
import { z } from "zod";
import { db } from "../providers/db";
import { blankScope } from "../quiz/blank-scope";
import { checkAnswer } from "../quiz/check";
import { evaluateAnswer } from "../quiz/questions";
import { sectionsOf } from "../quiz/sections";
import { AttemptRepository } from "../repositories/attempt.repo";
import { authedRouter } from "../routers";
import { answerSchema, attemptSchema, historySchema, idParams, questionSchema } from "./schemas";

const attempts = new AttemptRepository(db);

type FoundAttempt = NonNullable<Awaited<ReturnType<AttemptRepository["find"]>>>;

async function findAttempt(userId: string, id: string, kind?: FoundAttempt["kind"]) {
  const attempt = await attempts.find(userId, id);
  if (!attempt || (kind && attempt.kind !== kind)) throw new NotFound();
  return attempt;
}

const blanksOf = (attempt: FoundAttempt) =>
  blankScope(attempt.blocks, attempt.ranges, { percent: attempt.percent!, minLength: attempt.minLength! }, attempt.seed!, attempt.blankRules === 2 ? 2 : 1);

const sourceOf = (attempt: FoundAttempt, block: number) => attempt.blocks[block]?.text ?? "";

type StoredQuestion = Awaited<ReturnType<AttemptRepository["questions"]>>[number];

function questionView(attempt: FoundAttempt, q: StoredQuestion) {
  return {
    position: q.position,
    question: q.question,
    answered:
      q.guess === null
        ? null
        : { guess: q.guess, verdict: q.verdict!, feedback: q.feedback, checkedBy: q.checkedBy!, answer: q.answer, keyPoints: q.keyPoints, source: sourceOf(attempt, q.sourceBlock) },
  };
}

/** The attempt as the page shows it: blanks without their words and questions without their key until answered. */
export async function attemptView(userId: string, id: string): Promise<z.infer<typeof attemptSchema>> {
  const attempt = await findAttempt(userId, id);
  const base = { id: attempt.id, documentId: attempt.documentId, title: attempt.title, createdAt: attempt.createdAt };
  if (attempt.kind === "questions") {
    const whole = attempt.fromBlock === 0 && attempt.toBlock === attempt.blocks.length;
    const section = sectionsOf(attempt.blocks).find((s) => s.fromBlock === attempt.fromBlock && s.toBlock === attempt.toBlock);
    const questions = await attempts.questions(attempt.id);
    const label = whole ? "Teljes dokumentum" : (section?.title ?? attempt.title);
    return { ...base, kind: "questions", section: label, questions: questions.map((q) => questionView(attempt, q)) };
  }
  const { blocks, answers } = blanksOf(attempt);
  const given = await attempts.answers(id);
  return {
    ...base,
    kind: "blanks",
    scope: attempt.scopeLabel ?? "Teljes dokumentum",
    percent: attempt.percent!,
    minLength: attempt.minLength!,
    blankCount: answers.length,
    blocks,
    answers: given.map((a) => ({ ...a, answer: answers[a.blank]! })),
  };
}

export function attemptController() {
  const r = authedRouter.use({ metadata: { tags: ["Attempts"] } });

  r.get("/attempts", (line) =>
    line
      .pipe(validateQuery(z.object({ documentId: z.uuid().optional() })))
      .pipe(async ({ auth, query }) => {
        const history = await attempts.history(auth.userId, query.documentId);
        // Blanks attempts from before the count was stored get it from their rebuilt blanks.
        const counted = await Promise.all(
          history.map(async (a) => ({ ...a, itemCount: a.itemCount ?? blanksOf(await findAttempt(auth.userId, a.id)).answers.length })),
        );
        return { attempts: counted };
      })
      .pipe(jsonResSend(historySchema, 200)),
  );

  r.get("/attempts/:id", (line) =>
    line
      .pipe(validateParams(idParams))
      .pipe(({ auth, params }) => attemptView(auth.userId, params.id))
      .pipe(jsonResSend(attemptSchema, 200)),
  );

  r.post("/attempts/:id/answers", (line) =>
    line
      .pipe(validateParams(idParams))
      .pipe(validateBody(z.object({ blank: z.int().min(0), guess: z.string().max(200) })))
      .pipe(async ({ auth, params, body }) => {
        const { answers } = blanksOf(await findAttempt(auth.userId, params.id, "blanks"));
        const answer = answers[body.blank];
        if (answer === undefined) throw new BadRequest({ reason: "No such blank" });
        const checked = checkAnswer(answer, body.guess);
        if (!(await attempts.saveAnswer(params.id, body.blank, body.guess, checked))) {
          throw new Conflict({ reason: "Already answered" });
        }
        return { blank: body.blank, guess: body.guess, verdict: checked.verdict, reason: checked.reason ?? null, answer };
      })
      .pipe(jsonResSend(answerSchema, 201)),
  );

  r.post("/attempts/:id/questions/:position/answer", (line) =>
    line
      .pipe(validateParams(z.object({ id: z.uuid(), position: z.coerce.number().int().min(0) })))
      .pipe(validateBody(z.object({ answer: z.string().max(2000) })))
      .pipe(async ({ auth, params, body }) => {
        const attempt = await findAttempt(auth.userId, params.id, "questions");
        const question = await attempts.question(attempt.id, params.position);
        if (!question) throw new NotFound();
        if (question.guess !== null) throw new Conflict({ reason: "Already answered" });
        const evaluation = await evaluateAnswer(question, sourceOf(attempt, question.sourceBlock), body.answer);
        // A second, concurrent answer may have been graded meanwhile; the first one saved wins.
        if (!(await attempts.answerQuestion(attempt.id, params.position, body.answer, evaluation))) {
          throw new Conflict({ reason: "Already answered" });
        }
        return questionView(attempt, { ...question, guess: body.answer, ...evaluation });
      })
      .pipe(jsonResSend(questionSchema, 201)),
  );
}

import { BadRequest, Conflict, jsonResSend, NotFound, validateBody, validateParams } from "@danielsharp/typeline-http";
import { z } from "zod";
import { db } from "../providers/db";
import { blankDocument } from "../quiz/blanks";
import { checkAnswer } from "../quiz/check";
import { AttemptRepository } from "../repositories/attempt.repo";
import { authedRouter } from "../routers";
import { answerSchema, attemptSchema, idParams } from "./schemas";

const attempts = new AttemptRepository(db);

async function blankedAttempt(userId: string, id: string) {
  const attempt = await attempts.find(userId, id);
  if (!attempt) throw new NotFound();
  return { attempt, ...blankDocument(attempt.blocks, attempt, attempt.seed) };
}

/** The blanked document; a blank's word is only included once it's been answered. */
export async function attemptView(userId: string, id: string) {
  const { attempt, blocks, answers } = await blankedAttempt(userId, id);
  const given = await attempts.answers(id);
  return {
    id: attempt.id,
    documentId: attempt.documentId,
    title: attempt.title,
    percent: attempt.percent,
    minLength: attempt.minLength,
    blankCount: answers.length,
    blocks,
    answers: given.map((a) => ({ ...a, answer: answers[a.blank]! })),
  };
}

export function attemptController() {
  const r = authedRouter.use({ metadata: { tags: ["Attempts"] } });

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
        const { answers } = await blankedAttempt(auth.userId, params.id);
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
}

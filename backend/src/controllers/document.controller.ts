import { randomInt } from "node:crypto";
import {
  BadRequest,
  jsonResSend,
  NotFound,
  resEnd,
  setRequestDefaults,
  UnprocessableEntity,
  validateBody,
  validateMultipart,
  validateParams,
} from "@danielsharp/typeline-http";
import { z } from "zod";
import { db } from "../providers/db";
import { blankDocument } from "../quiz/blanks";
import { readDocx } from "../quiz/docx";
import { generateQuestions, MAX_SOURCE_CHARS } from "../quiz/questions";
import { sectionsOf } from "../quiz/sections";
import { AttemptRepository } from "../repositories/attempt.repo";
import { DocumentRepository } from "../repositories/document.repo";
import { authedRouter } from "../routers";
import { attemptView } from "./attempt.controller";
import { attemptSchema, blockSchema, documentSummarySchema, idParams, sectionSchema } from "./schemas";

const documents = new DocumentRepository(db);
const attempts = new AttemptRepository(db);

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const raiseBodySize = setRequestDefaults({ bodySize: MAX_UPLOAD_BYTES });

/** Questions first: a body without a kind is a blanks attempt, as before questions existed. */
const attemptSettingsSchema = z.union([
  z.object({
    kind: z.literal("questions"),
    /** A section's index, or null for the whole document. */
    section: z.int().min(0).nullable(),
    count: z.int().min(1).max(15).default(5),
  }),
  z.object({
    kind: z.literal("blanks").default("blanks"),
    percent: z.int().min(5).max(60).default(20),
    minLength: z.int().min(1).max(20).default(6),
  }),
]);

async function blocksOf(file: File) {
  try {
    return await readDocx(Buffer.from(await file.arrayBuffer()));
  } catch {
    throw new UnprocessableEntity({ reason: "Not a readable .docx file" });
  }
}

export function documentController() {
  const r = authedRouter.use({ metadata: { tags: ["Documents"] } });

  r.post("/documents", (line) =>
    line
      // Called through an arrow: passed directly, its generic input collapses to `object` and `auth` is lost.
      .pipe((input, ctx) => raiseBodySize(input, ctx))
      .pipe(validateMultipart(z.object({ file: z.file().max(MAX_UPLOAD_BYTES) })))
      .pipe(async ({ auth, body: { file } }) => {
        const blocks = await blocksOf(file);
        if (blocks.length === 0) throw new UnprocessableEntity({ reason: "The document has no text" });
        const title = file.name.replace(/\.docx$/i, "").trim() || "Névtelen dokumentum";
        return documents.create(auth.userId, title, blocks);
      })
      .pipe(jsonResSend(documentSummarySchema, 201)),
  );

  r.get("/documents", (line) =>
    line
      .pipe(async ({ auth }) => ({ documents: await documents.list(auth.userId) }))
      .pipe(jsonResSend(z.object({ documents: documentSummarySchema.array() }), 200)),
  );

  r.get("/documents/:id", (line) =>
    line
      .pipe(validateParams(idParams))
      .pipe(async ({ auth, params }) => {
        const document = await documents.find(auth.userId, params.id);
        if (!document) throw new NotFound();
        return document;
      })
      .pipe(jsonResSend(z.object({ id: z.uuid(), title: z.string(), blocks: blockSchema.array() }), 200)),
  );

  r.delete("/documents/:id", (line) =>
    line
      .pipe(validateParams(idParams))
      .pipe(async ({ auth, params }) => {
        if (!(await documents.delete(auth.userId, params.id))) throw new NotFound();
      })
      .pipe(resEnd(204)),
  );

  r.get("/documents/:id/sections", (line) =>
    line
      .pipe(validateParams(idParams))
      .pipe(async ({ auth, params }) => {
        const document = await documents.find(auth.userId, params.id);
        if (!document) throw new NotFound();
        return { sections: sectionsOf(document.blocks), maxChars: MAX_SOURCE_CHARS };
      })
      .pipe(jsonResSend(z.object({ sections: sectionSchema.array(), maxChars: z.int() }), 200)),
  );

  r.post("/documents/:id/attempts", (line) =>
    line
      .pipe(validateParams(idParams))
      .pipe(validateBody(attemptSettingsSchema))
      .pipe(async ({ auth, params, body }) => {
        const document = await documents.find(auth.userId, params.id);
        if (!document) throw new NotFound();
        if (body.kind === "blanks") {
          const settings = { percent: body.percent, minLength: body.minLength };
          const seed = randomInt(2 ** 31);
          const { answers } = blankDocument(document.blocks, settings, seed);
          const { id } = await attempts.createBlanks(auth.userId, params.id, seed, settings, answers.length);
          return attemptView(auth.userId, id);
        }
        const whole = { fromBlock: 0, toBlock: document.blocks.length };
        const range = body.section === null ? whole : sectionsOf(document.blocks)[body.section];
        if (!range) throw new BadRequest({ reason: "No such section" });
        const chars = document.blocks.slice(range.fromBlock, range.toBlock).reduce((sum, b) => sum + b.text.length, 0);
        if (chars > MAX_SOURCE_CHARS) throw new UnprocessableEntity({ reason: "too_long", maxChars: MAX_SOURCE_CHARS });
        const questions = await generateQuestions(document.blocks, range.fromBlock, range.toBlock, body.count);
        const { id } = await attempts.createQuestions(auth.userId, params.id, range.fromBlock, range.toBlock, questions);
        return attemptView(auth.userId, id);
      })
      .pipe(jsonResSend(attemptSchema, 201)),
  );
}

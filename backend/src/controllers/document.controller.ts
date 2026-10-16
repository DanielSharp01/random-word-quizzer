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
import { generateQuestions } from "../quiz/questions";
import { fitsInOneCall, sectionsOf, wholeDocumentSource } from "../quiz/sections";
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
        const sections = sectionsOf(document.blocks);
        // A single section spanning the document would just repeat the whole-document choice.
        const whole = sections.length === 1 && sections[0]!.fromBlock === 0 && sections[0]!.toBlock === document.blocks.length;
        return { sections: whole ? [] : sections, wholeIsSampled: !fitsInOneCall(document.blocks) };
      })
      .pipe(jsonResSend(z.object({ sections: sectionSchema.array(), wholeIsSampled: z.boolean() }), 200)),
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
        // The attempt keeps what was asked for; a long document is sent as a sample of its sections.
        const scope = body.section === null ? { fromBlock: 0, toBlock: document.blocks.length } : sectionsOf(document.blocks)[body.section];
        if (!scope) throw new BadRequest({ reason: "No such section" });
        const source = body.section === null ? wholeDocumentSource(document.blocks) : [scope];
        const questions = await generateQuestions(document.blocks, source, body.count);
        const { id } = await attempts.createQuestions(auth.userId, params.id, scope.fromBlock, scope.toBlock, questions);
        return attemptView(auth.userId, id);
      })
      .pipe(jsonResSend(attemptSchema, 201)),
  );
}

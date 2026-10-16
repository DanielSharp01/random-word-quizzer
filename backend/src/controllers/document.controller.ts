import { randomInt } from "node:crypto";
import {
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
import { readDocx } from "../quiz/docx";
import { AttemptRepository } from "../repositories/attempt.repo";
import { DocumentRepository } from "../repositories/document.repo";
import { authedRouter } from "../routers";
import { attemptView } from "./attempt.controller";
import { attemptSchema, blockSchema, documentSummarySchema, idParams } from "./schemas";

const documents = new DocumentRepository(db);
const attempts = new AttemptRepository(db);

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const raiseBodySize = setRequestDefaults({ bodySize: MAX_UPLOAD_BYTES });

const attemptSettingsSchema = z.object({
  percent: z.int().min(5).max(60).default(20),
  minLength: z.int().min(1).max(20).default(6),
});

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

  r.post("/documents/:id/attempts", (line) =>
    line
      .pipe(validateParams(idParams))
      .pipe(validateBody(attemptSettingsSchema))
      .pipe(async ({ auth, params, body }) => {
        if (!(await documents.find(auth.userId, params.id))) throw new NotFound();
        const { id } = await attempts.create(auth.userId, params.id, randomInt(2 ** 31), body);
        return attemptView(auth.userId, id);
      })
      .pipe(jsonResSend(attemptSchema, 201)),
  );
}

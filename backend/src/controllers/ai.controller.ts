import { jsonResSend, resEnd, validateBody } from "@danielsharp/typeline-http";
import { z } from "zod";
import * as ai from "../ai/connection";
import { ownerRouter } from "../routers";

const statusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  broken: z.boolean(),
  accountEmail: z.string().nullable(),
  model: z.string().nullable(),
  hourlyTokenLimit: z.int(),
  dailyTokenLimit: z.int(),
  maxOutputTokens: z.int(),
  usage: z.object({ lastHour: z.int(), lastDay: z.int() }),
  usageByHour: z.object({ hour: z.date(), calls: z.int(), totalTokens: z.int(), estimatedCalls: z.int() }).array(),
});

const settingsSchema = z.object({
  model: z.string().min(1).max(100).nullable(),
  hourlyTokenLimit: z.int().min(0).max(10_000_000),
  dailyTokenLimit: z.int().min(0).max(100_000_000),
  maxOutputTokens: z.int().min(50).max(100_000),
});

/** Behind /manage-ai: the owner signs in to share their ChatGPT plan, picks a model, sets the limits and tries it. */
export function aiController() {
  const r = ownerRouter.use({ metadata: { tags: ["AI"] } });

  r.get("/ai/connection", (line) => line.pipe(() => ai.status()).pipe(jsonResSend(statusSchema, 200)));

  r.post("/ai/connection/start", (line) =>
    line.pipe(async () => ({ authorizeUrl: await ai.startConnecting() })).pipe(jsonResSend(z.object({ authorizeUrl: z.url() }), 200)),
  );

  r.post("/ai/connection/finish", (line) =>
    line
      .pipe(validateBody(z.object({ callbackUrl: z.string().max(4000) })))
      .pipe(async ({ body }) => {
        await ai.finishConnecting(body.callbackUrl);
        return ai.status();
      })
      .pipe(jsonResSend(statusSchema, 200)),
  );

  r.delete("/ai/connection", (line) => line.pipe(() => ai.disconnect()).pipe(resEnd(204)));

  r.get("/ai/models", (line) =>
    line
      .pipe(async () => ({ models: await ai.models() }))
      .pipe(jsonResSend(z.object({ models: z.object({ slug: z.string(), name: z.string() }).array() }), 200)),
  );

  r.put("/ai/settings", (line) =>
    line
      .pipe(validateBody(settingsSchema))
      .pipe(async ({ body }) => {
        await ai.saveSettings(body);
        return ai.status();
      })
      .pipe(jsonResSend(statusSchema, 200)),
  );

  r.post("/ai/try", (line) =>
    line
      .pipe(validateBody(z.object({ input: z.string().min(1).max(2000) })))
      // Sent bare, with no instructions, so the answer shows the connection and model as they are.
      .pipe(({ body }) => ai.ask({ input: body.input }))
      .pipe(
        jsonResSend(
          z.object({ text: z.string(), truncated: z.boolean(), usage: z.object({ inputTokens: z.int(), outputTokens: z.int(), totalTokens: z.int() }) }),
          200,
        ),
      ),
  );
}

import { jsonResSend, NotFound } from "@danielsharp/typeline-http";
import { z } from "zod";
import { db } from "../providers/db";
import { findUser } from "../repositories/user.repo";
import { authedRouter } from "../routers";

const meResponseSchema = z.object({ id: z.uuid(), email: z.string().nullable(), name: z.string().nullable(), isOwner: z.boolean() });

export function meController() {
  authedRouter.use({ metadata: { tags: ["Me"] } }).get("/me", (line) =>
    line
      .pipe(async ({ auth }) => {
        const user = await findUser(db, auth.userId);
        if (!user) throw new NotFound();
        return user;
      })
      .pipe(jsonResSend(meResponseSchema, 200)),
  );
}

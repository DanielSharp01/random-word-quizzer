import { jsonResSend, NotFound, resEnd, validateBody, validateParams } from "@danielsharp/typeline-http";
import { z } from "zod";
import { db } from "../providers/db";
import { inviteLink, UserRepository } from "../repositories/user.repo";
import { ownerRouter } from "../routers";
import { idParams } from "./schemas";

const users = new UserRepository(db);

const issuedSchema = z.object({ id: z.uuid(), url: z.url(), expiresAt: z.date() });

const pendingSchema = z.object({
  invites: z.object({ id: z.uuid(), name: z.string().nullable(), expiresAt: z.date().nullable(), createdAt: z.date() }).array(),
});

/** Behind the owner's invite page: the same invites as `pnpm invite`, without a terminal. */
export function inviteController() {
  const r = ownerRouter.use({ metadata: { tags: ["Invites"] } });

  r.post("/invites", (line) =>
    line
      .pipe(validateBody(z.object({ name: z.string().trim().min(1).max(100) })))
      .pipe(async ({ body }) => {
        const invite = await users.invite(body.name);
        return { id: invite.id, url: inviteLink(invite.token), expiresAt: invite.expiresAt };
      })
      .pipe(jsonResSend(issuedSchema, 201)),
  );

  r.get("/invites", (line) => line.pipe(async () => ({ invites: await users.pendingInvites() })).pipe(jsonResSend(pendingSchema, 200)));

  r.post("/invites/:id/renew", (line) =>
    line
      .pipe(validateParams(idParams))
      .pipe(async ({ params }) => {
        const invite = await users.renewInvite(params.id);
        if (!invite) throw new NotFound();
        return { id: invite.id, url: inviteLink(invite.token), expiresAt: invite.expiresAt };
      })
      .pipe(jsonResSend(issuedSchema, 200)),
  );

  r.delete("/invites/:id", (line) =>
    line
      .pipe(validateParams(idParams))
      .pipe(async ({ params }) => {
        if (!(await users.cancelInvite(params.id))) throw new NotFound();
      })
      .pipe(resEnd(204)),
  );
}

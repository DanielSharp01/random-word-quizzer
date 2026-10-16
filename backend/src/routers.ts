import { tapInput } from "@danielsharp/typeline";
import { Forbidden, router } from "@danielsharp/typeline-http";
import { auth } from "./providers/auth";
import { db } from "./providers/db";
import { findUser } from "./repositories/user.repo";

export const rootRouter = router();

export const apiRouter = rootRouter
  .scope("/api")
  .use({ metadata: { openApi: true } });

export const authedRouter = apiRouter.use(auth.required());

/** Checked against the database on every request, so revoking ownership takes effect at once. */
export const ownerRouter = authedRouter.use(
  tapInput(async ({ auth }: { auth: { userId: string } }) => {
    if (!(await findUser(db, auth.userId))?.isOwner) throw new Forbidden({ reason: "Only the owner can do this" });
  }),
);

import { router } from "@danielsharp/typeline-http";
import { auth } from "./providers/auth";

export const rootRouter = router();

export const apiRouter = rootRouter
  .scope("/api")
  .use({ metadata: { openApi: true } });

export const authedRouter = apiRouter.use(auth.required());

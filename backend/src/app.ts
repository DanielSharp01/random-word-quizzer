import { defaultErrorHandler } from "@danielsharp/typeline-http";
import { controllers } from "./controllers";
import { isExpected, mapError } from "./http/errors";
import { logger } from "./providers/logger";
import { rootRouter } from "./routers";

export const onError = defaultErrorHandler((error) => {
  if (!isExpected(error)) logger.error("Error", error as any);
  return mapError(error);
});

/** Registers every route and compiles the router; call once per process. */
export function createApp() {
  controllers();
  rootRouter.compile();
  return rootRouter;
}

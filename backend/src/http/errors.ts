import {
  BadGateway,
  BadRequest,
  Conflict,
  HttpValidationError,
  isHttpError,
  ServiceUnavailable,
  TooManyRequests,
  type HttpError,
  UnprocessableEntity,
} from "@danielsharp/typeline-http";
import { authErrorMapper } from "@danielsharp/http-auth";
import { z } from "zod";
import { ChatGptError } from "../ai/chatgpt";
import { AiLimitReached, AiUnavailable, CallbackRejected } from "../ai/connection";

const pgError = z.object({ code: z.string(), constraint: z.string().optional() });

/** Drizzle wraps driver errors, so the Postgres one may sit on `cause`. */
function findPgError(error: unknown) {
  for (let e: unknown = error, depth = 0; e && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const parsed = pgError.safeParse(e);
    if (parsed.success && /^[0-9A-Z]{5}$/.test(parsed.data.code)) return parsed.data;
  }
  return undefined;
}

export function mapError(error: unknown): HttpError | undefined {
  const auth = authErrorMapper(error);
  if (auth) return auth;
  if (error instanceof AiUnavailable) return new ServiceUnavailable({ reason: error.reason });
  if (error instanceof AiLimitReached) return new TooManyRequests({ window: error.window });
  if (error instanceof CallbackRejected) return new BadRequest({ reason: error.reason });
  if (error instanceof ChatGptError) return new BadGateway({ ...(error.code ? { code: error.code } : {}) });
  if (HttpValidationError.is(error)) {
    const issues = error.cause instanceof z.ZodError ? error.cause.issues : undefined;
    return new BadRequest({ source: error.source, ...(issues ? { issues } : {}) });
  }
  const pg = findPgError(error);
  if (!pg) return undefined;
  const constraint = pg.constraint ? { constraint: pg.constraint } : {};
  switch (pg.code) {
    case "23505":
      return new Conflict({ reason: "Already exists", ...constraint });
    case "23503":
      return new UnprocessableEntity({ reason: "Refers to a row that doesn't exist or is still in use", ...constraint });
    case "23514":
    case "23502":
      return new UnprocessableEntity({ reason: "Breaks a data rule", ...constraint });
    case "22007":
    case "22008":
    case "22P02":
    case "22003":
      return new BadRequest({ reason: "Value out of range" });
    default:
      return undefined;
  }
}

/** Errors the client caused aren't worth a stack trace in the log; OpenAI failing is worth one. */
export const isExpected = (error: unknown) => !(error instanceof ChatGptError) && (isHttpError(error) || mapError(error) !== undefined);

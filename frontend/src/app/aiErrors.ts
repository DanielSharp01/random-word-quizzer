import { ApiError } from "../api/client";

/** What someone quizzing sees when an AI step fails; the owner gets the details on /manage-ai. */
export function aiErrorText(error: unknown) {
  if (!(error instanceof ApiError)) return "Valami hiba történt. Próbáld újra.";
  if (error.status === 429) return `Az AI ${error.body.window === "day" ? "mai" : "óránkénti"} kerete elfogyott. Próbáld később.`;
  if (error.status === 422 && error.body.reason === "too_long") return "Ez a rész túl hosszú egyszerre. Válassz egy kisebb fejezetet.";
  if (error.status === 503 && error.body.reason === "plan_limit") return "Az AI kerete most elfogyott. Próbáld később.";
  if (error.status === 503) return "Az AI most nem érhető el. Szólj a Quizzer tulajdonosának.";
  if (error.status === 502) return "Az AI nem adott használható választ. Próbáld újra.";
  return error.message;
}

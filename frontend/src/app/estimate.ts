import type { BlankStats } from "../api/quiz.api";

/** Must match MIN_WORDS_BETWEEN in the backend's blanking rules. */
const WORDS_BETWEEN_BLANKS = 3;

/**
 * About how many blanks a part will get. Each blank keeps the next few words from being blanked,
 * which takes more off the plain candidates × rate the denser the candidates and the higher the
 * rate; on real documents this lands within a few percent.
 */
export function estimateBlanks({ candidates, total }: BlankStats, percent: number, minLength: number) {
  const eligible = candidates.slice(Math.max(0, minLength)).reduce((sum, n) => sum + n, 0);
  const rate = percent / 100;
  const share = total > 0 ? eligible / total : 0;
  return Math.round((eligible * rate) / (1 + WORDS_BETWEEN_BLANKS * rate * share));
}

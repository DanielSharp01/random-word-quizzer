export type Verdict = "correct" | "almost" | "wrong";
export type AlmostReason = "accent" | "typo";
export type Checked = { verdict: Verdict; reason?: AlmostReason };

const normalize = (value: string) => value.normalize("NFC").trim().toLocaleLowerCase("hu");
const withoutAccents = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");

/** Optimal string alignment distance: insertions, deletions, substitutions and swapped neighbours. */
function editDistance(a: string[], b: string[]) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/** Longer words tolerate more slips; a short word with a wrong letter is usually a different word. */
function allowedTypos(length: number) {
  if (length >= 10) return 2;
  if (length >= 4) return 1;
  return 0;
}

/** Case never matters. Missing or wrong accents, and a typo or two, count as almost right. */
export function checkAnswer(answer: string, guess: string): Checked {
  const expected = normalize(answer);
  const given = normalize(guess);
  if (given === expected) return { verdict: "correct" };
  if (!given) return { verdict: "wrong" };
  const bareExpected = [...withoutAccents(expected)];
  const bareGiven = [...withoutAccents(given)];
  const distance = editDistance(bareExpected, bareGiven);
  if (distance === 0) return { verdict: "almost", reason: "accent" };
  if (distance <= allowedTypos(bareExpected.length)) return { verdict: "almost", reason: "typo" };
  return { verdict: "wrong" };
}

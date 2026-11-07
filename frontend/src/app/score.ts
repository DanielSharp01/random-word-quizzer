/** Almost counts as half, so a run full of near-misses doesn't look like a perfect one. */
export function percentOf({ correct, almost }: { correct: number; almost: number }, itemCount: number) {
  return itemCount === 0 ? 0 : Math.round(((correct + almost / 2) / itemCount) * 100);
}

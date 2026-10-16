import { blankDocument, type BlankRules, type BlankSettings, type Block, type QuizBlock } from "./blanks";
import { sectionsOf, type BlockRange } from "./sections";

export type ScopedQuizBlock = QuizBlock & { gapBefore?: true };

/**
 * The blanks of an attempt over some parts of a document, rebuilt from its seed. Titles found in a
 * plain-text document show as headings, and a part that doesn't follow on from the previous one is
 * marked, so the page can show the skipped text.
 */
export function blankScope(blocks: Block[], ranges: BlockRange[] | null, settings: BlankSettings, seed: number, rules: BlankRules) {
  const parts = ranges ?? [{ fromBlock: 0, toBlock: blocks.length }];
  const titles = new Set(sectionsOf(blocks).flatMap((s) => (s.titled ? [s.fromBlock] : [])));
  const shown = parts.flatMap((part, p) =>
    blocks.slice(part.fromBlock, part.toBlock).map((block, i) => ({
      block: titles.has(part.fromBlock + i) ? { ...block, kind: "heading" as const } : block,
      gapBefore: p > 0 && i === 0 && part.fromBlock !== parts[p - 1]!.toBlock,
    })),
  );
  const { blocks: quiz, answers } = blankDocument(
    shown.map((s) => s.block),
    settings,
    seed,
    rules,
  );
  return { blocks: quiz.map((block, i): ScopedQuizBlock => (shown[i]!.gapBefore ? { ...block, gapBefore: true } : block)), answers };
}

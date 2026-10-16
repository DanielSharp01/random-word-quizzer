import type { Block } from "./blanks";

export type Section = { index: number; title: string; fromBlock: number; toBlock: number; chars: number };

/**
 * The document split at its headings; each section runs to the next heading. Text before the
 * first heading is its own section, and a document without headings is a single one.
 */
export function sectionsOf(blocks: Block[]): Section[] {
  const starts = blocks.flatMap((block, i) => (block.kind === "heading" ? [i] : []));
  if (starts[0] !== 0) starts.unshift(0);
  return starts
    .map((fromBlock, i) => {
      const toBlock = starts[i + 1] ?? blocks.length;
      const first = blocks[fromBlock]!;
      const title = first.kind === "heading" ? first.text : starts.length === 1 ? "Teljes dokumentum" : "Bevezető";
      const chars = blocks.slice(fromBlock, toBlock).reduce((sum, b) => sum + b.text.length, 0);
      return { fromBlock, toBlock, title, chars };
    })
    .filter((s) => s.toBlock - s.fromBlock > 1 || blocks[s.fromBlock]!.kind !== "heading")
    .map((s, index) => ({ index, ...s }));
}

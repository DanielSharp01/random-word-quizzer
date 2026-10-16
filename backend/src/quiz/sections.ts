import type { Block } from "./blanks";

/** About 8k tokens of Hungarian; longer passages make for vaguer questions and a costlier call. */
export const MAX_SOURCE_CHARS = 24_000;

export type Section = { index: number; title: string; fromBlock: number; toBlock: number; chars: number };

/**
 * For documents without Word heading styles, like regulations typed as plain paragraphs: a title is
 * a short line starting with a capital, without the closing punctuation of a sentence or list item.
 * Numbered points ("8. …", "a) …") are never titles; "II. fejezet" always is.
 */
export function looksLikeTitle(text: string) {
  if (/^[IVXLCDM]+\.\s*fejezet$/i.test(text)) return true;
  if (text.length > 80 || /[.,;:]$/.test(text)) return false;
  if (/^(\d|\(|\p{Ll}{1,2}\))/u.test(text)) return false;
  return /^\p{Lu}/u.test(text);
}

const charsOf = (blocks: Block[], fromBlock: number, toBlock: number) => blocks.slice(fromBlock, toBlock).reduce((sum, b) => sum + b.text.length, 0);

const paragraphs = ({ fromBlock, toBlock }: { fromBlock: number; toBlock: number }) =>
  toBlock - fromBlock === 1 ? `${toBlock}. bekezdés` : `${fromBlock + 1}–${toBlock}. bekezdés`;

/** Cuts a run of blocks into consecutive parts of at most `max` characters, at block boundaries. */
function split(blocks: Block[], fromBlock: number, toBlock: number, max: number) {
  const parts: { fromBlock: number; toBlock: number }[] = [];
  let start = fromBlock;
  let chars = 0;
  for (let i = fromBlock; i < toBlock; i++) {
    const length = blocks[i]!.text.length;
    if (i > start && chars + length > max) {
      parts.push({ fromBlock: start, toBlock: i });
      start = i;
      chars = 0;
    }
    chars += length;
  }
  parts.push({ fromBlock: start, toBlock });
  return parts;
}

/**
 * The document split at its headings, or at the lines that look like titles when it has none. Text
 * before the first title is its own section, a title with nothing under it isn't one, and a section
 * too long to send in one AI call is cut into numbered parts.
 */
export function sectionsOf(blocks: Block[], max = MAX_SOURCE_CHARS): Section[] {
  const hasHeadings = blocks.some((b) => b.kind === "heading");
  const isTitle = (b: Block) => (hasHeadings ? b.kind === "heading" : looksLikeTitle(b.text));
  const starts = blocks.flatMap((block, i) => (isTitle(block) ? [i] : []));
  if (starts[0] !== 0) starts.unshift(0);

  const sections = starts
    .map((fromBlock, i) => ({ fromBlock, toBlock: starts[i + 1] ?? blocks.length }))
    .filter((s) => s.toBlock - s.fromBlock > 1 || !isTitle(blocks[s.fromBlock]!))
    .flatMap(({ fromBlock, toBlock }) => {
      const first = blocks[fromBlock]!;
      const title = isTitle(first) ? first.text : starts.length > 1 ? "Bevezető" : "Szöveg";
      const parts = split(blocks, fromBlock, toBlock, max);
      return parts.map((part, i) => ({
        ...part,
        title: parts.length === 1 ? title : `${title} (${i + 1}. rész, ${paragraphs(part)})`,
      }));
    });
  return sections.map((s, index) => ({ index, ...s, chars: charsOf(blocks, s.fromBlock, s.toBlock) }));
}

export type BlockRange = { fromBlock: number; toBlock: number };

export const fitsInOneCall = (blocks: Block[], max = MAX_SOURCE_CHARS) => charsOf(blocks, 0, blocks.length) <= max;

/**
 * What to send for the whole document: all of it when it fits, otherwise sections picked at random
 * until the budget is used, in document order, so each attempt draws on different parts of it.
 */
export function wholeDocumentSource(blocks: Block[], random: () => number = Math.random, max = MAX_SOURCE_CHARS): BlockRange[] {
  if (fitsInOneCall(blocks, max)) return [{ fromBlock: 0, toBlock: blocks.length }];
  const shuffled = sectionsOf(blocks, max)
    .map((section) => ({ section, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ section }) => section);
  const picked: Section[] = [];
  let chars = 0;
  for (const section of shuffled) {
    if (chars + section.chars > max) continue;
    picked.push(section);
    chars += section.chars;
  }
  // Only a single paragraph longer than the budget leaves nothing picked; it gets cut when sent.
  if (picked.length === 0) picked.push(shuffled[0]!);
  return picked.sort((a, b) => a.fromBlock - b.fromBlock).map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock }));
}

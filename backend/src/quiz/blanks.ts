export type BlockKind = "heading" | "paragraph" | "listItem";
export type Block = { kind: BlockKind; text: string };

export type Segment = { text: string } | { blank: number; length: number };
export type QuizBlock = { kind: BlockKind; segments: Segment[] };

export interface BlankSettings {
  /** Chance, in percent, that an eligible word is blanked. */
  percent: number;
  /** Words shorter than this many letters are never blanked. */
  minLength: number;
}

const words = new Intl.Segmenter("hu", { granularity: "word" });

/** mulberry32: small and seedable, so an attempt's blanks can be rebuilt from its seed alone. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Blanks random words, never two in a row, so each blank keeps a word of context on both sides.
 * The same blocks, settings and seed always give the same blanks.
 */
export function blankDocument(blocks: Block[], { percent, minLength }: BlankSettings, seed: number) {
  const random = seededRandom(seed);
  const answers: string[] = [];
  const quizBlocks = blocks.map((block): QuizBlock => {
    const segments: Segment[] = [];
    let previousBlanked = false;
    for (const { segment, isWordLike } of words.segment(block.text)) {
      const length = [...segment].length;
      if (isWordLike && !previousBlanked && length >= minLength && random() < percent / 100) {
        segments.push({ blank: answers.length, length });
        answers.push(segment);
        previousBlanked = true;
        continue;
      }
      if (isWordLike) previousBlanked = false;
      const last = segments.at(-1);
      if (last && "text" in last) last.text += segment;
      else segments.push({ text: segment });
    }
    return { kind: block.kind, segments };
  });
  return { blocks: quizBlocks, answers };
}

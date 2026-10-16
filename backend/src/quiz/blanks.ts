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
 * Which rules picked an attempt's blanks. Attempts store it, so changing the rules never changes
 * the blanks of one already started: 1 is the original, 2 keeps blanks apart and off weak spots.
 */
export type BlankRules = 1 | 2;
export const CURRENT_BLANK_RULES: BlankRules = 2;

/** Visible words that must separate two blanks, so a blank never reads as part of a run of them. */
const MIN_WORDS_BETWEEN = 3;

/**
 * Hungarian function words long enough to pass a minimum length: blanking them tests guessing
 * rather than knowing the text. Postpositions like "szerint" belong here too.
 */
const FUNCTION_WORDS = new Set(
  [
    "valamint", "továbbá", "illetve", "illetőleg", "azonban", "viszont", "ugyanakkor", "amennyiben", "ameddig", "mindaddig",
    "amely", "amelyet", "amelyek", "amelyeket", "amelynek", "amelyeknek", "amelyben", "amelyekben", "amelyre", "amelyről", "amellyel",
    "aminek", "amiben", "amire", "amiről", "akinek", "akiket", "akivel", "akiről", "akire", "ahogyan", "amikor",
    "szerint", "esetén", "esetében", "alapján", "keretében", "során", "részére", "számára", "között", "közötti",
    "kívül", "mellett", "nélkül", "helyett", "tekintetében", "vonatkozásában", "érdekében", "következtében",
    "minden", "valamennyi", "bármely", "bármilyen", "egyéb", "további", "ennek", "annak", "ezeket", "azokat", "ezekben", "azokban",
    "lehet", "lehetnek", "kell", "kíván", "ilyen", "olyan", "továbbiakban", "egyben", "egyaránt", "kizárólag", "különösen",
  ].map((w) => w.toLocaleLowerCase("hu")),
);

/** Anything but spaces between two words: punctuation, a quote, a bracket, a dash. */
const PUNCTUATION = /[^\s]/u;

/** The rules 2 checks that depend only on the word and what's before it, not on earlier blanks. */
function hasContext(word: string, separator: string, first: boolean) {
  return !first && !PUNCTUATION.test(separator) && !FUNCTION_WORDS.has(word.toLocaleLowerCase("hu")) && !/^\p{N}+$/u.test(word);
}

function append(segments: Segment[], text: string) {
  const last = segments.at(-1);
  if (last && "text" in last) last.text += text;
  else segments.push({ text });
}

/** Rules 1, kept exactly, random draws included: never two words in a row. */
function blankBlockV1(block: Block, chance: number, minLength: number, random: () => number, answers: string[]): QuizBlock {
  const segments: Segment[] = [];
  let previousBlanked = false;
  for (const { segment, isWordLike } of words.segment(block.text)) {
    const length = [...segment].length;
    if (isWordLike && !previousBlanked && length >= minLength && random() < chance) {
      segments.push({ blank: answers.length, length });
      answers.push(segment);
      previousBlanked = true;
      continue;
    }
    if (isWordLike) previousBlanked = false;
    append(segments, segment);
  }
  return { kind: block.kind, segments };
}

/**
 * Rules 2: a word can be blanked only with context to lean on. Never the first word of a block or
 * one right after punctuation (a sentence, clause or "a)" item starting), never a function word or a
 * bare number, and never within MIN_WORDS_BETWEEN words of the previous blank.
 */
function blankBlockV2(block: Block, chance: number, minLength: number, random: () => number, answers: string[]): QuizBlock {
  const segments: Segment[] = [];
  let wordsSinceBlank = MIN_WORDS_BETWEEN;
  let separator = "";
  let first = true;
  for (const { segment, isWordLike } of words.segment(block.text)) {
    if (!isWordLike) {
      separator += segment;
      append(segments, segment);
      continue;
    }
    const length = [...segment].length;
    const eligible = length >= minLength && wordsSinceBlank >= MIN_WORDS_BETWEEN && hasContext(segment, separator, first);
    if (eligible && random() < chance) {
      segments.push({ blank: answers.length, length });
      answers.push(segment);
      wordsSinceBlank = 0;
    } else {
      append(segments, segment);
      wordsSinceBlank++;
    }
    separator = "";
    first = false;
  }
  return { kind: block.kind, segments };
}

/** Blanks random words by the given rules. The same blocks, settings, seed and rules always give the same blanks. */
export function blankDocument(blocks: Block[], { percent, minLength }: BlankSettings, seed: number, rules: BlankRules = CURRENT_BLANK_RULES) {
  const random = seededRandom(seed);
  const answers: string[] = [];
  const blankBlock = rules === 1 ? blankBlockV1 : blankBlockV2;
  const quizBlocks = blocks.map((block) => blankBlock(block, percent / 100, minLength, random, answers));
  return { blocks: quizBlocks, answers };
}

/** Highest word length counted on its own; longer words share the last slot. */
const LONGEST_COUNTED = 30;

/**
 * What a page needs to estimate the blanks for any minimum length and rate without asking again:
 * `candidates[n]` words of n letters that the current rules could blank (the last slot n or more),
 * and the total number of words, which sets how often the gap after a blank skips a candidate.
 */
export function blankStats(blocks: Block[]) {
  const candidates = new Array<number>(LONGEST_COUNTED + 1).fill(0);
  let total = 0;
  for (const block of blocks) {
    let separator = "";
    let first = true;
    for (const { segment, isWordLike } of words.segment(block.text)) {
      if (!isWordLike) {
        separator += segment;
        continue;
      }
      total++;
      if (hasContext(segment, separator, first)) candidates[Math.min([...segment].length, LONGEST_COUNTED)]!++;
      separator = "";
      first = false;
    }
  }
  return { candidates, total };
}

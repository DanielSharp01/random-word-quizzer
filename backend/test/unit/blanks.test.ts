import { describe, expect, it } from "vitest";
import { blankDocument, blankStats, type Block, type Segment } from "../../src/quiz/blanks";

const text = "Az ellenőrzés célja, hogy előmozdítsa a rendőrség törvényes, szakszerű, eredményes és hatékony működését.";
const blocks: Block[] = [
  { kind: "heading", text: "Az ellenőrzés célja" },
  { kind: "paragraph", text },
];

/** Puts each answer back into its blank. */
const restore = (segments: Segment[], answers: string[]) => segments.map((s) => ("text" in s ? s.text : answers[s.blank])).join("");

/** Word segments of a paragraph in order, with each one's blank number when it was blanked. */
function wordsOf(segments: Segment[]) {
  const seg = new Intl.Segmenter("hu", { granularity: "word" });
  return segments.flatMap((s) =>
    "text" in s ? [...seg.segment(s.text)].map((w) => ({ word: w.segment, isWord: w.isWordLike, blank: false })) : [{ word: "", isWord: true, blank: true }],
  );
}

describe.each([1, 2] as const)("blankDocument with rules %i", (rules) => {
  it("gives the same blanks for the same seed and settings", () => {
    const settings = { percent: 60, minLength: 4 };
    expect(blankDocument(blocks, settings, 42, rules)).toEqual(blankDocument(blocks, settings, 42, rules));
  });

  it("keeps the text intact around the blanks, punctuation included", () => {
    const { blocks: quiz, answers } = blankDocument(blocks, { percent: 60, minLength: 4 }, 7, rules);
    expect(quiz.map((b) => restore(b.segments, answers))).toEqual(blocks.map((b) => b.text));
    for (const answer of answers) expect(answer).toMatch(/^[\p{L}\p{N}]+$/u);
  });

  it("measures blank length in letters, not UTF-16 units", () => {
    const { blocks: quiz } = blankDocument([{ kind: "paragraph", text: "a nagyon ellenőrzés" }], { percent: 100, minLength: 10 }, 1, rules);
    expect(quiz[0]!.segments).toContainEqual({ blank: 0, length: 10 });
  });

  it("blanks nothing at zero percent", () => {
    expect(blankDocument(blocks, { percent: 0, minLength: 1 }, 1, rules).answers).toEqual([]);
  });

  it("never blanks a word shorter than the minimum", () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const answer of blankDocument(blocks, { percent: 100, minLength: 5 }, seed, rules).answers) expect([...answer].length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("rules 1, as attempts made before rules 2 still use", () => {
  it("never blanks two words in a row, but does blank right after punctuation", () => {
    const { blocks: quiz } = blankDocument([{ kind: "paragraph", text: "Első, második harmadik negyedik" }], { percent: 100, minLength: 1 }, 1, 1);
    expect(quiz[0]!.segments).toEqual([{ blank: 0, length: 4 }, { text: ", második " }, { blank: 1, length: 8 }, { text: " negyedik" }]);
  });
});

describe("rules 2", () => {
  const settings = { percent: 100, minLength: 1 };
  const many = Array.from({ length: 20 }, (_, i): Block => ({ kind: "paragraph", text: `${i + 1}. ${text} a) Továbbá „rendőrség” (ellenőrzés) szerint 2012 jogszabályok.` }));

  it("leaves at least three words between two blanks", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { blocks: quiz } = blankDocument(many, settings, seed, 2);
      for (const { segments } of quiz) {
        let since = Infinity;
        for (const w of wordsOf(segments).filter((w) => w.isWord)) {
          if (w.blank) {
            expect(since).toBeGreaterThanOrEqual(3);
            since = 0;
          } else since++;
        }
      }
    }
  });

  it("never blanks a paragraph's first word or a word right after punctuation", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { blocks: quiz } = blankDocument(many, settings, seed, 2);
      for (const { segments } of quiz) {
        const words = wordsOf(segments);
        let separator = "";
        let first = true;
        for (const w of words) {
          if (!w.isWord) {
            separator += w.word;
            continue;
          }
          if (w.blank) {
            expect(first).toBe(false);
            expect(separator.trim()).toBe("");
          }
          separator = "";
          first = false;
        }
      }
    }
  });

  it("never blanks function words or bare numbers", () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const answer of blankDocument(many, settings, seed, 2).answers) {
        expect(answer).not.toMatch(/^\d+$/);
        expect(["hogy", "szerint", "továbbá"]).not.toContain(answer.toLocaleLowerCase("hu"));
      }
    }
  });
});

describe("blankStats", () => {
  it("counts only words rules 2 could blank, by length, and every word in total", () => {
    // "Első" opens the paragraph and "második" follows a comma; only "harmadik" (8) and "szerint" are left, and that's a function word.
    const { candidates, total } = blankStats([{ kind: "paragraph", text: "Első, második harmadik szerint" }]);
    expect(total).toBe(4);
    expect(candidates[8]).toBe(1);
    expect(candidates.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

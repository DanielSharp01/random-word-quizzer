import { describe, expect, it } from "vitest";
import { blankDocument, type Block, type Segment } from "../../src/quiz/blanks";

const text = "Az ellenőrzés célja, hogy előmozdítsa a rendőrség törvényes, szakszerű, eredményes és hatékony működését.";
const blocks: Block[] = [
  { kind: "heading", text: "Az ellenőrzés célja" },
  { kind: "paragraph", text },
];

/** Puts each answer back into its blank. */
const restore = (segments: Segment[], answers: string[]) => segments.map((s) => ("text" in s ? s.text : answers[s.blank])).join("");

describe("blankDocument", () => {
  it("gives the same blanks for the same seed and settings", () => {
    const settings = { percent: 40, minLength: 4 };
    expect(blankDocument(blocks, settings, 42)).toEqual(blankDocument(blocks, settings, 42));
    expect(blankDocument(blocks, settings, 42)).not.toEqual(blankDocument(blocks, settings, 43));
  });

  it("keeps the text intact around the blanks, punctuation included", () => {
    const { blocks: quiz, answers } = blankDocument(blocks, { percent: 60, minLength: 4 }, 7);
    expect(answers.length).toBeGreaterThan(0);
    expect(quiz.map((b) => restore(b.segments, answers))).toEqual(blocks.map((b) => b.text));
    for (const answer of answers) expect(answer).toMatch(/^[\p{L}\p{N}]+$/u);
  });

  it("never blanks two words in a row or a word shorter than the minimum", () => {
    for (let seed = 0; seed < 50; seed++) {
      const { blocks: quiz, answers } = blankDocument(blocks, { percent: 100, minLength: 5 }, seed);
      for (const answer of answers) expect([...answer].length).toBeGreaterThanOrEqual(5);
      for (const { segments } of quiz) {
        segments.forEach((segment, i) => {
          if (!("blank" in segment) || i === 0) return;
          const before = segments[i - 1]!;
          // Only spaces or punctuation since the previous blank would mean neighbouring words were both blanked.
          expect("text" in before && (i === 1 || "text" in segments[i - 2]! || /[\p{L}\p{N}]/u.test(before.text))).toBe(true);
        });
      }
    }
  });

  it("measures blank length in letters, not UTF-16 units", () => {
    const { blocks: quiz } = blankDocument([{ kind: "paragraph", text: "ellenőrzés" }], { percent: 100, minLength: 1 }, 1);
    expect(quiz[0]!.segments).toEqual([{ blank: 0, length: 10 }]);
  });

  it("blanks nothing at zero percent", () => {
    expect(blankDocument(blocks, { percent: 0, minLength: 1 }, 1).answers).toEqual([]);
  });
});

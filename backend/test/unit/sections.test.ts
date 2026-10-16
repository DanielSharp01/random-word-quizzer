import { describe, expect, it } from "vitest";
import type { Block } from "../../src/quiz/blanks";
import { looksLikeTitle, sectionsOf, wholeDocumentSource } from "../../src/quiz/sections";

const p = (text: string): Block => ({ kind: "paragraph", text });
const h = (text: string): Block => ({ kind: "heading", text });
const titles = (blocks: Block[], max?: number) => sectionsOf(blocks, max).map((s) => s.title);

describe("looksLikeTitle", () => {
  it.each(["Az ellenőrzés célja", "ÁLTALÁNOS RENDELKEZÉSEK", "Jogorvoslat", "II. fejezet", "IV. Fejezet"])("takes %j for a title", (text) => {
    expect(looksLikeTitle(text)).toBe(true);
  });

  it.each([
    "8. Ezen Szabályzat alkalmazásában:",
    "a) függetlenített ellenőrzés,",
    "d) munkafolyamatba épített ellenőrzés",
    "útján valósul meg.",
    "6/2012. (III. 9.) ORFK utasítás",
    "az Ellenőrzési Szabályzatról",
    "Az ellenőrzés a rendőrség működésében tapasztalható erősségek és gyengeségek feltárásával segíti a vezetést",
  ])("doesn't take %j for a title", (text) => {
    expect(looksLikeTitle(text)).toBe(false);
  });
});

describe("sectionsOf", () => {
  it("splits at Word headings when the document has them, each running to the next", () => {
    expect(sectionsOf([h("Célja"), p("abc"), p("de"), h("Alapelvei"), p("f")])).toEqual([
      { index: 0, title: "Célja", fromBlock: 0, toBlock: 3, chars: 10 },
      { index: 1, title: "Alapelvei", fromBlock: 3, toBlock: 5, chars: 10 },
    ]);
  });

  it("uses only the headings when there are some, not lines that look like titles", () => {
    expect(titles([h("Első"), p("Rövid sor cím nélkül"), p("x.")])).toEqual(["Első"]);
  });

  it("finds the titles of a document typed as plain paragraphs", () => {
    const blocks = [
      p("6/2012. (III. 9.) ORFK utasítás"),
      p("ÁLTALÁNOS RENDELKEZÉSEK"),
      p("Az ellenőrzés célja"),
      p("2. Az ellenőrzés célja, hogy előmozdítsa a feladatok végrehajtását."),
      p("II. fejezet"),
      p("AZ ELLENŐRZÉS RENDSZERE"),
      p("9. A rendőrség szervezetén belüli ellenőrzés"),
      p("a) függetlenített ellenőrzés,"),
    ];
    expect(sectionsOf(blocks).map((s) => [s.title, s.fromBlock, s.toBlock])).toEqual([
      ["Bevezető", 0, 1],
      ["Az ellenőrzés célja", 2, 4],
      ["AZ ELLENŐRZÉS RENDSZERE", 5, 8],
    ]);
  });

  it("calls the text of a document without any titles just that", () => {
    expect(titles([p("a."), p("b.")])).toEqual(["Szöveg"]);
  });

  it("cuts a section too long for one call into numbered parts", () => {
    const blocks = [h("Hosszú"), p("x".repeat(40)), p("y".repeat(40)), p("z".repeat(40))];
    // The heading and two paragraphs make 86, within 90; the third starts a new part.
    expect(sectionsOf(blocks, 90).map((s) => [s.title, s.fromBlock, s.toBlock])).toEqual([
      ["Hosszú (1. rész, 1–3. bekezdés)", 0, 3],
      ["Hosszú (2. rész, 4. bekezdés)", 3, 4],
    ]);
  });
});

describe("wholeDocumentSource", () => {
  const blocks = [h("A"), p("a".repeat(50)), h("B"), p("b".repeat(50)), h("C"), p("c".repeat(50))];

  it("sends all of a document that fits", () => {
    expect(wholeDocumentSource(blocks, Math.random, 1000)).toEqual([{ fromBlock: 0, toBlock: 6 }]);
  });

  it("samples sections up to the budget, in document order", () => {
    // Each section is 51 chars, so two fit in 110; the keys put C first, then A.
    const keys = [0.5, 0.9, 0.1];
    let i = 0;
    expect(wholeDocumentSource(blocks, () => keys[i++]!, 110)).toEqual([
      { fromBlock: 0, toBlock: 2 },
      { fromBlock: 4, toBlock: 6 },
    ]);
  });

  it("draws different sections on different runs", () => {
    const picks = new Set(Array.from({ length: 30 }, () => JSON.stringify(wholeDocumentSource(blocks, Math.random, 60))));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("still sends something when a single paragraph is over the budget", () => {
    expect(wholeDocumentSource([p("x".repeat(500))], Math.random, 100)).toEqual([{ fromBlock: 0, toBlock: 1 }]);
  });
});

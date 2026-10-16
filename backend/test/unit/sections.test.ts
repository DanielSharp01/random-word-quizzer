import { describe, expect, it } from "vitest";
import type { Block } from "../../src/quiz/blanks";
import { sectionsOf } from "../../src/quiz/sections";

const p = (text: string): Block => ({ kind: "paragraph", text });
const h = (text: string): Block => ({ kind: "heading", text });

describe("sectionsOf", () => {
  it("splits at headings, each section running to the next one", () => {
    expect(sectionsOf([h("Célja"), p("abc"), p("de"), h("Alapelvei"), p("f")])).toEqual([
      { index: 0, title: "Célja", fromBlock: 0, toBlock: 3, chars: 10 },
      { index: 1, title: "Alapelvei", fromBlock: 3, toBlock: 5, chars: 10 },
    ]);
  });

  it("keeps text before the first heading as its own section", () => {
    expect(sectionsOf([p("bevezetés"), h("Első"), p("x")]).map((s) => [s.title, s.fromBlock, s.toBlock])).toEqual([
      ["Bevezető", 0, 1],
      ["Első", 1, 3],
    ]);
  });

  it("treats a document without headings as one section", () => {
    expect(sectionsOf([p("a"), p("b")])).toEqual([{ index: 0, title: "Teljes dokumentum", fromBlock: 0, toBlock: 2, chars: 2 }]);
  });

  it("skips a heading with nothing under it", () => {
    expect(sectionsOf([h("Üres"), h("Tele"), p("x")]).map((s) => s.title)).toEqual(["Tele"]);
  });
});

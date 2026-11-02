import { describe, expect, it } from "vitest";
import { readMarkdown } from "../../src/quiz/markdown";

describe("readMarkdown", () => {
  it("reads headings, paragraphs and nested list items as plain text", () => {
    const source = [
      "# Az ellenőrzés alapelvei",
      "",
      "**Törvényesség**, _szakszerűség_:",
      "az ellenőrzés & a [szabályok](https://example.com) `kódja`.",
      "",
      "- átfogó ellenőrzés",
      "  - célellenőrzés",
      "1. belső ellenőrzés",
    ].join("\n");

    expect(readMarkdown(source)).toEqual([
      { kind: "heading", text: "Az ellenőrzés alapelvei" },
      { kind: "paragraph", text: "Törvényesség, szakszerűség: az ellenőrzés & a szabályok kódja." },
      { kind: "listItem", text: "átfogó ellenőrzés" },
      { kind: "listItem", text: "célellenőrzés" },
      { kind: "listItem", text: "belső ellenőrzés" },
    ]);
  });

  it("reads a loose list item once, not again as a paragraph", () => {
    expect(readMarkdown("- első\n\n- második\n")).toEqual([
      { kind: "listItem", text: "első" },
      { kind: "listItem", text: "második" },
    ]);
  });

  it("reads tables cell by cell and quotes as paragraphs", () => {
    expect(readMarkdown("| Fogalom | Jelentés |\n| --- | --- |\n| ÁSZ | Állami Számvevőszék |\n\n> Idézet\n").map((b) => b.text)).toEqual([
      "Fogalom",
      "Jelentés",
      "ÁSZ",
      "Állami Számvevőszék",
      "Idézet",
    ]);
  });

  it("skips front matter and code blocks, and reads Obsidian links as their text", () => {
    const source = "﻿---\ntags: [jog]\n---\nLásd: [[Ellenőrzés]] és [[Belső ellenőrzés|a belsőt]].\n\n```\nconst x = 1;\n```\n";
    expect(readMarkdown(source)).toEqual([{ kind: "paragraph", text: "Lásd: Ellenőrzés és a belsőt." }]);
  });

  it("joins hard line breaks with a space", () => {
    expect(readMarkdown("első sor  \nmásodik sor")).toEqual([{ kind: "paragraph", text: "első sor második sor" }]);
  });
});

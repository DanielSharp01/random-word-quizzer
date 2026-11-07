import { describe, expect, it } from "vitest";
import { readDocx } from "../../src/quiz/docx";
import { buildDocx } from "../support/docx";

describe("readDocx", () => {
  it("reads headings, paragraphs and list items in order", async () => {
    const file = await buildDocx([
      { text: "Az ellenőrzés alapelvei", style: "Heading1" },
      { text: "Törvényesség,   szakszerűség:  az ellenőrzés & a <szabályok>." },
      { text: "átfogó ellenőrzés", listLevel: 0 },
      { text: "célellenőrzés", listLevel: 1 },
      { text: "belső ellenőrzés", listLevel: 0 },
    ]);

    expect(await readDocx(file)).toEqual([
      { kind: "heading", text: "Az ellenőrzés alapelvei" },
      { kind: "paragraph", text: "Törvényesség, szakszerűség: az ellenőrzés & a <szabályok>." },
      { kind: "listItem", text: "átfogó ellenőrzés" },
      { kind: "listItem", text: "célellenőrzés" },
      { kind: "listItem", text: "belső ellenőrzés" },
    ]);
  });

  it("reads a paragraph Word marks with an outline level as a heading, numbered or not", async () => {
    const file = await buildDocx([
      { text: "Jogorvoslat:", listLevel: 0, outlineLevel: 0 },
      { text: "Az ellenőrzés alá vont panasszal élhet." },
      { text: "mobil ellenőrzés kiterjed", outlineLevel: 1 },
      { text: "Jelentés tartalmi elemei:", listLevel: 0 },
    ]);

    expect(await readDocx(file)).toEqual([
      { kind: "heading", text: "Jogorvoslat:" },
      { kind: "paragraph", text: "Az ellenőrzés alá vont panasszal élhet." },
      { kind: "heading", text: "mobil ellenőrzés kiterjed" },
      { kind: "listItem", text: "Jelentés tartalmi elemei:" },
    ]);
  });

  it("drops empty paragraphs", async () => {
    const file = await buildDocx([{ text: "Első" }, { text: "   " }, { text: "Második" }]);
    expect((await readDocx(file)).map((b) => b.text)).toEqual(["Első", "Második"]);
  });

  it("rejects a file that isn't a .docx", async () => {
    await expect(readDocx(Buffer.from("not a zip"))).rejects.toThrow();
  });
});

import JSZip from "jszip";
import mammoth from "mammoth";
import type { Block } from "./blanks";
import { blocksFromHtml } from "./html-blocks";

const OUTLINE_STYLE = "QuizzerOutline";
const outlineStyleMap = [1, 2, 3, 4, 5, 6].map((level) => `p.${OUTLINE_STYLE}${level} => h${level}:fresh`);

/**
 * Word marks a paragraph as a heading with an outline level as well as with a heading style, and
 * documents typed without heading styles often title their sections that way, numbered list
 * paragraphs included. Mammoth ignores outline levels, so such paragraphs get a style it can map.
 */
async function markOutlineLevels(file: Buffer) {
  const zip = await JSZip.loadAsync(file);
  const document = zip.file("word/document.xml");
  if (!document) return file;
  const xml = await document.async("string");
  const marked = xml.replace(/<w:pPr>((?:(?!<\/?w:pPr>)[\s\S])*)<\/w:pPr>/g, (properties, inner: string) => {
    const level = /<w:outlineLvl w:val="([0-5])"\/>/.exec(inner)?.[1];
    if (level === undefined) return properties;
    return `<w:pPr><w:pStyle w:val="${OUTLINE_STYLE}${Number(level) + 1}"/>${inner.replace(/<w:pStyle [^>]*\/>/, "")}</w:pPr>`;
  });
  if (marked === xml) return file;
  zip.file("word/document.xml", marked);
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function readDocx(file: Buffer): Promise<Block[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer: await markOutlineLevels(file) }, { styleMap: outlineStyleMap });
  return blocksFromHtml(html);
}

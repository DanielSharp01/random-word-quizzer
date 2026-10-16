import mammoth from "mammoth";
import { HTMLElement, parse } from "node-html-parser";
import type { Block } from "./blanks";

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Mammoth nests a sub-list inside its parent item; the item's own text is everything but that list. */
function ownText(item: HTMLElement) {
  return clean(
    item.childNodes
      .filter((child) => !(child instanceof HTMLElement && /^(ol|ul)$/i.test(child.tagName)))
      .map((child) => child.text)
      .join(""),
  );
}

function collect(node: HTMLElement, blocks: Block[]) {
  for (const child of node.childNodes) {
    if (!(child instanceof HTMLElement)) continue;
    const tag = child.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) blocks.push({ kind: "heading", text: clean(child.text) });
    else if (tag === "p") blocks.push({ kind: "paragraph", text: clean(child.text) });
    else if (tag === "li") {
      blocks.push({ kind: "listItem", text: ownText(child) });
      collect(child, blocks);
    } else collect(child, blocks);
  }
}

/** The document's text as headings, paragraphs and list items in reading order; tables are read cell by cell. */
export async function readDocx(file: Buffer): Promise<Block[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer: file });
  const blocks: Block[] = [];
  collect(parse(html), blocks);
  return blocks.filter((block) => block.text.length > 0);
}

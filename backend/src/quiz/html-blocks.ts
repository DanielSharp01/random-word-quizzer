import { HTMLElement, parse } from "node-html-parser";
import type { Block } from "./blanks";

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const isList = (node: unknown): node is HTMLElement => node instanceof HTMLElement && /^(ol|ul)$/i.test(node.tagName);

/** A nested sub-list sits inside its parent item; the item's own text is everything but that list. */
function ownText(item: HTMLElement) {
  return clean(
    item.childNodes
      .filter((child) => !isList(child))
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
      for (const list of child.childNodes.filter(isList)) collect(list, blocks);
    }
    // Word wraps a cell's text in paragraphs; Markdown tables put it straight in the cell.
    else if ((tag === "td" || tag === "th") && !child.querySelector("p, ol, ul, h1, h2, h3, h4, h5, h6"))
      blocks.push({ kind: "paragraph", text: clean(child.text) });
    else collect(child, blocks);
  }
}

/** The text as headings, paragraphs and list items in reading order; tables are read cell by cell. */
export function blocksFromHtml(html: string): Block[] {
  const blocks: Block[] = [];
  collect(parse(html.replace(/<br\s*\/?>/gi, " ")), blocks);
  return blocks.filter((block) => block.text.length > 0);
}

import { marked } from "marked";
import type { Block } from "./blanks";
import { blocksFromHtml } from "./html-blocks";

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
/** Obsidian-style links: `[[Page]]` reads as "Page", `[[Page|shown]]` as "shown". */
const WIKI_LINK = /!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** Code blocks are left out: their text isn't prose to quiz on. */
export function readMarkdown(source: string): Block[] {
  const text = source
    .replace(/^﻿/, "")
    .replace(FRONT_MATTER, "")
    .replace(WIKI_LINK, (_, page: string, shown?: string) => shown ?? page);
  const html = marked.parse(text, { async: false, gfm: true });
  return blocksFromHtml(html.replace(/<pre>[\s\S]*?<\/pre>/g, ""));
}

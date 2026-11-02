import mammoth from "mammoth";
import type { Block } from "./blanks";
import { blocksFromHtml } from "./html-blocks";

export async function readDocx(file: Buffer): Promise<Block[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer: file });
  return blocksFromHtml(html);
}

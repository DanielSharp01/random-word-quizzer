import { consoleLogger } from "@danielsharp/common";
import color from "picocolors";

export const logger = consoleLogger({
  info: { tag: color.cyan("INFO"), command: console.info },
  warn: { tag: color.yellow("WARN"), command: console.warn },
  error: { tag: color.red("ERROR"), command: console.error },
});

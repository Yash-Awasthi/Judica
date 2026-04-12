import fs from "fs";
import type { ProcessedFile } from "./types.js";
import { assertFileSizeLimit } from "./types.js";

export async function processTXT(filePath: string): Promise<ProcessedFile> {
  assertFileSizeLimit(filePath);
  let text = fs.readFileSync(filePath, "utf-8");
  if (text.length > 100_000) text = text.slice(0, 100_000) + "\n\n[... truncated at 100k chars]";
  return { type: "text", text };
}

import fs from "fs/promises";
import type { ProcessedFile } from "./types.js";
import { assertFileSizeLimit } from "./types.js";

export async function processTXT(filePath: string): Promise<ProcessedFile> {
  assertFileSizeLimit(filePath);
  // Use async readFile to avoid blocking the event loop
  let text = await fs.readFile(filePath, "utf-8");
  if (text.length > 100_000) text = text.slice(0, 100_000) + "\n\n[... truncated at 100k chars]";
  return { type: "text", text };
}

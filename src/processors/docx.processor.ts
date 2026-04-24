import type { ProcessedFile } from "./types.js";
import { assertFileSizeLimit } from "./types.js";

const MAX_TEXT_LENGTH = 100_000;

export async function processDOCX(filePath: string): Promise<ProcessedFile> {
  assertFileSizeLimit(filePath);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  let text = result.value.trim();
  // Cap extracted text to prevent memory pressure during embedding/chunking
  if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH) + "\n\n[... truncated at 100k chars]";
  return { type: "text", text };
}

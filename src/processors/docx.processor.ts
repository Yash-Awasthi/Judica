import type { ProcessedFile } from "./types.js";
import { assertFileSizeLimit } from "./types.js";

export async function processDOCX(filePath: string): Promise<ProcessedFile> {
  assertFileSizeLimit(filePath);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return { type: "text", text: result.value.trim() };
}

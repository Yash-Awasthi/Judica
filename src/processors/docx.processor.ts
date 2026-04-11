import type { ProcessedFile } from "./types.js";

export async function processDOCX(filePath: string): Promise<ProcessedFile> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return { type: "text", text: result.value.trim() };
}

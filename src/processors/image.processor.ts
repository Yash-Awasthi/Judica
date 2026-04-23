import fs from "fs/promises";
import type { ProcessedFile } from "./types.js";
import { assertFileSizeLimit } from "./types.js";

export async function processImage(filePath: string, mimeType: string): Promise<ProcessedFile> {
  await assertFileSizeLimit(filePath);
  const buffer = await fs.readFile(filePath);
  const base64 = buffer.toString("base64");
  return { type: "image", base64, mimeType };
}

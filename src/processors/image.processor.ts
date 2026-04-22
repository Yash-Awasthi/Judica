import fs from "fs";
import type { ProcessedFile } from "./types.js";
import { assertFileSizeLimit } from "./types.js";

export async function processImage(filePath: string, mimeType: string): Promise<ProcessedFile> {
  assertFileSizeLimit(filePath);
  const buffer = await fs.promises.readFile(filePath);
  const base64 = buffer.toString("base64");
  return { type: "image", base64, mimeType };
}

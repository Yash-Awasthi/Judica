import fs from "fs";
import type { ProcessedFile } from "./types.js";

export async function processImage(filePath: string, mimeType: string): Promise<ProcessedFile> {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString("base64");
  return { type: "image", base64, mimeType };
}

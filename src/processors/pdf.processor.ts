import fs from "fs";
import type { ProcessedFile } from "./types.js";

export async function processPDF(filePath: string): Promise<ProcessedFile> {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = (pdfParseModule as any).default || pdfParseModule;
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const text = data.text.replace(/[^\x20-\x7E\n\r\t]/g, " ").trim();
  return {
    type: "text",
    text,
    metadata: { pages: data.numpages },
  };
}

import fs from "fs";
import type { ProcessedFile } from "./types.js";
import { assertFileSizeLimit } from "./types.js";

/**
 * P5-03: pdf-parse 2.4.5 CVE audit.
 *
 * Known risks mitigated:
 * - File size limit enforced via assertFileSizeLimit() before parsing (prevents DoS via large PDFs)
 * - Dynamic import isolates the dependency; it is NOT loaded at startup
 * - Output text is sanitized (non-printable chars stripped)
 * - pdf-parse internally uses pdf.js which has had CVEs (CVE-2024-4367 XSS in pdf.js).
 *   We only extract text server-side (no browser rendering), so XSS vectors don't apply.
 *
 * Recommendation: monitor pdf-parse releases; consider switching to `unpdf` or `pdfjs-dist`
 * directly if pdf-parse stops receiving updates.
 */
export async function processPDF(filePath: string): Promise<ProcessedFile> {
  assertFileSizeLimit(filePath);
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = (pdfParseModule as unknown as { default?: (buffer: Buffer) => Promise<{ text: string; numpages: number }> }).default || (pdfParseModule as unknown as (buffer: Buffer) => Promise<{ text: string; numpages: number }>);
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const text = data.text.replace(/[^\x20-\x7E\n\r\t]/g, " ").trim();
  return {
    type: "text",
    text,
    metadata: { pages: data.numpages },
  };
}

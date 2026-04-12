import type { ProcessedFile } from "./types.js";
import fs from "fs";

// TODO: xlsx 0.18.5 has known security advisories (CVE-2024-22363 and others).
// Replace with 'exceljs' when possible. See: https://github.com/SheetJS/sheetjs/issues
export async function processXLSX(filePath: string): Promise<ProcessedFile> {
  const XLSX = await import("xlsx");
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheets: string[] = [];
  const parts: string[] = [];

  for (const name of workbook.SheetNames) {
    sheets.push(name);
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`=== Sheet: ${name} ===\n${csv}`);
  }

  return {
    type: "spreadsheet",
    text: parts.join("\n\n"),
    metadata: { sheets },
  };
}

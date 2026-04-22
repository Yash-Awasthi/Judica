import fs from "fs/promises";
import Papa from "papaparse";
import type { ProcessedFile } from "./types.js";
import { assertFileSizeLimit } from "./types.js";

export async function processCSV(filePath: string): Promise<ProcessedFile> {
  assertFileSizeLimit(filePath);
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
  const rows = parsed.data as Record<string, string>[];

  // Convert to markdown table (max 500 rows)
  const limited = rows.slice(0, 500);
  if (limited.length === 0) return { type: "text", text: raw, metadata: { rows: 0 } };

  const headers = Object.keys(limited[0]);
  const headerRow = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  // R4-06: Neutralize spreadsheet formula injection. Cells starting with =, +, -, @,
  // or \t are interpreted as formulas by Excel/LibreOffice if the Markdown is later
  // pasted into a spreadsheet. Prefix such cells with a single quote to defuse them.
  function sanitizeCell(val: string): string {
    return /^[=+\-@\t]/.test(val) ? `'${val}` : val;
  }

  const dataRows = limited.map((r) => `| ${headers.map((h) => sanitizeCell(String(r[h] ?? ""))).join(" | ")} |`);

  const text = [headerRow, separator, ...dataRows].join("\n");
  return { type: "spreadsheet", text, metadata: { rows: rows.length, truncated: rows.length > 500 } };
}

import type { ProcessedFile } from "./types.js";
import { assertFileSizeLimit } from "./types.js";
import ExcelJS from "exceljs";

export async function processXLSX(filePath: string): Promise<ProcessedFile> {
  assertFileSizeLimit(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheets: string[] = [];
  const parts: string[] = [];
  const MAX_ROWS = 10_000;
  let totalRows = 0;

  for (const sheet of workbook.worksheets) {
    sheets.push(sheet.name);
    const rows: string[] = [];
    sheet.eachRow((row) => {
      if (totalRows >= MAX_ROWS) return;
      const values = row.values as (string | number | boolean | null | undefined)[];
      // row.values is 1-indexed; first element is undefined
      const cells = values.slice(1).map((v) => (v === null || v === undefined ? "" : String(v)));
      rows.push(cells.join(","));
      totalRows++;
    });
    parts.push(`=== Sheet: ${sheet.name} ===\n${rows.join("\n")}`);
  }

  return {
    type: "spreadsheet",
    text: parts.join("\n\n"),
    metadata: { sheets },
  };
}

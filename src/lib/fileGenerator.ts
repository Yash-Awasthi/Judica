/**
 * File Generator — Phase 3.7
 *
 * Explicit "generate a file" intent: council plans it, sandbox executes it,
 * artifact lands in the Artifacts tab.
 *
 * Inspired by:
 * - jsPDF (MIT, parallax/jsPDF, 30k stars) — client-side PDF generation
 * - ExcelJS (MIT, exceljs/exceljs, 14k stars) — Excel workbook creation
 * - Archiver (MIT, archiverjs/node-archiver, 2.8k stars) — ZIP/tar in Node.js
 *
 * Strategy: detect file generation intent from question, route to appropriate
 * generator, return file content as base64 + register as artifact.
 *
 * Supported formats (zero-dependency implementations):
 * - CSV: native string building
 * - JSON: JSON.stringify
 * - Markdown: pass-through
 * - HTML: template-based
 * - SVG: template-based
 * - TSV: native string building
 * Paid/heavy formats (stub with instructions):
 * - PDF: jsPDF (browser) or puppeteer (server) — require jsPDF/puppeteer
 * - XLSX: ExcelJS — requires exceljs
 * - ZIP: archiver — requires archiver
 */

import { askProvider } from "./providers.js";
import type { Provider } from "./providers.js";

export type GeneratableFormat = "csv" | "json" | "markdown" | "html" | "svg" | "tsv" | "txt" | "pdf" | "xlsx" | "zip";

export interface GeneratedFile {
  filename:    string;
  mimeType:    string;
  content:     string;          // text content or base64
  encoding:    "utf-8" | "base64";
  format:      GeneratableFormat;
  description: string;
}

const FORMAT_MIME: Record<GeneratableFormat, string> = {
  csv:      "text/csv",
  json:     "application/json",
  markdown: "text/markdown",
  html:     "text/html",
  svg:      "image/svg+xml",
  tsv:      "text/tab-separated-values",
  txt:      "text/plain",
  pdf:      "application/pdf",
  xlsx:     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip:      "application/zip",
};

/**
 * Detect if a question is requesting file generation.
 * Returns the requested format or null.
 */
export function detectFileGenerationIntent(question: string): GeneratableFormat | null {
  const q = question.toLowerCase();
  const patterns: Array<[RegExp, GeneratableFormat]> = [
    [/\b(generate|create|make|produce|export)\b.*(csv|spreadsheet|table data)/i, "csv"],
    [/\b(generate|create|make|produce|export)\b.*(xlsx|excel|workbook)/i, "xlsx"],
    [/\b(generate|create|make|produce|export)\b.*(json|data)/i, "json"],
    [/\b(generate|create|make|produce|export)\b.*(pdf|report|document)/i, "pdf"],
    [/\b(generate|create|make|produce|export)\b.*(markdown|md)/i, "markdown"],
    [/\b(generate|create|make|produce|export)\b.*(html|webpage|web page)/i, "html"],
    [/\b(generate|create|make|produce|export)\b.*(svg|diagram|chart)/i, "svg"],
    [/\b(generate|create|make|produce|export)\b.*(zip|archive)/i, "zip"],
    [/\b(generate|create|make|produce|export)\b.*(tsv|tab.separated)/i, "tsv"],
  ];

  for (const [pattern, format] of patterns) {
    if (pattern.test(q)) return format;
  }
  return null;
}

/**
 * Generate a file from a verdict/content string.
 * Returns the file content in the appropriate format.
 */
export async function generateFile(
  format: GeneratableFormat,
  content: string,
  filename: string,
  master?: Provider,
): Promise<GeneratedFile> {
  const mimeType = FORMAT_MIME[format];

  switch (format) {
    case "csv":
    case "tsv": {
      // Ask LLM to format as CSV/TSV if content isn't already
      const separator = format === "tsv" ? "\t" : ",";
      let csvContent = content;
      if (!content.includes(separator)) {
        const prompt = `Convert the following content to valid ${format.toUpperCase()} format. Only output the ${format.toUpperCase()} data, no explanation:\n\n${content}`;
        if (master) {
          const res = await askProvider(master, [{ role: "user", content: prompt }]);
          csvContent = res.text;
        }
      }
      return { filename, mimeType, content: csvContent, encoding: "utf-8", format, description: `${format.toUpperCase()} file with ${csvContent.split("\n").length} rows` };
    }

    case "json": {
      // Try to parse content as JSON, otherwise wrap it
      let jsonContent: string;
      try {
        JSON.parse(content);
        jsonContent = content;
      } catch {
        jsonContent = JSON.stringify({ content, generatedAt: new Date().toISOString() }, null, 2);
      }
      return { filename, mimeType, content: jsonContent, encoding: "utf-8", format, description: "JSON data file" };
    }

    case "markdown":
    case "txt":
      return { filename, mimeType, content, encoding: "utf-8", format, description: `${format} document` };

    case "html": {
      const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${filename.replace(/\.html$/, "")}</title>
<style>body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 1rem; line-height: 1.6; }</style>
</head>
<body>
${content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").split("\n").map(l => `<p>${l}</p>`).join("\n")}
</body>
</html>`;
      return { filename, mimeType, content: html, encoding: "utf-8", format, description: "HTML document" };
    }

    case "svg": {
      // Wrap content in a basic SVG if it isn't already
      const svgContent = content.trim().startsWith("<svg") ? content :
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <rect width="800" height="600" fill="white"/>
  <text x="400" y="300" text-anchor="middle" font-family="sans-serif" font-size="16">${content.slice(0, 100)}</text>
</svg>`;
      return { filename, mimeType: "image/svg+xml", content: svgContent, encoding: "utf-8", format, description: "SVG image" };
    }

    case "pdf":
      return {
        filename, mimeType, format, encoding: "utf-8",
        content: `PDF generation requires jsPDF (browser) or puppeteer (server).\nInstall: npm install jspdf\n\nContent preview:\n${content.slice(0, 500)}`,
        description: "PDF stub — install jsPDF to enable",
      };

    case "xlsx":
      return {
        filename, mimeType, format, encoding: "utf-8",
        content: `XLSX generation requires ExcelJS.\nInstall: npm install exceljs\n\nContent preview:\n${content.slice(0, 500)}`,
        description: "XLSX stub — install ExcelJS to enable",
      };

    case "zip":
      return {
        filename, mimeType, format, encoding: "utf-8",
        content: `ZIP generation requires archiver.\nInstall: npm install archiver\n\nContent preview:\n${content.slice(0, 500)}`,
        description: "ZIP stub — install archiver to enable",
      };

    default:
      return { filename, mimeType: "text/plain", content, encoding: "utf-8", format: "txt", description: "Text file" };
  }
}

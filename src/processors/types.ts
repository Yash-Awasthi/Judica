import fs from "fs";

export interface ProcessedFile {
  type: "text" | "image" | "spreadsheet";
  text?: string;
  base64?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

/** Maximum file size allowed for processing (100 MB) */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Check that a file does not exceed the processing size limit.
 * Throws if the file is too large, preventing multi-GB files from crashing the process.
 */
export function assertFileSizeLimit(filePath: string): void {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File too large for processing: ${(stat.size / (1024 * 1024)).toFixed(1)}MB exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit`
    );
  }
}

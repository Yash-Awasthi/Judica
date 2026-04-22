import path from "path";
import { processPDF } from "./pdf.processor.js";
import { processDOCX } from "./docx.processor.js";
import { processXLSX } from "./xlsx.processor.js";
import { processCSV } from "./csv.processor.js";
import { processTXT } from "./txt.processor.js";
import { processImage } from "./image.processor.js";
import { processAudio } from "./audio.processor.js";
import type { ProcessedFile } from "./types.js";

interface UploadRecord {
  id: string;
  mimeType: string;
  storagePath: string;
  originalName: string;
}

export async function processFile(upload: UploadRecord): Promise<ProcessedFile> {
  const { mimeType, storagePath } = upload;

  // Prevent path traversal
  const normalizedPath = path.resolve(storagePath);
  if (normalizedPath !== storagePath && !normalizedPath.startsWith(path.resolve("."))) {
    throw new Error("Invalid file path");
  }

  if (mimeType === "application/pdf") {
    return processPDF(storagePath);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    return processDOCX(storagePath);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    return processXLSX(storagePath);
  }
  if (mimeType === "text/csv") {
    return processCSV(storagePath);
  }
  if (mimeType.startsWith("text/")) {
    return processTXT(storagePath);
  }
  if (mimeType.startsWith("image/")) {
    return processImage(storagePath, mimeType);
  }
  if (mimeType.startsWith("audio/")) {
    return processAudio(storagePath, mimeType);
  }

  // Fallback: try as text
  try {
    return processTXT(storagePath);
  } catch {
    throw new Error(`Unsupported file type: ${mimeType.replace(/[^\x20-\x7E]/g, "").slice(0, 100)}`);
  }
}

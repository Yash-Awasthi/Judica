export interface ProcessedFile {
  type: "text" | "image" | "spreadsheet";
  text?: string;
  base64?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

import prisma from "../lib/db.js";
import logger from "../lib/logger.js";

export interface DetectedArtifact {
  name: string;
  type: "code" | "markdown" | "html" | "json" | "csv";
  content: string;
  language?: string;
}

const LANG_MAP: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  cpp: "c++",
  c: "c",
  sh: "bash",
  bash: "bash",
  sql: "sql",
  html: "html",
  css: "css",
  jsx: "javascript",
  tsx: "typescript",
};

/**
 * Detect artifacts from AI response text.
 * Returns the first significant artifact found, or null.
 */
export function detectArtifact(response: string): DetectedArtifact | null {
  // 1. Check for code blocks (```lang\n...\n```) with 20+ lines
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(response)) !== null) {
    const lang = match[1]?.toLowerCase() || "";
    const code = match[2].trim();
    const lineCount = code.split("\n").length;

    if (lineCount >= 20) {
      const resolvedLang = LANG_MAP[lang] || lang || undefined;
      return {
        name: `Code snippet (${resolvedLang || "unknown"})`,
        type: "code",
        content: code,
        language: resolvedLang,
      };
    }
  }

  // 2. Check for complete HTML document
  if (
    response.includes("<!DOCTYPE") ||
    response.includes("<html") ||
    (response.includes("<head") && response.includes("<body"))
  ) {
    const htmlMatch = response.match(/(<!DOCTYPE[\s\S]*<\/html>)/i) ||
      response.match(/(<html[\s\S]*<\/html>)/i);
    if (htmlMatch) {
      return {
        name: "HTML Document",
        type: "html",
        content: htmlMatch[1],
      };
    }
  }

  // 3. Check for valid JSON object/array (complete, not embedded)
  const trimmed = response.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      if (trimmed.length > 100) {
        return {
          name: "JSON Data",
          type: "json",
          content: trimmed,
        };
      }
    } catch {
      // Not valid JSON
    }
  }

  // 4. Check for structured markdown (500+ chars with headers)
  if (response.length > 500) {
    const headerCount = (response.match(/^#{1,3}\s+/gm) || []).length;
    if (headerCount >= 2) {
      return {
        name: "Document",
        type: "markdown",
        content: response,
      };
    }
  }

  return null;
}

/**
 * Save a detected artifact to the database.
 */
export async function saveArtifact(
  userId: number,
  conversationId: string | null,
  artifact: DetectedArtifact
): Promise<string> {
  const record = await prisma.artifact.create({
    data: {
      userId,
      conversationId,
      name: artifact.name,
      type: artifact.type,
      content: artifact.content,
      language: artifact.language || null,
    },
  });

  logger.info({ artifactId: record.id, type: artifact.type }, "Artifact saved");
  return record.id;
}

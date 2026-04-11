import prisma from "../lib/db.js";
import { hybridSearch, type MemoryChunk } from "./vectorStore.service.js";
import logger from "../lib/logger.js";

export interface FileContext {
  text_documents: string[];
  image_blocks: { base64: string; mimeType: string; filename: string }[];
}

/**
 * Load uploads by IDs and build file context for injection into messages.
 */
export async function loadFileContext(uploadIds: string[], userId: number): Promise<FileContext> {
  if (!uploadIds || uploadIds.length === 0) return { text_documents: [], image_blocks: [] };

  const uploads = await prisma.upload.findMany({
    where: { id: { in: uploadIds }, userId },
  });

  const text_documents: string[] = [];
  const image_blocks: FileContext["image_blocks"] = [];

  for (const upload of uploads) {
    if (upload.mimeType.startsWith("image/") && upload.storagePath) {
      // Read image as base64
      const { readFileSync } = await import("fs");
      try {
        const buffer = readFileSync(upload.storagePath);
        image_blocks.push({
          base64: buffer.toString("base64"),
          mimeType: upload.mimeType,
          filename: upload.originalName,
        });
      } catch (err) {
        logger.warn({ uploadId: upload.id, err }, "Failed to read image file");
      }
    } else if (upload.extractedText) {
      text_documents.push(`[DOCUMENT: ${upload.originalName}]\n${upload.extractedText}\n[/DOCUMENT]`);
    }
  }

  return { text_documents, image_blocks };
}

/**
 * Retrieve RAG context from a knowledge base.
 */
export async function loadRAGContext(
  userId: number,
  query: string,
  kbId: string,
  limit: number = 5
): Promise<{ context: string; citations: { source: string; score: number }[] }> {
  try {
    const chunks = await hybridSearch(userId, query, kbId, limit);

    if (chunks.length === 0) {
      return { context: "", citations: [] };
    }

    const context =
      "[KNOWLEDGE BASE CONTEXT]\n" +
      chunks
        .map((c) => `Source: ${c.sourceName || "unknown"}\n${c.content}`)
        .join("\n---\n") +
      "\n[/KNOWLEDGE BASE CONTEXT]";

    const citations = chunks.map((c) => ({
      source: c.sourceName || "unknown",
      score: c.score,
    }));

    return { context, citations };
  } catch (err) {
    logger.error({ err, kbId }, "RAG retrieval failed");
    return { context: "", citations: [] };
  }
}

/**
 * Build the enriched question with file context and RAG context prepended.
 */
export function buildEnrichedQuestion(
  question: string,
  fileContext: FileContext,
  ragContext: string,
  memoryContext: string,
  groundTruthContext?: string
): string {
  const parts: string[] = [];

  if (groundTruthContext) {
    parts.push(`GROUND TRUTH CONTEXT:\n${groundTruthContext}\n\n---`);
  }

  if (ragContext) {
    parts.push(ragContext);
  }

  if (fileContext.text_documents.length > 0) {
    parts.push(fileContext.text_documents.join("\n\n"));
  }

  if (memoryContext) {
    parts.push(memoryContext);
  }

  parts.push(`QUESTION: ${question}`);

  return parts.join("\n\n");
}

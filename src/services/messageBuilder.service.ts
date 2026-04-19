import { db } from "../lib/drizzle.js";
import { uploads } from "../db/schema/uploads.js";
import { eq, inArray, and } from "drizzle-orm";
import { hybridSearch, enhancedHybridSearch, enrichWithParentContext, type MemoryChunk } from "./vectorStore.service.js";
import { getAdaptiveK } from "./adaptiveK.service.js";
import { readFile } from "fs/promises";
import path from "path";
import logger from "../lib/logger.js";
import type { AdapterContentBlock } from "../adapters/types.js";

export interface FileContext {
  text_documents: string[];
  image_blocks: { base64: string; mimeType: string; filename: string }[];
}

/**
 * Load uploads by IDs and build file context for injection into messages.
 */
export async function loadFileContext(uploadIds: string[], userId: number): Promise<FileContext> {
  if (!uploadIds || uploadIds.length === 0) return { text_documents: [], image_blocks: [] };

  const results = await db.select().from(uploads).where(
    and(
      inArray(uploads.id, uploadIds),
      eq(uploads.userId, userId),
    )
  );

  const text_documents: string[] = [];
  const image_blocks: FileContext["image_blocks"] = [];

  for (const upload of results) {
    if (upload.mimeType.startsWith("image/") && upload.storagePath) {
      // Validate storagePath stays within the uploads directory (prevent path traversal)
      const baseDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
      const targetPath = path.resolve(baseDir, upload.storagePath);
      const relativePath = path.relative(baseDir, targetPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        logger.warn({ uploadId: upload.id, storagePath: upload.storagePath }, "Blocked path traversal attempt");
        continue;
      }
      // Read image as base64
      try {
        const buffer = await readFile(targetPath);
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
  limit?: number
): Promise<{ context: string; citations: { source: string; score: number }[] }> {
  try {
    const { k, useHyde } = getAdaptiveK(query, limit);
    let chunks = useHyde
      ? await enhancedHybridSearch(userId, query, kbId, k, true)
      : await hybridSearch(userId, query, kbId, k);

    // Enrich child chunks with parent context
    chunks = await enrichWithParentContext(chunks);

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
 * Returns a string for text-only, or AdapterContentBlock[] when images are present.
 */
export function buildEnrichedQuestion(
  question: string,
  fileContext: FileContext,
  ragContext: string,
  memoryContext: string,
  groundTruthContext?: string
): string | AdapterContentBlock[] {
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

  const textContent = parts.join("\n\n");

  // If no images, return plain string
  if (fileContext.image_blocks.length === 0) {
    return textContent;
  }

  // With images: return content blocks array for multimodal messages
  const blocks: AdapterContentBlock[] = [
    { type: "text", text: textContent },
  ];

  for (const img of fileContext.image_blocks) {
    blocks.push({
      type: "image_base64",
      data: img.base64,
      media_type: img.mimeType,
    });
  }

  return blocks;
}

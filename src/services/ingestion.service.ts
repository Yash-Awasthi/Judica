import { chunkHierarchical } from "./chunker.service.js";
import { storeChunk } from "./vectorStore.service.js";
import { extractEntitiesBatch } from "./ner.service.js";
import { db } from "../lib/drizzle.js";
import { kbDocuments } from "../db/schema/uploads.js";
import { eq } from "drizzle-orm";
import logger from "../lib/logger.js";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;
const NER_ENABLED = process.env.NER_ENABLED === "true";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ingestDocument(
  userId: number,
  kbId: string,
  docId: string,
  filename: string,
  extractedText: string
): Promise<number> {
  // Cap extracted text and chunks to prevent resource exhaustion
  const MAX_TEXT_LENGTH = 5_000_000; // 5MB
  const MAX_CHUNKS = 10_000;
  if (extractedText.length > MAX_TEXT_LENGTH) {
    extractedText = extractedText.slice(0, MAX_TEXT_LENGTH);
  }
  let hierarchicalChunks = chunkHierarchical(extractedText);
  if (hierarchicalChunks.length > MAX_CHUNKS) {
    hierarchicalChunks = hierarchicalChunks.slice(0, MAX_CHUNKS);
  }
  logger.info({ docId, filename, chunkCount: hierarchicalChunks.length }, "Starting document ingestion (hierarchical)");

  // Run NER on all chunk contents in batch when NER_ENABLED=true
  const chunkContents = hierarchicalChunks.map((c) => c.content);
  let entitiesByChunk: import("./ner.service.js").ExtractedEntity[][] = [];
  if (NER_ENABLED) {
    try {
      entitiesByChunk = await extractEntitiesBatch(chunkContents);
      logger.info({ docId, filename, chunkCount: hierarchicalChunks.length }, "NER extraction complete");
    } catch (err) {
      logger.warn({ docId, err: (err as Error).message }, "NER batch extraction failed — proceeding without entities");
      entitiesByChunk = hierarchicalChunks.map(() => []);
    }
  } else {
    entitiesByChunk = hierarchicalChunks.map(() => []);
  }

  let failedChunks = 0;

  for (let i = 0; i < hierarchicalChunks.length; i += BATCH_SIZE) {
    const batch = hierarchicalChunks.slice(i, i + BATCH_SIZE);

    // For child chunks, store the parent first and get its ID
    const parentIds = new Map<string, string>();

    for (let idx = 0; idx < batch.length; idx++) {
      const chunk = batch[idx];
      const globalIdx = i + idx;
      const chunkEntities = entitiesByChunk[globalIdx] ?? [];
      try {
        if (chunk.level === "child" && chunk.parentContent) {
          // Check if we already stored this parent
          const parentKey = chunk.parentContent.substring(0, 100);
          if (!parentIds.has(parentKey)) {
            const parentId = await storeChunk(
              userId,
              kbId,
              chunk.parentContent,
              globalIdx,
              filename,
              undefined,
              undefined,
              undefined,
              chunkEntities,
            );
            parentIds.set(parentKey, parentId);
          }

          // Store child with parent reference
          await storeChunk(
            userId,
            kbId,
            chunk.content,
            globalIdx,
            filename,
            undefined,
            parentIds.get(parentKey),
            undefined,
            chunkEntities,
          );
        } else {
          // Standalone parent chunk (small enough to not need hierarchy)
          await storeChunk(userId, kbId, chunk.content, globalIdx, filename, undefined, undefined, undefined, chunkEntities);
        }
      } catch (err) {
        failedChunks++;
        logger.warn({ docId, chunkIndex: globalIdx, err: (err as Error).message }, "Failed to store chunk — skipping");
      }
    }

    if (i + BATCH_SIZE < hierarchicalChunks.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  const successCount = hierarchicalChunks.length - failedChunks;
  const indexed = successCount > 0;

  await db.update(kbDocuments)
    .set({ chunkCount: successCount, indexed, indexedAt: indexed ? new Date() : null })
    .where(eq(kbDocuments.id, docId));

  if (failedChunks > 0) {
    logger.warn({ docId, filename, failedChunks, totalChunks: hierarchicalChunks.length }, "Document ingestion completed with failures");
  }

  logger.info({ docId, filename, chunkCount: successCount }, "Document ingestion complete (hierarchical)");
  return successCount;
}

import { chunkText } from "./chunker.service.js";
import { storeChunk } from "./vectorStore.service.js";
import { db } from "../lib/drizzle.js";
import { kbDocuments } from "../db/schema/uploads.js";
import { eq } from "drizzle-orm";
import logger from "../lib/logger.js";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;

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
  const chunks = chunkText(extractedText);
  logger.info({ docId, filename, chunkCount: chunks.length }, "Starting document ingestion");

  let stored = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((chunk, idx) =>
        storeChunk(userId, kbId, chunk, i + idx, filename)
      )
    );
    stored += batch.length;

    if (i + BATCH_SIZE < chunks.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  await db.update(kbDocuments)
    .set({ chunkCount: chunks.length, indexed: true, indexedAt: new Date() })
    .where(eq(kbDocuments.id, docId));

  logger.info({ docId, filename, chunkCount: chunks.length }, "Document ingestion complete");
  return chunks.length;
}

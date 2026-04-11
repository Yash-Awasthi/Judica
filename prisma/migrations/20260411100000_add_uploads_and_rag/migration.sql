-- Tier 2: File Uploads
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "extractedText" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Upload_userId_createdAt_idx" ON "Upload"("userId", "createdAt");

ALTER TABLE "Upload" ADD CONSTRAINT "Upload_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tier 3: RAG - pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Tier 3: Memory chunks with vector embeddings
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "kbId" TEXT,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Memory_userId_kbId_idx" ON "Memory"("userId", "kbId");
CREATE INDEX "Memory_embedding_idx" ON "Memory" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

ALTER TABLE "Memory" ADD CONSTRAINT "Memory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tier 3: Knowledge Bases
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeBase_userId_name_key" ON "KnowledgeBase"("userId", "name");

ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tier 3: KB Documents
CREATE TABLE "KBDocument" (
    "id" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "indexed" BOOLEAN NOT NULL DEFAULT false,
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KBDocument_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "KBDocument" ADD CONSTRAINT "KBDocument_kbId_fkey"
    FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KBDocument" ADD CONSTRAINT "KBDocument_uploadId_fkey"
    FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Memory FK to KnowledgeBase
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_kbId_fkey"
    FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text search index for BM25 keyword search
ALTER TABLE "Memory" ADD COLUMN "tsv" tsvector
    GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;
CREATE INDEX "Memory_tsv_idx" ON "Memory" USING gin("tsv");

-- Add IVFFlat index for efficient semantic similarity search on Chat embeddings
-- This enables O(log N) retrieval instead of O(N) full scan

-- First ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Create IVFFlat index for approximate nearest neighbor search
-- list=100 is a good default for datasets up to ~1M vectors
CREATE INDEX IF NOT EXISTS chat_embedding_idx
ON "Chat"
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

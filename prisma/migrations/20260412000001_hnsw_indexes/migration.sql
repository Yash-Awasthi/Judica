-- Drop old IVFFlat indexes if they exist
DROP INDEX IF EXISTS idx_chat_embedding_ivfflat;
DROP INDEX IF EXISTS idx_memory_embedding_ivfflat;
DROP INDEX IF EXISTS idx_codefile_embedding_ivfflat;
DROP INDEX IF EXISTS idx_semantic_cache_embedding_ivfflat;

-- Create HNSW indexes for faster approximate nearest-neighbor search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_embedding_hnsw
  ON "Chat" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_embedding_hnsw
  ON "Memory" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_codefile_embedding_hnsw
  ON "CodeFile" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_semantic_cache_embedding_hnsw
  ON "SemanticCache" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

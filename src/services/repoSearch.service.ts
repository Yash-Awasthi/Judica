import { pool } from "../lib/db.js";
import { embed } from "./embeddings.service.js";
import { safeVectorLiteral } from "./vectorStore.service.js";

export interface CodeSearchResult {
  path: string;
  language: string;
  content: string;
  score: number;
}

// P19-03: Cap search limit to prevent excessive DB load
const MAX_SEARCH_LIMIT = 50;

export async function searchRepo(
  repoId: string,
  query: string,
  limit = 10
): Promise<CodeSearchResult[]> {
  limit = Math.min(Math.max(1, limit), MAX_SEARCH_LIMIT);
  const queryEmbedding = await embed(query);
  const vectorStr = safeVectorLiteral(queryEmbedding);

  const { rows } = await pool.query<{
    path: string;
    language: string;
    content: string;
    score: number;
  }>(
    `SELECT "path", "language", "content",
            1 - ("embedding" <=> $1::vector) AS score
     FROM "CodeFile"
     WHERE "repoId" = $2
     ORDER BY score DESC
     LIMIT $3`,
    [vectorStr, repoId, limit]
  );

  return rows;
}

import { pool } from "../lib/db.js";
import { embed } from "./embeddings.service.js";
import { safeVectorLiteral } from "./vectorStore.service.js";

export interface CodeSearchResult {
  path: string;
  language: string;
  content: string;
  score: number;
}

export async function searchRepo(
  repoId: string,
  query: string,
  limit = 10
): Promise<CodeSearchResult[]> {
  // P35-09: Validate and cap limit parameter
  if (!Number.isFinite(limit) || limit < 1) limit = 10;
  limit = Math.min(limit, 100);
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

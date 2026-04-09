import { pool } from "../lib/db.js";
import { embed } from "./embeddings.service.js";

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
  const queryEmbedding = await embed(query);
  const vectorStr = `[${queryEmbedding.join(",")}]`;

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

import { Octokit } from "@octokit/rest";
import { pool } from "../lib/db.js";
import { db } from "../lib/drizzle.js";
import { codeRepositories } from "../db/schema/repos.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { embed } from "./embeddings.service.js";
import { safeVectorLiteral } from "./vectorStore.service.js";
import logger from "../lib/logger.js";

const SUPPORTED_EXTENSIONS = [
  ".ts", ".js", ".tsx", ".jsx", ".py", ".java", ".go", ".rs",
  ".cpp", ".c", ".h", ".md", ".json", ".yaml", ".yml",
];

const MAX_CONTENT_LENGTH = 5000;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 500;

function extensionToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".py": "python", ".java": "java", ".go": "go",
    ".rs": "rust", ".cpp": "cpp", ".c": "c", ".h": "c",
    ".md": "markdown", ".json": "json",
    ".yaml": "yaml", ".yml": "yaml",
  };
  return map[ext] || "unknown";
}

function getExtension(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx) : "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ingestGitHubRepo(
  userId: number,
  owner: string,
  repo: string
): Promise<string> {
  const [repoRecord] = await db.insert(codeRepositories).values({
    id: randomUUID(),
    userId,
    source: "github",
    repoUrl: `https://github.com/${owner}/${repo}`,
    name: `${owner}/${repo}`,
  }).returning();

  const repoId = repoRecord.id;

  try {
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN || undefined,
    });

    const { data: treeData } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: "HEAD",
      recursive: "true",
    });

    const files = (treeData.tree || []).filter(
      (item) =>
        item.type === "blob" &&
        item.path &&
        SUPPORTED_EXTENSIONS.includes(getExtension(item.path))
    // P35-08: Cap files to prevent unbounded memory from large repos
    ).slice(0, 5000);

    logger.info(
      { repoId, owner, repo, totalFiles: files.length },
      "Starting GitHub repo ingestion"
    );

    let indexed = 0;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (file) => {
          try {
            const { data: blob } = await octokit.git.getBlob({
              owner,
              repo,
              file_sha: file.sha!,
            });

            const content = Buffer.from(blob.content, "base64")
              .toString("utf-8")
              .slice(0, MAX_CONTENT_LENGTH);

            if (!content.trim()) return;

            // R3-14: Reject files with traversal sequences in the path returned by GitHub API.
            // Although GitHub's API is trusted, a compromised or malicious repo manifest
            // could return paths like "../../etc/passwd".
            if (!file.path || file.path.includes("..") || file.path.startsWith("/")) {
              logger.warn({ path: file.path }, "Skipping file with unsafe path");
              return;
            }

            const ext = getExtension(file.path!);
            const language = extensionToLanguage(ext);
            const embedding = await embed(content);
            const vectorStr = safeVectorLiteral(embedding);

            await pool.query(
              `INSERT INTO "CodeFile" ("id", "repoId", "path", "language", "content", "embedding")
               VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::vector)`,
              [repoId, file.path, language, content, vectorStr]
            );

            indexed++;
          } catch (err) {
            logger.warn(
              { path: file.path, err },
              "Failed to ingest file, skipping"
            );
          }
        })
      );

      if (i + BATCH_SIZE < files.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    await db.update(codeRepositories).set({ indexed: true, fileCount: indexed }).where(eq(codeRepositories.id, repoId));

    logger.info({ repoId, indexed }, "GitHub repo ingestion complete");
    return repoId;
  } catch (err) {
    logger.error({ repoId, err }, "GitHub repo ingestion failed");
    await db.update(codeRepositories).set({ indexed: false, fileCount: 0 }).where(eq(codeRepositories.id, repoId));
    throw err;
  }
}

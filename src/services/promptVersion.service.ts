/**
 * Prompt version history service.
 *
 * Manages extended version records in PromptVersionHistory, supporting:
 *  - Auto-incrementing version numbers (within a DB transaction to avoid races)
 *  - Listing all versions newest-first
 *  - Fetching a specific version
 *  - Rolling back: marks a prior version as active, creates a new version entry
 *  - Simple line-by-line text diff between two versions
 */
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { promptVersionHistory } from "../db/schema/promptVersions.js";
import { and, eq, desc, max } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VersionData {
  content: string;
  systemPrompt?: string | null;
  description?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getMaxVersion(promptId: string): Promise<number> {
  const [row] = await db
    .select({ maxVersion: max(promptVersionHistory.version) })
    .from(promptVersionHistory)
    .where(eq(promptVersionHistory.promptId, promptId));
  return row?.maxVersion ?? 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Save a new version for a prompt. Auto-increments version number.
 * All version inserts happen inside a transaction to avoid TOCTOU races.
 */
export async function createVersion(
  promptId: string,
  data: VersionData,
  userId: number,
  changeNote?: string
) {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ maxVersion: max(promptVersionHistory.version) })
      .from(promptVersionHistory)
      .where(eq(promptVersionHistory.promptId, promptId));

    const nextVersion = (latest?.maxVersion ?? 0) + 1;

    const [newVersion] = await tx
      .insert(promptVersionHistory)
      .values({
        id: randomUUID(),
        promptId,
        version: nextVersion,
        content: data.content,
        systemPrompt: data.systemPrompt ?? null,
        description: data.description ?? null,
        changedBy: userId,
        changeNote: changeNote ?? null,
        isActive: true,
      })
      .returning();

    // Mark previous versions as inactive
    if (nextVersion > 1) {
      await tx
        .update(promptVersionHistory)
        .set({ isActive: false })
        .where(
          and(
            eq(promptVersionHistory.promptId, promptId),
            eq(promptVersionHistory.isActive, true)
          )
        );

      // Re-activate the newly inserted row (the update above may have caught it)
      await tx
        .update(promptVersionHistory)
        .set({ isActive: true })
        .where(eq(promptVersionHistory.id, newVersion.id));
    }

    return newVersion;
  });
}

/** List all versions for a prompt, newest first. */
export async function listVersions(promptId: string) {
  return db
    .select()
    .from(promptVersionHistory)
    .where(eq(promptVersionHistory.promptId, promptId))
    .orderBy(desc(promptVersionHistory.version));
}

/** Get a specific version by version number. */
export async function getVersion(promptId: string, version: number) {
  const [row] = await db
    .select()
    .from(promptVersionHistory)
    .where(
      and(
        eq(promptVersionHistory.promptId, promptId),
        eq(promptVersionHistory.version, version)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Roll back to a prior version.
 * Creates a new version entry that is a copy of the target version,
 * so the history is never rewritten — rollbacks are append-only.
 */
export async function rollback(
  promptId: string,
  targetVersion: number,
  userId: number
): Promise<typeof promptVersionHistory.$inferSelect> {
  const target = await getVersion(promptId, targetVersion);
  if (!target) {
    throw new AppError(404, `Version ${targetVersion} not found for prompt ${promptId}`);
  }

  const maxVer = await getMaxVersion(promptId);

  return db.transaction(async (tx) => {
    const nextVersion = maxVer + 1;

    // Deactivate current active version
    await tx
      .update(promptVersionHistory)
      .set({ isActive: false })
      .where(
        and(
          eq(promptVersionHistory.promptId, promptId),
          eq(promptVersionHistory.isActive, true)
        )
      );

    const [newEntry] = await tx
      .insert(promptVersionHistory)
      .values({
        id: randomUUID(),
        promptId,
        version: nextVersion,
        content: target.content,
        systemPrompt: target.systemPrompt,
        description: target.description,
        changedBy: userId,
        changeNote: `Rolled back to version ${targetVersion}`,
        isActive: true,
      })
      .returning();

    return newEntry;
  });
}

// ─── Diff ─────────────────────────────────────────────────────────────────────

export interface DiffLine {
  type: "equal" | "added" | "removed";
  line: string;
  lineNum?: number;
}

/**
 * Simple line-by-line diff between two versions.
 * Uses a greedy LCS-based approach for readability without external deps.
 */
export async function diffVersions(
  promptId: string,
  v1: number,
  v2: number
): Promise<{ v1: number; v2: number; diff: DiffLine[] }> {
  const [ver1, ver2] = await Promise.all([
    getVersion(promptId, v1),
    getVersion(promptId, v2),
  ]);

  if (!ver1) throw new AppError(404, `Version ${v1} not found`);
  if (!ver2) throw new AppError(404, `Version ${v2} not found`);

  const lines1 = ver1.content.split("\n");
  const lines2 = ver2.content.split("\n");

  const diff = computeLineDiff(lines1, lines2);
  return { v1, v2, diff };
}

/** LCS-based line diff */
function computeLineDiff(a: string[], b: string[]): DiffLine[] {
  const m = a.length;
  const n = b.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  const backtrack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      backtrack.push({ type: "equal", line: a[i - 1], lineNum: i });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      backtrack.push({ type: "added", line: b[j - 1], lineNum: j });
      j--;
    } else {
      backtrack.push({ type: "removed", line: a[i - 1], lineNum: i });
      i--;
    }
  }

  backtrack.reverse();
  result.push(...backtrack);
  return result;
}

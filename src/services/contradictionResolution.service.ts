import { db } from "../lib/drizzle.js";
import { contradictionRecords, type ContradictionVersion } from "../db/schema/council.js";
import { eq, and, sql } from "drizzle-orm";
import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

export interface Contradiction {
  id: string;
  claimA: string;
  sourceA: string;
  claimB: string;
  sourceB: string;
  resolution: string | null;
  resolvedBy: string | null;
  status: string;
  confidence: number | null;
  versions: ContradictionVersion[];
}

export interface DetectedContradiction {
  claimA: string;
  sourceA: string;
  claimB: string;
  sourceB: string;
}

/**
 * Detect contradictions between agent opinions from a deliberation round.
 * Analyzes identified_flaws from peer reviews for factual contradictions.
 */
export async function detectContradictions(
  opinions: { name: string; text: string }[],
): Promise<DetectedContradiction[]> {
  if (opinions.length < 2) return [];

  // Build a comparison prompt
  const opinionTexts = opinions
    .map((o) => `[${o.name}]: ${o.text.substring(0, 500)}`)
    .join("\n\n");

  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Identify direct factual contradictions between these agent opinions. Only flag clear contradictions where two agents make incompatible claims about the same topic. Return a JSON array of objects with: claimA, sourceA, claimB, sourceB. If no contradictions, return [].

${opinionTexts}`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as DetectedContradiction[];
      return parsed.filter(
        (c) => c.claimA && c.sourceA && c.claimB && c.sourceB
      );
    }
    return [];
  } catch (err) {
    logger.warn({ err }, "Contradiction detection failed");
    return [];
  }
}

/**
 * Record a detected contradiction with versioned tracking.
 */
export async function recordContradiction(
  userId: number,
  conversationId: string,
  contradiction: DetectedContradiction,
): Promise<string> {
  const id = `contra_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  await db.insert(contradictionRecords).values({
    id,
    conversationId,
    userId,
    claimA: contradiction.claimA,
    sourceA: contradiction.sourceA,
    claimB: contradiction.claimB,
    sourceB: contradiction.sourceB,
    status: "open",
    versions: [],
  });

  logger.info(
    { id, conversationId, sourceA: contradiction.sourceA, sourceB: contradiction.sourceB },
    "Contradiction recorded"
  );

  return id;
}

/**
 * Resolve a contradiction by adding a versioned resolution record.
 * Does NOT overwrite — appends to the versions array for full audit trail.
 */
export async function resolveContradiction(
  contradictionId: string,
  resolution: string,
  resolvedBy: string,
  confidence: number,
  reason: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(contradictionRecords)
    .where(eq(contradictionRecords.id, contradictionId))
    .limit(1);

  if (!existing) {
    throw new Error(`Contradiction ${contradictionId} not found`);
  }

  const newVersion: ContradictionVersion = {
    resolution,
    resolvedBy,
    confidence,
    timestamp: new Date().toISOString(),
    reason,
  };

  const updatedVersions = [...(existing.versions || []), newVersion];

  await db
    .update(contradictionRecords)
    .set({
      resolution,
      resolvedBy,
      confidence,
      status: "resolved",
      versions: updatedVersions,
      resolvedAt: new Date(),
    })
    .where(eq(contradictionRecords.id, contradictionId));

  logger.info(
    { contradictionId, resolvedBy, confidence, versionCount: updatedVersions.length },
    "Contradiction resolved (versioned)"
  );
}

/**
 * Reopen a previously resolved contradiction (e.g., new evidence emerged).
 * The previous resolution remains in the versions array.
 */
export async function reopenContradiction(
  contradictionId: string,
  reason: string,
): Promise<void> {
  await db
    .update(contradictionRecords)
    .set({
      status: "reopened",
      resolvedAt: null,
    })
    .where(eq(contradictionRecords.id, contradictionId));

  logger.info({ contradictionId, reason }, "Contradiction reopened");
}

/**
 * Get all contradictions for a conversation.
 */
export async function getConversationContradictions(
  conversationId: string,
): Promise<Contradiction[]> {
  const rows = await db
    .select()
    .from(contradictionRecords)
    .where(eq(contradictionRecords.conversationId, conversationId));

  return rows as Contradiction[];
}

/**
 * Get open contradictions for a user across all conversations.
 */
export async function getOpenContradictions(
  userId: number,
): Promise<Contradiction[]> {
  const rows = await db
    .select()
    .from(contradictionRecords)
    .where(
      and(
        eq(contradictionRecords.userId, userId),
        eq(contradictionRecords.status, "open")
      )
    );

  return rows as Contradiction[];
}

/**
 * Surface contradictions to the user: format for display in deliberation output.
 */
export function formatContradictions(contradictions: Contradiction[]): string {
  if (contradictions.length === 0) return "";

  const lines = contradictions.map((c, i) => {
    const status = c.status === "resolved"
      ? `Resolved by ${c.resolvedBy} (confidence: ${c.confidence})`
      : "Unresolved";

    return [
      `Contradiction ${i + 1} [${status}]:`,
      `  ${c.sourceA} claims: "${c.claimA}"`,
      `  ${c.sourceB} claims: "${c.claimB}"`,
      c.resolution ? `  Resolution: ${c.resolution}` : "",
      c.versions.length > 1 ? `  (${c.versions.length} resolution versions)` : "",
    ].filter(Boolean).join("\n");
  });

  return `[CONTRADICTIONS DETECTED]\n${lines.join("\n\n")}\n[/CONTRADICTIONS]`;
}

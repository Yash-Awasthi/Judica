import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { sql } from "drizzle-orm";
import { topicNodes } from "../db/schema/conversations.js";
import { eq } from "drizzle-orm";
import { embed } from "./embeddings.service.js";
import { safeVectorLiteral } from "./vectorStore.service.js";
import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

/** Sanitize user-controlled text before interpolation into LLM prompts */
function sanitizeForPrompt(text: string): string {
  return text
    .replace(/\b(system|assistant|user|human)\s*:/gi, (_m, role) => `${role as string} -`)
    .replace(/ignore\s+(all\s+)?previous\s+instructions/gi, "[filtered]")
    .replace(/you\s+are\s+now\b/gi, "[filtered]");
}

export interface TopicNode {
  id: string;
  label: string;
  summary: string | null;
  conversationIds: string[];
  strength: number;
}

export interface TopicEdge {
  sourceTopicId: string;
  targetTopicId: string;
  weight: number;
}

export interface TopicGraph {
  nodes: TopicNode[];
  edges: TopicEdge[];
}

/**
 * Extract topics from a conversation's content using LLM.
 */
async function extractTopics(conversationTitle: string, messages: string[]): Promise<string[]> {
  const sample = messages.slice(0, 10).join("\n").substring(0, 3000);

  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Extract 2-5 key topics from this conversation. Return ONLY a JSON array of short topic labels (2-4 words each), no explanation.\n\nTitle: ${sanitizeForPrompt(conversationTitle)}\n\nContent:\n${sanitizeForPrompt(sample)}`,
        },
      ],
      temperature: 0,
    });

    const text = result.text.trim();
    // Parse JSON array from response
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const topics = JSON.parse(match[0]) as string[];
      return topics.filter((t) => typeof t === "string" && t.length > 0).slice(0, 5);
    }
    return [];
  } catch (err) {
    logger.warn({ err }, "Topic extraction failed");
    return [];
  }
}

/**
 * Find or create a topic node, linking it to a conversation.
 * Uses embedding similarity to merge with existing topics (>0.88 cosine similarity).
 */
export async function linkConversationTopics(
  userId: number,
  conversationId: string,
  conversationTitle: string,
  messages: string[],
): Promise<TopicNode[]> {
  const topics = await extractTopics(conversationTitle, messages);
  if (topics.length === 0) return [];

  const linkedNodes: TopicNode[] = [];

  for (const topicLabel of topics) {
    const topicEmbedding = await embed(topicLabel);
    const vectorStr = safeVectorLiteral(topicEmbedding);

    // Check for existing similar topic (cosine similarity > 0.88)
    const existing = await db.execute(sql`
      SELECT "id", "label", "summary", "conversationIds", "strength",
             1 - ("embedding" <=> ${vectorStr}::vector) AS similarity
      FROM "TopicNode"
      WHERE "userId" = ${userId}
        AND "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${vectorStr}::vector
      LIMIT 1
    `);

    const topRow = (existing.rows as Array<{ [key: string]: unknown }>)[0];

    if (topRow && (topRow.similarity as number) > 0.88) {
      // Merge with existing topic
      const existingIds: string[] = (topRow.conversationIds as string[]) || [];
      if (!existingIds.includes(conversationId)) {
        // Atomic jsonb array append — prevents lost updates under concurrency
        await db.execute(sql`
          UPDATE "TopicNode"
          SET "conversationIds" = CASE
                WHEN "conversationIds" @> ${JSON.stringify([conversationId])}::jsonb THEN "conversationIds"
                ELSE "conversationIds" || ${JSON.stringify([conversationId])}::jsonb
              END,
              "strength" = "strength" + 1,
              "updatedAt" = NOW()
          WHERE "id" = ${topRow.id as string}
        `);
      }

      linkedNodes.push({
        id: topRow.id as string,
        label: topRow.label as string,
        summary: topRow.summary as string | null,
        conversationIds: existingIds,
        strength: (topRow.strength as number) + 1,
      });
    } else {
      // Create new topic node
      const nodeId = `topic_${randomUUID()}`;
      await db.execute(sql`
        INSERT INTO "TopicNode" ("id", "userId", "label", "embedding", "conversationIds", "strength", "createdAt", "updatedAt")
        VALUES (${nodeId}, ${userId}, ${topicLabel}, ${vectorStr}::vector, ${JSON.stringify([conversationId])}::jsonb, 1, NOW(), NOW())
      `);

      linkedNodes.push({
        id: nodeId,
        label: topicLabel,
        summary: null,
        conversationIds: [conversationId],
        strength: 1,
      });
    }
  }

  // Build edges between topics in this conversation
  await buildTopicEdges(linkedNodes);

  return linkedNodes;
}

/**
 * Build edges between co-occurring topics (same conversation = related).
 */
async function buildTopicEdges(nodes: TopicNode[]): Promise<void> {
  if (nodes.length < 2) return;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const sourceId = nodes[i].id;
      const targetId = nodes[j].id;

      // Upsert edge: increment weight if exists, create if not
      await db.execute(sql`
        INSERT INTO "TopicEdge" ("id", "sourceTopicId", "targetTopicId", "weight", "createdAt")
        VALUES (${`edge_${sourceId}_${targetId}`}, ${sourceId}, ${targetId}, 1, NOW())
        ON CONFLICT ("id") DO UPDATE SET "weight" = "TopicEdge"."weight" + 1
      `);
    }
  }
}

/**
 * Find related conversations by topic similarity.
 * Searches the topic graph for topics similar to the query,
 * then returns conversation IDs connected to those topics.
 */
export async function findRelatedConversations(
  userId: number,
  query: string,
  limit: number = 5,
): Promise<{ conversationId: string; topics: string[]; score: number }[]> {
  const queryEmbedding = await embed(query);
  const vectorStr = safeVectorLiteral(queryEmbedding);

  const result = await db.execute(sql`
    SELECT "id", "label", "conversationIds",
           1 - ("embedding" <=> ${vectorStr}::vector) AS score
    FROM "TopicNode"
    WHERE "userId" = ${userId}
      AND "embedding" IS NOT NULL
    ORDER BY score DESC
    LIMIT 10
  `);

  // Aggregate by conversation
  const convMap = new Map<string, { topics: string[]; score: number }>();

  for (const row of result.rows as Array<{ [key: string]: unknown }>) {
    if ((row.score as number) < 0.5) continue;
    const convIds: string[] = (row.conversationIds as string[]) || [];
    for (const convId of convIds) {
      const existing = convMap.get(convId);
      if (existing) {
        existing.topics.push(row.label as string);
        existing.score = Math.max(existing.score, row.score as number);
      } else {
        convMap.set(convId, { topics: [row.label as string], score: row.score as number });
      }
    }
  }

  return Array.from(convMap.entries())
    .map(([conversationId, data]) => ({ conversationId, ...data }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Garbage-collect stale topic nodes.
 *
 * Removes topic nodes that haven't been updated in `ttlDays` days
 * and have low strength (fewer than `minStrength` connections).
 * This prevents unbounded growth of the topic graph.
 *
 * @returns Number of pruned nodes.
 */
export async function pruneStaleTopics(
  userId: number,
  ttlDays: number = 90,
  minStrength: number = 2,
): Promise<number> {
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

  // Delete edges referencing stale nodes first
  const staleNodeIds = await db.execute(sql`
    SELECT "id" FROM "TopicNode"
    WHERE "userId" = ${userId}
      AND "updatedAt" < ${cutoff.toISOString()}::timestamp
      AND "strength" < ${minStrength}
  `);

  const ids = (staleNodeIds.rows as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return 0;

  await db.execute(sql`
    DELETE FROM "TopicEdge"
    WHERE "sourceTopicId" = ANY(${ids}::text[])
       OR "targetTopicId" = ANY(${ids}::text[])
  `);

  const result = await db.execute(sql`
    DELETE FROM "TopicNode"
    WHERE "userId" = ${userId}
      AND "updatedAt" < ${cutoff.toISOString()}::timestamp
      AND "strength" < ${minStrength}
  `);

  const pruned = result.rowCount ?? 0;
  if (pruned > 0) {
    logger.info({ userId, pruned, ttlDays, minStrength }, "Pruned stale topic nodes");
  }
  return pruned;
}
export async function getTopicGraph(userId: number): Promise<TopicGraph> {
  const nodes = await db
    .select({
      id: topicNodes.id,
      label: topicNodes.label,
      summary: topicNodes.summary,
      conversationIds: topicNodes.conversationIds,
      strength: topicNodes.strength,
    })
    .from(topicNodes)
    .where(eq(topicNodes.userId, userId));

  const nodeIds = nodes.map((n) => n.id);
  if (nodeIds.length === 0) return { nodes: [], edges: [] };

  const edges = await db.execute(sql`
    SELECT "sourceTopicId", "targetTopicId", "weight"
    FROM "TopicEdge"
    WHERE "sourceTopicId" = ANY(${nodeIds}::text[])
       OR "targetTopicId" = ANY(${nodeIds}::text[])
  `);

  return {
    nodes: nodes as TopicNode[],
    edges: (edges.rows as Array<{ [key: string]: unknown }>).map((e) => ({
      sourceTopicId: e.sourceTopicId as string,
      targetTopicId: e.targetTopicId as string,
      weight: e.weight as number,
    })),
  };
}

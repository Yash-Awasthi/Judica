/**
 * Personal Knowledge Graph — Phase 4.8
 *
 * GraphRAG-style personal knowledge graph built on the memoryTriples store.
 * Provides:
 * - Entity extraction from text (LLM)
 * - Graph traversal (BFS/multi-hop)
 * - Community detection (simple label propagation)
 * - Subgraph export (for visualization)
 * - Natural-language graph search
 *
 * Inspired by:
 * - GraphRAG (microsoft/graphrag, 22k stars) — graph-based RAG with community summaries
 * - LightRAG (HKUDS/LightRAG) — lightweight knowledge graph + RAG
 * - Zep (getzep/zep) — temporal knowledge graph for AI memory
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { memoryTriples } from "../db/schema/memoryTriples.js";
import { eq, and, or, ilike } from "drizzle-orm";
import { z } from "zod";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Triple {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

interface GraphNode {
  id: string;
  label: string;
  type: "entity" | "concept";
  degree: number;
  community?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  predicate: string;
  confidence: number;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const extractSchema = z.object({
  text: z.string().min(1).max(10000),
  conversationId: z.string().uuid().optional(),
});

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  /** Max hops to traverse from matching nodes (default 2) */
  hops: z.number().min(1).max(4).optional(),
  /** Max nodes to return (default 30) */
  limit: z.number().min(1).max(200).optional(),
});

const traverseSchema = z.object({
  startEntity: z.string().min(1),
  hops: z.number().min(1).max(4).optional(),
  predicate: z.string().optional(),
});

// ─── LLM entity extractor ─────────────────────────────────────────────────────

const llmProvider = {
  name: "openai",
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? "",
  model: "gpt-4o-mini",
  systemPrompt: "You are a knowledge graph extractor. Extract entities and relationships. Respond only in JSON.",
};

function buildExtractionPrompt(text: string): string {
  return `Extract all entities and relationships from this text as subject–predicate–object triples.

Text:
"""
${text.slice(0, 6000)}
"""

Rules:
- Subject and object should be concrete nouns or named entities
- Predicate should be a verb phrase (is, has, works_at, uses, created, depends_on, etc.)
- Include only factual relationships, not speculation
- Normalize entity names (capitalize consistently)

Respond ONLY in JSON:
{
  "triples": [
    { "subject": "...", "predicate": "...", "object": "...", "confidence": 0.0-1.0 }
  ],
  "entities": ["list of unique entity names"]
}`;
}

// ─── Graph utilities ──────────────────────────────────────────────────────────

/** Build adjacency list from triples */
function buildAdjacencyList(triples: Triple[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const t of triples) {
    if (!adj.has(t.subject)) adj.set(t.subject, new Set());
    if (!adj.has(t.object)) adj.set(t.object, new Set());
    adj.get(t.subject)!.add(t.object);
    adj.get(t.object)!.add(t.subject); // undirected for traversal
  }
  return adj;
}

/** BFS multi-hop traversal from seed nodes */
function bfsTraversal(
  seeds: string[],
  adj: Map<string, Set<string>>,
  hops: number,
  limit: number,
): Set<string> {
  const visited = new Set<string>(seeds);
  let frontier = new Set<string>(seeds);

  for (let h = 0; h < hops; h++) {
    const next = new Set<string>();
    for (const node of frontier) {
      for (const neighbor of adj.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
          if (visited.size >= limit) return visited;
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
  return visited;
}

/** Simple label propagation for community detection */
function detectCommunities(
  nodes: string[],
  adj: Map<string, Set<string>>,
  iterations = 10,
): Map<string, number> {
  // Initialize each node with unique community id
  const community = new Map<string, number>();
  nodes.forEach((n, i) => community.set(n, i));

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    // Shuffle order for fairness
    const shuffled = [...nodes].sort(() => Math.random() - 0.5);
    for (const node of shuffled) {
      const neighborCounts = new Map<number, number>();
      for (const nb of adj.get(node) ?? []) {
        const c = community.get(nb)!;
        neighborCounts.set(c, (neighborCounts.get(c) ?? 0) + 1);
      }
      if (neighborCounts.size > 0) {
        const best = [...neighborCounts.entries()].reduce((a, b) => b[1] > a[1] ? b : a)[0];
        if (community.get(node) !== best) {
          community.set(node, best);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Normalize community ids to sequential integers
  const idMap = new Map<number, number>();
  let nextId = 0;
  for (const [, cid] of community) {
    if (!idMap.has(cid)) idMap.set(cid, nextId++);
  }
  const normalized = new Map<string, number>();
  for (const [node, cid] of community) {
    normalized.set(node, idMap.get(cid)!);
  }
  return normalized;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function knowledgeGraphPlugin(app: FastifyInstance) {

  /**
   * POST /kg/extract
   * Extract entities and relationships from text, store as triples.
   */
  app.post("/kg/extract", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = extractSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { text, conversationId } = parsed.data;

    // LLM extraction
    const prompt = buildExtractionPrompt(text);
    const response = await askProvider(llmProvider, [{ role: "user", content: prompt }]);

    let extracted: { triples: Array<{ subject: string; predicate: string; object: string; confidence?: number }> } = { triples: [] };
    try {
      const match = response.text.match(/\{[\s\S]*\}/);
      if (match) extracted = JSON.parse(match[0]);
    } catch { /* ignore */ }

    // Store triples
    const stored: Triple[] = [];
    if (extracted.triples.length > 0) {
      const rows = await db
        .insert(memoryTriples)
        .values(
          extracted.triples.map((t) => ({
            userId,
            subject: t.subject,
            predicate: t.predicate,
            object: t.object,
            confidence: t.confidence ?? 1.0,
            conversationId: conversationId ?? null,
          })),
        )
        .returning();
      stored.push(...rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        predicate: r.predicate,
        object: r.object,
        confidence: r.confidence,
      })));
    }

    return { success: true, stored: stored.length, triples: stored };
  });

  /**
   * GET /kg/graph
   * Return the full personal knowledge graph as nodes + edges.
   * Includes community detection.
   */
  app.get("/kg/graph", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const triples = await db
      .select()
      .from(memoryTriples)
      .where(eq(memoryTriples.userId, userId));

    const tripleData: Triple[] = triples.map((t) => ({
      id: t.id,
      subject: t.subject,
      predicate: t.predicate,
      object: t.object,
      confidence: t.confidence,
    }));

    // Build node degree map
    const degreeMap = new Map<string, number>();
    const edgeSet: GraphEdge[] = [];
    for (const t of tripleData) {
      degreeMap.set(t.subject, (degreeMap.get(t.subject) ?? 0) + 1);
      degreeMap.set(t.object, (degreeMap.get(t.object) ?? 0) + 1);
      edgeSet.push({ source: t.subject, target: t.object, predicate: t.predicate, confidence: t.confidence });
    }

    const nodeNames = [...degreeMap.keys()];
    const adj = buildAdjacencyList(tripleData);
    const communities = detectCommunities(nodeNames, adj);

    const nodes: GraphNode[] = nodeNames.map((name) => ({
      id: name,
      label: name,
      type: "entity",
      degree: degreeMap.get(name) ?? 0,
      community: communities.get(name),
    }));

    return {
      success: true,
      nodes,
      edges: edgeSet,
      stats: {
        nodeCount: nodes.length,
        edgeCount: edgeSet.length,
        communityCount: new Set(communities.values()).size,
      },
    };
  });

  /**
   * POST /kg/search
   * Natural-language search: find matching entities then BFS-traverse.
   */
  app.post("/kg/search", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { query, hops = 2, limit = 30 } = parsed.data;
    const q = `%${query}%`;

    // Find matching triples (subject or object ilike query)
    const matching = await db
      .select()
      .from(memoryTriples)
      .where(and(
        eq(memoryTriples.userId, userId),
        or(ilike(memoryTriples.subject, q), ilike(memoryTriples.object, q)),
      ));

    const seedEntities = new Set<string>();
    for (const t of matching) {
      seedEntities.add(t.subject);
      seedEntities.add(t.object);
    }

    // Load all triples for traversal
    const allTriples = await db
      .select()
      .from(memoryTriples)
      .where(eq(memoryTriples.userId, userId));

    const tripleData: Triple[] = allTriples.map((t) => ({
      id: t.id,
      subject: t.subject,
      predicate: t.predicate,
      object: t.object,
      confidence: t.confidence,
    }));

    const adj = buildAdjacencyList(tripleData);
    const reachable = bfsTraversal([...seedEntities], adj, hops, limit);

    // Filter triples to subgraph
    const subgraphTriples = tripleData.filter(
      (t) => reachable.has(t.subject) && reachable.has(t.object),
    );

    return {
      success: true,
      query,
      seedEntities: [...seedEntities],
      subgraph: {
        nodes: [...reachable].map((n) => ({ id: n, label: n })),
        edges: subgraphTriples.map((t) => ({ source: t.subject, target: t.object, predicate: t.predicate })),
      },
      tripleCount: subgraphTriples.length,
    };
  });

  /**
   * POST /kg/traverse
   * BFS traversal from a specific entity.
   */
  app.post("/kg/traverse", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = traverseSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { startEntity, hops = 2, predicate } = parsed.data;

    const allTriples = await db
      .select()
      .from(memoryTriples)
      .where(eq(memoryTriples.userId, userId));

    const tripleData: Triple[] = allTriples
      .filter((t) => !predicate || t.predicate === predicate)
      .map((t) => ({ id: t.id, subject: t.subject, predicate: t.predicate, object: t.object, confidence: t.confidence }));

    const adj = buildAdjacencyList(tripleData);
    const reachable = bfsTraversal([startEntity], adj, hops, 100);

    const subgraphTriples = tripleData.filter(
      (t) => reachable.has(t.subject) && reachable.has(t.object),
    );

    return {
      success: true,
      startEntity,
      hops,
      reachableNodes: [...reachable],
      triples: subgraphTriples,
    };
  });

  /**
   * GET /kg/communities
   * Return community structure for the knowledge graph.
   */
  app.get("/kg/communities", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const triples = await db
      .select()
      .from(memoryTriples)
      .where(eq(memoryTriples.userId, userId));

    const tripleData: Triple[] = triples.map((t) => ({
      id: t.id, subject: t.subject, predicate: t.predicate, object: t.object, confidence: t.confidence,
    }));

    const adj = buildAdjacencyList(tripleData);
    const nodeNames = [...adj.keys()];
    const communities = detectCommunities(nodeNames, adj);

    // Group by community
    const groups = new Map<number, string[]>();
    for (const [node, cid] of communities) {
      if (!groups.has(cid)) groups.set(cid, []);
      groups.get(cid)!.push(node);
    }

    const result = [...groups.entries()]
      .map(([cid, members]) => ({ communityId: cid, members, size: members.length }))
      .sort((a, b) => b.size - a.size);

    return { success: true, communities: result, count: result.length };
  });
}

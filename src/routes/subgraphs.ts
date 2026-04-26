/**
 * Reusable Subgraph Components — Phase 4.12
 *
 * LangGraph-inspired reusable subgraphs:
 * A subgraph is a named, parameterized workflow snippet that can be
 * embedded into any workflow as a single "subgraph" node.
 *
 * Features:
 * - Save any workflow (or subgraph) as a reusable component
 * - Parameterize inputs (define required input schema)
 * - Instantiate a subgraph inside another workflow by reference
 * - Version management
 *
 * Inspired by:
 * - LangGraph (langchain-ai/langgraph, 12k stars) — composable subgraphs
 * - Windmill — module/flow reuse across scripts
 * - n8n — sub-workflow nodes
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { workflows } from "../db/schema/workflows.js";
import { eq, and, ilike, desc } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";

// ─── In-memory subgraph registry ─────────────────────────────────────────────
// For production, store in DB. Reuses workflow table via isSubgraph flag in meta.

interface SubgraphEntry {
  id: string;
  userId: number;
  name: string;
  description: string;
  /** The workflow definition nodes+edges */
  definition: Record<string, unknown>;
  /** JSON schema of required input parameters */
  inputSchema: Record<string, unknown>;
  /** Output node ids */
  outputNodes: string[];
  version: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const subgraphRegistry = new Map<string, SubgraphEntry>();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createSubgraphSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  /** The workflow definition (nodes + edges) */
  definition:  z.object({
    nodes: z.array(z.record(z.string(), z.unknown())),
    edges: z.array(z.record(z.string(), z.unknown())),
  }),
  /** JSON schema for required inputs */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  /** Which node ids represent outputs */
  outputNodes: z.array(z.string()).optional(),
  tags:        z.array(z.string()).max(10).optional(),
  /** Optionally save from an existing workflow */
  workflowId:  z.string().uuid().optional(),
});

const updateSubgraphSchema = createSubgraphSchema.partial().omit({ workflowId: true });

const instantiateSchema = z.object({
  subgraphId:  z.string().min(1),
  /** Input values to pass to the subgraph */
  inputs:      z.record(z.string(), z.unknown()).optional(),
  /** When embedding: the node id to use in the parent workflow */
  nodeId:      z.string().optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function subgraphPlugin(app: FastifyInstance) {

  /**
   * POST /subgraphs
   * Create a new reusable subgraph.
   * Optionally extract from an existing workflow.
   */
  app.post("/subgraphs", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createSubgraphSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    let { name, description, definition, inputSchema, outputNodes, tags, workflowId } = parsed.data;

    // Optionally load definition from an existing workflow
    if (workflowId) {
      const [wf] = await db
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)))
        .limit(1);
      if (!wf) return reply.status(404).send({ error: "Source workflow not found" });
      definition = wf.definition as typeof definition;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const entry: SubgraphEntry = {
      id,
      userId,
      name,
      description: description ?? "",
      definition: definition as Record<string, unknown>,
      inputSchema: inputSchema ?? {},
      outputNodes: outputNodes ?? [],
      version: 1,
      tags: tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    subgraphRegistry.set(id, entry);

    return reply.status(201).send({ success: true, subgraph: entry });
  });

  /**
   * GET /subgraphs
   * List all subgraphs for the user.
   */
  app.get("/subgraphs", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { search } = req.query as { search?: string };
    let results = [...subgraphRegistry.values()].filter((s) => s.userId === userId);

    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return { success: true, subgraphs: results.map((s) => ({ ...s, definition: undefined })), count: results.length };
  });

  /**
   * GET /subgraphs/:id
   * Get a subgraph with full definition.
   */
  app.get("/subgraphs/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const entry = subgraphRegistry.get(id);
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: "Subgraph not found" });
    }
    return { success: true, subgraph: entry };
  });

  /**
   * PATCH /subgraphs/:id
   * Update a subgraph (increments version).
   */
  app.patch("/subgraphs/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const entry = subgraphRegistry.get(id);
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: "Subgraph not found" });
    }

    const parsed = updateSubgraphSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const updated: SubgraphEntry = {
      ...entry,
      ...parsed.data,
      definition: (parsed.data.definition as Record<string, unknown>) ?? entry.definition,
      inputSchema: parsed.data.inputSchema ?? entry.inputSchema,
      outputNodes: parsed.data.outputNodes ?? entry.outputNodes,
      version: entry.version + 1,
      updatedAt: new Date().toISOString(),
    };
    subgraphRegistry.set(id, updated);

    return { success: true, subgraph: updated };
  });

  /**
   * DELETE /subgraphs/:id
   * Remove a subgraph.
   */
  app.delete("/subgraphs/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const entry = subgraphRegistry.get(id);
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: "Subgraph not found" });
    }
    subgraphRegistry.delete(id);
    return { success: true };
  });

  /**
   * POST /subgraphs/:id/instantiate
   * Produce a workflow node spec that embeds this subgraph.
   * Returns a node definition ready to be added to a parent workflow's nodes array.
   */
  app.post("/subgraphs/:id/instantiate", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const entry = subgraphRegistry.get(id);
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: "Subgraph not found" });
    }

    const parsed = instantiateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { inputs, nodeId } = parsed.data;

    // Validate required inputs against the subgraph's input schema
    const requiredFields = Object.entries(entry.inputSchema)
      .filter(([, v]) => (v as Record<string, unknown>)?.required === true)
      .map(([k]) => k);
    const missing = requiredFields.filter((f) => !(inputs ?? {})[f]);
    if (missing.length > 0) {
      return reply.status(400).send({ error: `Missing required inputs: ${missing.join(", ")}` });
    }

    // Build a "subgraph" node that the executor can expand
    const node = {
      id: nodeId ?? `subgraph_${id.slice(0, 8)}_${Date.now()}`,
      type: "subgraph",
      data: {
        subgraphId: id,
        subgraphVersion: entry.version,
        subgraphName: entry.name,
        inputs: inputs ?? {},
        definition: entry.definition,
        outputNodes: entry.outputNodes,
      },
      position: { x: 0, y: 0 },
    };

    return {
      success: true,
      node,
      subgraphName: entry.name,
      version: entry.version,
    };
  });

  /**
   * GET /subgraphs/:id/clone
   * Duplicate a subgraph as a new independent copy.
   */
  app.post("/subgraphs/:id/clone", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const entry = subgraphRegistry.get(id);
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: "Subgraph not found" });
    }

    const newId = randomUUID();
    const now = new Date().toISOString();
    const clone: SubgraphEntry = {
      ...entry,
      id: newId,
      name: `${entry.name} (copy)`,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    subgraphRegistry.set(newId, clone);

    return reply.status(201).send({ success: true, subgraph: clone });
  });
}

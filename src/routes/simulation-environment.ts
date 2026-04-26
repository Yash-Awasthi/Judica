/**
 * Simulation Mode — Phase 5.2: Simulation Environment Setup
 *
 * Inspired by:
 * - AgentScope (modelscope/agentscope, Apache 2.0, Alibaba, 6k stars) — multi-agent
 *   simulation with structured environment abstractions.
 * - ChatArena (chatarena/chatarena, Apache 2.0) — multi-agent language game environments.
 * - MiroFish (666ghj/MiroFish) — high-fidelity parallel digital world for swarm simulation.
 *
 * An environment is the "world" that personas inhabit:
 * - Defines rules, constraints, and available information
 * - Can be seeded from real documents/news or fictional premises
 * - Shared context injected into all persona prompts in a simulation
 * - Supports timestep notion for tick-based simulation (Phase 5.3)
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SimEnvironment {
  id: string;
  userId: number;
  name: string;
  /** One-line premise / setting */
  premise: string;
  /** Detailed world description */
  worldDescription: string;
  /** Rules governing what can/cannot happen */
  rules: string[];
  /** Starting conditions / initial state */
  startingConditions: string[];
  /** Information all agents have access to */
  sharedKnowledge: string[];
  /** Private information per persona (personaId → facts) */
  privateKnowledge: Record<string, string[]>;
  /** Current tick / timestep */
  tick: number;
  /** World events log (injected each tick) */
  eventLog: Array<{ tick: number; event: string; timestamp: Date }>;
  /** Scenario type */
  scenarioType: "business" | "political" | "social" | "historical" | "fictional" | "technical" | "custom";
  /** Source documents used to seed the environment */
  seedDocuments: string[];
  createdAt: Date;
  updatedAt: Date;
}

// In-memory store
const envStore = new Map<string, SimEnvironment>();
let envCounter = 1;

function envId(): string {
  return `env_${Date.now()}_${envCounter++}`;
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = () => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
});

async function generateEnvironment(premise: string, scenarioType: string): Promise<{
  worldDescription: string;
  rules: string[];
  startingConditions: string[];
  sharedKnowledge: string[];
}> {
  const prompt = `You are a world-builder AI designing a simulation environment.

Premise: "${premise}"
Scenario Type: ${scenarioType}

Generate a realistic, detailed environment. Return ONLY valid JSON:
{
  "worldDescription": "2-3 paragraph description of the world/setting",
  "rules": ["rule governing what can happen", "rule 2", "rule 3"],
  "startingConditions": ["initial state fact 1", "initial state fact 2", "initial state fact 3"],
  "sharedKnowledge": ["piece of information all agents know", "shared fact 2", "shared fact 3"]
}`;

  const response = await askProvider(llmProvider(), [{ role: "user", content: prompt }]);
  const text = typeof response === "string" ? response : (response as any)?.content ?? "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fall through */ }

  return {
    worldDescription: `A ${scenarioType} simulation based on: ${premise}`,
    rules: ["Agents act according to their goals and constraints", "Time advances in discrete ticks"],
    startingConditions: ["Simulation begins at tick 0", premise],
    sharedKnowledge: [premise],
  };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const createEnvSchema = z.object({
  name:            z.string().min(1).max(200),
  premise:         z.string().min(1).max(2000),
  scenarioType:    z.enum(["business", "political", "social", "historical", "fictional", "technical", "custom"]).default("custom"),
  worldDescription: z.string().max(5000).optional(),
  rules:           z.array(z.string().max(500)).max(20).optional(),
  startingConditions: z.array(z.string().max(500)).max(20).optional(),
  sharedKnowledge: z.array(z.string().max(500)).max(30).optional(),
  seedDocuments:   z.array(z.string().max(5000)).max(5).optional(),
});

const injectEventSchema = z.object({
  event:     z.string().min(1).max(1000),
  advanceTick: z.boolean().default(true),
});

const privateKnowledgeSchema = z.object({
  personaId: z.string().min(1),
  facts:     z.array(z.string().max(500)).min(1).max(20),
});

const updateEnvSchema = z.object({
  name:            z.string().max(200).optional(),
  premise:         z.string().max(2000).optional(),
  worldDescription: z.string().max(5000).optional(),
  rules:           z.array(z.string().max(500)).max(20).optional(),
  startingConditions: z.array(z.string().max(500)).max(20).optional(),
  sharedKnowledge: z.array(z.string().max(500)).max(30).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function simulationEnvironmentPlugin(app: FastifyInstance) {

  /**
   * POST /simulate/environments
   * Create a simulation environment.
   * LLM auto-generates world description, rules, starting conditions if not provided.
   */
  app.post("/simulate/environments", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createEnvSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { premise, scenarioType, seedDocuments = [], ...overrides } = parsed.data;

    // Enrich premise with seed documents
    const enrichedPremise = seedDocuments.length > 0
      ? `${premise}\n\nSource material:\n${seedDocuments.slice(0, 3).map((d, i) => `[Doc ${i + 1}] ${d.slice(0, 500)}`).join("\n\n")}`
      : premise;

    // Auto-generate if not provided
    const generated = (overrides.worldDescription && overrides.rules && overrides.startingConditions)
      ? { worldDescription: overrides.worldDescription, rules: overrides.rules ?? [], startingConditions: overrides.startingConditions ?? [], sharedKnowledge: overrides.sharedKnowledge ?? [] }
      : await generateEnvironment(enrichedPremise, scenarioType);

    const id = envId();
    const now = new Date();

    const simEnv: SimEnvironment = {
      id,
      userId,
      name:               overrides.name,
      premise,
      scenarioType,
      worldDescription:   overrides.worldDescription ?? generated.worldDescription,
      rules:              overrides.rules             ?? generated.rules,
      startingConditions: overrides.startingConditions ?? generated.startingConditions,
      sharedKnowledge:    overrides.sharedKnowledge   ?? generated.sharedKnowledge,
      privateKnowledge:   {},
      seedDocuments,
      tick:               0,
      eventLog:           [],
      createdAt: now,
      updatedAt: now,
    };

    envStore.set(id, simEnv);
    return reply.status(201).send({ success: true, environment: simEnv });
  });

  /**
   * GET /simulate/environments
   * List all environments for the current user.
   */
  app.get("/simulate/environments", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const environments = [...envStore.values()]
      .filter(e => e.userId === userId)
      .map(e => ({
        id: e.id, name: e.name, premise: e.premise,
        scenarioType: e.scenarioType, tick: e.tick,
        eventCount: e.eventLog.length, createdAt: e.createdAt,
      }));

    return reply.send({ success: true, environments, count: environments.length });
  });

  /**
   * GET /simulate/environments/:id
   * Get full environment details.
   */
  app.get("/simulate/environments/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simEnv = envStore.get(id);
    if (!simEnv || simEnv.userId !== userId) {
      return reply.status(404).send({ error: "Environment not found" });
    }

    return reply.send({ success: true, environment: simEnv });
  });

  /**
   * PATCH /simulate/environments/:id
   * Update environment fields.
   */
  app.patch("/simulate/environments/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simEnv = envStore.get(id);
    if (!simEnv || simEnv.userId !== userId) {
      return reply.status(404).send({ error: "Environment not found" });
    }

    const parsed = updateEnvSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    Object.assign(simEnv, { ...parsed.data, updatedAt: new Date() });
    return reply.send({ success: true, environment: simEnv });
  });

  /**
   * DELETE /simulate/environments/:id
   */
  app.delete("/simulate/environments/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simEnv = envStore.get(id);
    if (!simEnv || simEnv.userId !== userId) {
      return reply.status(404).send({ error: "Environment not found" });
    }

    envStore.delete(id);
    return reply.send({ success: true });
  });

  /**
   * POST /simulate/environments/:id/events
   * Inject a world event into the environment (optionally advance the tick).
   */
  app.post("/simulate/environments/:id/events", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simEnv = envStore.get(id);
    if (!simEnv || simEnv.userId !== userId) {
      return reply.status(404).send({ error: "Environment not found" });
    }

    const parsed = injectEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { event, advanceTick } = parsed.data;
    if (advanceTick) simEnv.tick++;

    simEnv.eventLog.push({ tick: simEnv.tick, event, timestamp: new Date() });
    simEnv.updatedAt = new Date();

    return reply.send({ success: true, tick: simEnv.tick, eventCount: simEnv.eventLog.length });
  });

  /**
   * GET /simulate/environments/:id/events
   * Get the event log.
   */
  app.get("/simulate/environments/:id/events", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simEnv = envStore.get(id);
    if (!simEnv || simEnv.userId !== userId) {
      return reply.status(404).send({ error: "Environment not found" });
    }

    const { since } = req.query as { since?: string };
    const events = since
      ? simEnv.eventLog.filter(e => e.tick >= Number(since))
      : simEnv.eventLog;

    return reply.send({ success: true, tick: simEnv.tick, events, count: events.length });
  });

  /**
   * POST /simulate/environments/:id/private-knowledge
   * Add private knowledge for a specific persona.
   */
  app.post("/simulate/environments/:id/private-knowledge", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simEnv = envStore.get(id);
    if (!simEnv || simEnv.userId !== userId) {
      return reply.status(404).send({ error: "Environment not found" });
    }

    const parsed = privateKnowledgeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { personaId, facts } = parsed.data;
    simEnv.privateKnowledge[personaId] = [
      ...(simEnv.privateKnowledge[personaId] ?? []),
      ...facts,
    ].slice(0, 30);
    simEnv.updatedAt = new Date();

    return reply.send({ success: true, personaId, factCount: simEnv.privateKnowledge[personaId].length });
  });

  /**
   * GET /simulate/environments/:id/context
   * Get the full context string ready to inject into a persona's prompt.
   * Used by Phase 5.3 (simulation engine).
   */
  app.get("/simulate/environments/:id/context", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const { personaId } = req.query as { personaId?: string };
    const simEnv = envStore.get(id);
    if (!simEnv || simEnv.userId !== userId) {
      return reply.status(404).send({ error: "Environment not found" });
    }

    const context = buildEnvironmentContext(simEnv, personaId);
    return reply.send({ success: true, context, tick: simEnv.tick });
  });
}

// ─── Helper: build context string for injection ───────────────────────────────

export function buildEnvironmentContext(simEnv: SimEnvironment, personaId?: string): string {
  const lines: string[] = [
    `WORLD: ${simEnv.name}`,
    `SETTING: ${simEnv.worldDescription}`,
    "",
    "RULES:",
    ...simEnv.rules.map(r => `- ${r}`),
    "",
    "STARTING CONDITIONS:",
    ...simEnv.startingConditions.map(c => `- ${c}`),
    "",
    "SHARED KNOWLEDGE:",
    ...simEnv.sharedKnowledge.map(k => `- ${k}`),
    "",
    `CURRENT TICK: ${simEnv.tick}`,
  ];

  if (simEnv.eventLog.length > 0) {
    const recentEvents = simEnv.eventLog.slice(-5);
    lines.push("", "RECENT WORLD EVENTS:");
    for (const e of recentEvents) {
      lines.push(`- [Tick ${e.tick}] ${e.event}`);
    }
  }

  if (personaId && simEnv.privateKnowledge[personaId]?.length > 0) {
    lines.push("", "YOUR PRIVATE KNOWLEDGE (only you know this):");
    for (const fact of simEnv.privateKnowledge[personaId]) {
      lines.push(`- ${fact}`);
    }
  }

  return lines.join("\n");
}

export function getSimEnvironment(id: string): SimEnvironment | undefined {
  return envStore.get(id);
}

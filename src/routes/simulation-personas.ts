/**
 * Simulation Mode — Phase 5.1: On-the-fly Persona Spawning
 *
 * Inspired by:
 * - Generative Agents (joonspk-research/generative_agents, 18k stars) — believable simulacra
 *   with memory, reflection, and planning.
 * - CAMEL (camel-ai/camel, Apache 2.0, 6k stars) — role-playing agent framework
 *   with persona injection.
 * - TinyTroupe (microsoft/TinyTroupe, MIT) — LLM-powered multiagent persona simulation.
 *
 * Any persona, any time — no pre-built list:
 * - Define via free-text description OR structured fields
 * - Auto-generate backstory/goals/constraints from description via LLM
 * - Personas persist in memory; can be referenced in simulations (Phase 5.2+)
 * - Chat directly with a persona (Phase 5.5 preview: /simulate/personas/:id/chat)
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Persona {
  id: string;
  userId: number;
  name: string;
  /** Free-text description the user provided */
  description: string;
  /** Auto-generated or user-supplied backstory */
  backstory: string;
  goals: string[];
  /** Behavioural constraints (what this persona won't do / believes strongly) */
  constraints: string[];
  /** Personality traits */
  traits: string[];
  /** Domain knowledge / expertise */
  expertise: string[];
  /** Communication style */
  communicationStyle: string;
  /** Memory: recent events / observations in current simulation */
  memory: string[];
  createdAt: Date;
  updatedAt: Date;
}

// In-memory store (sufficient for simulation sessions; persist to DB in prod)
const personaStore = new Map<string, Persona>();
let personaCounter = 1;

function personaId(): string {
  return `persona_${Date.now()}_${personaCounter++}`;
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = () => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
});

async function generatePersonaProfile(description: string): Promise<{
  name: string;
  backstory: string;
  goals: string[];
  constraints: string[];
  traits: string[];
  expertise: string[];
  communicationStyle: string;
}> {
  const prompt = `You are a world-building AI. Given a persona description, generate a rich, believable profile.

Description: "${description}"

Return ONLY valid JSON with this exact shape:
{
  "name": "Full name or identifier",
  "backstory": "2-3 sentence backstory explaining who this persona is and how they got here",
  "goals": ["goal 1", "goal 2", "goal 3"],
  "constraints": ["what they won't do or believe", "strong moral or practical constraint"],
  "traits": ["personality trait 1", "personality trait 2", "personality trait 3"],
  "expertise": ["domain they know well"],
  "communicationStyle": "brief description of how they communicate (formal/casual/aggressive/etc.)"
}`;

  const response = await askProvider(llmProvider(), [{ role: "user", content: prompt }]);
  const text = typeof response === "string" ? response : (response as any)?.content ?? "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fall through to defaults */ }

  // Fallback: minimal persona from description
  return {
    name: description.split(" ").slice(0, 3).join(" "),
    backstory: `${description}. They have a unique perspective shaped by their experiences.`,
    goals: ["Pursue their objectives", "Act according to their values"],
    constraints: ["Won't act against their core beliefs"],
    traits: ["Determined", "Authentic"],
    expertise: [],
    communicationStyle: "Speaks naturally and authentically",
  };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const spawnSchema = z.object({
  description: z.string().min(1).max(2000),
  /** Override auto-generated name */
  name:        z.string().max(100).optional(),
  /** Override auto-generated backstory */
  backstory:   z.string().max(3000).optional(),
  goals:       z.array(z.string().max(200)).max(10).optional(),
  constraints: z.array(z.string().max(200)).max(10).optional(),
  traits:      z.array(z.string().max(100)).max(10).optional(),
  expertise:   z.array(z.string().max(100)).max(10).optional(),
  communicationStyle: z.string().max(300).optional(),
});

const chatSchema = z.object({
  message:    z.string().min(1).max(4000),
  /** Context to inject (e.g., current simulation state) */
  context:    z.string().max(2000).optional(),
  /** Add this exchange to persona memory */
  remember:   z.boolean().default(false),
});

const updateSchema = z.object({
  name:        z.string().max(100).optional(),
  backstory:   z.string().max(3000).optional(),
  goals:       z.array(z.string().max(200)).max(10).optional(),
  constraints: z.array(z.string().max(200)).max(10).optional(),
  traits:      z.array(z.string().max(100)).max(10).optional(),
  expertise:   z.array(z.string().max(100)).max(10).optional(),
  communicationStyle: z.string().max(300).optional(),
  memory:      z.array(z.string().max(500)).max(50).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function simulationPersonasPlugin(app: FastifyInstance) {

  /**
   * POST /simulate/personas
   * Spawn a new persona from a description.
   * LLM auto-generates backstory, goals, constraints if not provided.
   */
  app.post("/simulate/personas", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = spawnSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { description, ...overrides } = parsed.data;

    // Auto-generate profile from description
    const generated = await generatePersonaProfile(description);

    const id = personaId();
    const now = new Date();

    const persona: Persona = {
      id,
      userId,
      description,
      name:               overrides.name               ?? generated.name,
      backstory:          overrides.backstory          ?? generated.backstory,
      goals:              overrides.goals              ?? generated.goals,
      constraints:        overrides.constraints        ?? generated.constraints,
      traits:             overrides.traits             ?? generated.traits,
      expertise:          overrides.expertise          ?? generated.expertise,
      communicationStyle: overrides.communicationStyle ?? generated.communicationStyle,
      memory: [],
      createdAt: now,
      updatedAt: now,
    };

    personaStore.set(id, persona);

    return reply.status(201).send({ success: true, persona });
  });

  /**
   * GET /simulate/personas
   * List all personas for the current user.
   */
  app.get("/simulate/personas", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const personas = [...personaStore.values()].filter(p => p.userId === userId);
    return reply.send({ success: true, personas, count: personas.length });
  });

  /**
   * GET /simulate/personas/:id
   * Get a single persona.
   */
  app.get("/simulate/personas/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const persona = personaStore.get(id);
    if (!persona || persona.userId !== userId) {
      return reply.status(404).send({ error: "Persona not found" });
    }

    return reply.send({ success: true, persona });
  });

  /**
   * PATCH /simulate/personas/:id
   * Update a persona's fields.
   */
  app.patch("/simulate/personas/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const persona = personaStore.get(id);
    if (!persona || persona.userId !== userId) {
      return reply.status(404).send({ error: "Persona not found" });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    Object.assign(persona, { ...parsed.data, updatedAt: new Date() });
    return reply.send({ success: true, persona });
  });

  /**
   * DELETE /simulate/personas/:id
   * Remove a persona.
   */
  app.delete("/simulate/personas/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const persona = personaStore.get(id);
    if (!persona || persona.userId !== userId) {
      return reply.status(404).send({ error: "Persona not found" });
    }

    personaStore.delete(id);
    return reply.send({ success: true });
  });

  /**
   * POST /simulate/personas/:id/chat
   * Chat directly with a persona — they respond in character.
   * Phase 5.5 preview: full simulation context will be injected here.
   */
  app.post("/simulate/personas/:id/chat", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const persona = personaStore.get(id);
    if (!persona || persona.userId !== userId) {
      return reply.status(404).send({ error: "Persona not found" });
    }

    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { message, context, remember } = parsed.data;

    // Build persona system prompt
    const systemPrompt = `You are ${persona.name}. Respond ONLY as this persona — never break character.

BACKSTORY: ${persona.backstory}

GOALS:
${persona.goals.map(g => `- ${g}`).join("\n")}

CONSTRAINTS (things you won't do or believe):
${persona.constraints.map(c => `- ${c}`).join("\n")}

PERSONALITY TRAITS: ${persona.traits.join(", ")}
EXPERTISE: ${persona.expertise.join(", ") || "varies"}
COMMUNICATION STYLE: ${persona.communicationStyle}

MEMORY (recent events relevant to you):
${persona.memory.length > 0 ? persona.memory.slice(-10).map(m => `- ${m}`).join("\n") : "(none yet)"}

${context ? `CURRENT CONTEXT:\n${context}` : ""}

Respond authentically as ${persona.name}, from their perspective and in their voice.`;

    const provider = {
      ...llmProvider(),
      systemPrompt,
    };

    const response = await askProvider(provider, [{ role: "user", content: message }]);
    const reply_text = typeof response === "string" ? response : (response as any)?.content ?? "";

    // Optionally update persona memory with this exchange
    if (remember) {
      const memoryEntry = `[Chat] User asked: "${message.slice(0, 100)}..." → responded in character`;
      persona.memory.push(memoryEntry);
      if (persona.memory.length > 50) persona.memory.shift(); // rolling window
      persona.updatedAt = new Date();
    }

    return reply.send({
      success: true,
      personaId: id,
      personaName: persona.name,
      message: reply_text,
    });
  });

  /**
   * POST /simulate/personas/:id/memory
   * Inject a memory event into a persona (e.g., from simulation tick).
   */
  app.post("/simulate/personas/:id/memory", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const persona = personaStore.get(id);
    if (!persona || persona.userId !== userId) {
      return reply.status(404).send({ error: "Persona not found" });
    }

    const { event } = req.body as { event?: string };
    if (!event || typeof event !== "string") {
      return reply.status(400).send({ error: "event string required" });
    }

    persona.memory.push(event.slice(0, 500));
    if (persona.memory.length > 50) persona.memory.shift();
    persona.updatedAt = new Date();

    return reply.send({ success: true, memoryCount: persona.memory.length });
  });

  /**
   * GET /simulate/personas/:id/reflect
   * Ask the persona to reflect on their current situation and state of mind.
   * Generative Agents "reflection" pattern.
   */
  app.get("/simulate/personas/:id/reflect", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const persona = personaStore.get(id);
    if (!persona || persona.userId !== userId) {
      return reply.status(404).send({ error: "Persona not found" });
    }

    const reflectionPrompt = `You are ${persona.name}.
Backstory: ${persona.backstory}
Goals: ${persona.goals.join(", ")}
Recent memory: ${persona.memory.slice(-5).join(" | ") || "nothing significant yet"}

Write a brief first-person reflection (3-5 sentences) on your current state of mind, what matters most to you right now, and what you plan to do next. Stay fully in character.`;

    const response = await askProvider(llmProvider(), [{ role: "user", content: reflectionPrompt }]);
    const reflection = typeof response === "string" ? response : (response as any)?.content ?? "";

    return reply.send({
      success: true,
      personaId: id,
      personaName: persona.name,
      reflection,
    });
  });
}

// ─── Exported accessor for simulation engine (Phase 5.2+) ────────────────────

export function getPersona(id: string): Persona | undefined {
  return personaStore.get(id);
}

export function getPersonasForUser(userId: number): Persona[] {
  return [...personaStore.values()].filter(p => p.userId === userId);
}

export function injectPersonaMemory(id: string, event: string): void {
  const persona = personaStore.get(id);
  if (!persona) return;
  persona.memory.push(event.slice(0, 500));
  if (persona.memory.length > 50) persona.memory.shift();
  persona.updatedAt = new Date();
}

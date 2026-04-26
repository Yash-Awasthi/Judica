/**
 * Simulation Mode — Phase 5.5: Chat With Individual Agents
 *
 * Inspired by:
 * - Character.AI — conversational AI with persistent character personas.
 * - SillyTavern (SillyTavern/SillyTavern, AGPL, 9k stars) — multi-character chat
 *   with persistent persona memory.
 *
 * Talk directly to any spawned persona during or after a simulation.
 * - Full simulation context injected (world state, tick, other agents' recent actions)
 * - Multi-turn conversation with memory persistence
 * - Persona stays in character throughout
 * - "Hot-seat" mode: speak to multiple personas in the same thread
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";
import { getPersona, injectPersonaMemory } from "./simulation-personas.js";
import { getSimEnvironment, buildEnvironmentContext } from "./simulation-environment.js";
import { getSimulation } from "./simulation-runner.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatSession {
  id: string;
  userId: number;
  personaId: string;
  simulationId?: string;
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp: Date }>;
  createdAt: Date;
  updatedAt: Date;
}

const chatSessionStore = new Map<string, ChatSession>();
let sessionCounter = 1;

function sessionId(): string {
  return `chat_${Date.now()}_${sessionCounter++}`;
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = (systemPrompt: string) => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
  systemPrompt,
});

function buildPersonaSystemPrompt(
  personaId: string,
  simulationId?: string,
): string | null {
  const persona = getPersona(personaId);
  if (!persona) return null;

  const lines: string[] = [
    `You are ${persona.name}. Stay in character at all times — never break the fourth wall, never refer to yourself as an AI.`,
    "",
    `BACKSTORY: ${persona.backstory}`,
    "",
    `GOALS: ${persona.goals.join("; ")}`,
    `CONSTRAINTS: ${persona.constraints.join("; ")}`,
    `TRAITS: ${persona.traits.join(", ")}`,
    `EXPERTISE: ${persona.expertise.join(", ") || "varies"}`,
    `COMMUNICATION STYLE: ${persona.communicationStyle}`,
    "",
    "MEMORY (what you've experienced):",
    ...persona.memory.slice(-10).map(m => `  - ${m}`),
  ];

  if (simulationId) {
    const simulation = getSimulation(simulationId);
    if (simulation) {
      const simEnv = getSimEnvironment(simulation.environmentId);
      if (simEnv) {
        lines.push("", "CURRENT SIMULATION CONTEXT:");
        lines.push(buildEnvironmentContext(simEnv, personaId));

        const recentTick = simulation.tickLog[simulation.tickLog.length - 1];
        if (recentTick) {
          lines.push("", "WHAT JUST HAPPENED (most recent tick):");
          for (const action of recentTick.actions) {
            lines.push(`  ${action.personaName}: ${action.action}`);
          }
        }
      }
    }
  }

  lines.push(
    "",
    `Respond authentically as ${persona.name}. You may ask questions, express emotions, argue, agree — whatever feels right for this persona.`,
    "Keep responses concise (2-4 sentences) unless the topic demands more.",
  );

  return lines.join("\n");
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const startChatSchema = z.object({
  personaId:    z.string().min(1),
  simulationId: z.string().optional(),
});

const sendMessageSchema = z.object({
  message:  z.string().min(1).max(4000),
  remember: z.boolean().default(true),
});

const hotSeatSchema = z.object({
  personaIds:   z.array(z.string().min(1)).min(2).max(5),
  simulationId: z.string().optional(),
  question:     z.string().min(1).max(2000),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function agentChatPlugin(app: FastifyInstance) {

  /**
   * POST /simulate/chat
   * Start a new chat session with a persona.
   */
  app.post("/simulate/chat", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = startChatSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { personaId, simulationId } = parsed.data;
    const persona = getPersona(personaId);
    if (!persona || persona.userId !== userId) {
      return reply.status(404).send({ error: "Persona not found" });
    }

    const id = sessionId();
    const now = new Date();
    const session: ChatSession = {
      id, userId, personaId, simulationId,
      messages: [], createdAt: now, updatedAt: now,
    };
    chatSessionStore.set(id, session);

    return reply.status(201).send({
      success: true,
      sessionId: id,
      personaName: persona.name,
      personaId,
    });
  });

  /**
   * POST /simulate/chat/:sessionId/messages
   * Send a message and get in-character reply.
   */
  app.post("/simulate/chat/:sessionId/messages", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.params as { sessionId: string };
    const session = chatSessionStore.get(sessionId);
    if (!session || session.userId !== userId) {
      return reply.status(404).send({ error: "Chat session not found" });
    }

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { message, remember } = parsed.data;
    const now = new Date();

    session.messages.push({ role: "user", content: message, timestamp: now });

    const systemPrompt = buildPersonaSystemPrompt(session.personaId, session.simulationId);
    if (!systemPrompt) return reply.status(404).send({ error: "Persona not found" });

    // Build message history for multi-turn (last 20 exchanges)
    const history = session.messages.slice(-40).map(m => ({
      role: m.role,
      content: m.content,
    }));

    const response = await askProvider(llmProvider(systemPrompt), history);
    const replyText = typeof response === "string" ? response : (response as any)?.content ?? "";

    session.messages.push({ role: "assistant", content: replyText, timestamp: new Date() });
    session.updatedAt = new Date();

    if (remember) {
      injectPersonaMemory(session.personaId,
        `[Chat] User asked: "${message.slice(0, 80)}..." — I responded in character`);
    }

    return reply.send({
      success: true,
      message: replyText,
      personaId: session.personaId,
      turnCount: Math.floor(session.messages.length / 2),
    });
  });

  /**
   * GET /simulate/chat/:sessionId
   * Get chat session history.
   */
  app.get("/simulate/chat/:sessionId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.params as { sessionId: string };
    const session = chatSessionStore.get(sessionId);
    if (!session || session.userId !== userId) {
      return reply.status(404).send({ error: "Chat session not found" });
    }

    const persona = getPersona(session.personaId);
    return reply.send({
      success: true,
      session: {
        ...session,
        personaName: persona?.name ?? session.personaId,
      },
    });
  });

  /**
   * GET /simulate/chat
   * List all chat sessions.
   */
  app.get("/simulate/chat", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const sessions = [...chatSessionStore.values()]
      .filter(s => s.userId === userId)
      .map(s => {
        const persona = getPersona(s.personaId);
        return {
          id: s.id,
          personaId: s.personaId,
          personaName: persona?.name ?? s.personaId,
          simulationId: s.simulationId,
          messageCount: s.messages.length,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      });

    return reply.send({ success: true, sessions, count: sessions.length });
  });

  /**
   * DELETE /simulate/chat/:sessionId
   */
  app.delete("/simulate/chat/:sessionId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.params as { sessionId: string };
    const session = chatSessionStore.get(sessionId);
    if (!session || session.userId !== userId) {
      return reply.status(404).send({ error: "Chat session not found" });
    }

    chatSessionStore.delete(sessionId);
    return reply.send({ success: true });
  });

  /**
   * POST /simulate/hot-seat
   * Ask the same question to multiple personas in one request.
   * Returns each persona's in-character answer — great for comparing perspectives.
   */
  app.post("/simulate/hot-seat", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = hotSeatSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { personaIds, simulationId, question } = parsed.data;

    const results = await Promise.allSettled(
      personaIds.map(async (pid) => {
        const persona = getPersona(pid);
        if (!persona || persona.userId !== userId) {
          return { personaId: pid, error: "Not found" };
        }

        const systemPrompt = buildPersonaSystemPrompt(pid, simulationId);
        if (!systemPrompt) return { personaId: pid, error: "Persona system prompt failed" };

        const response = await askProvider(llmProvider(systemPrompt), [
          { role: "user", content: question },
        ]);
        const answer = typeof response === "string" ? response : (response as any)?.content ?? "";

        return { personaId: pid, personaName: persona.name, answer };
      }),
    );

    const responses = results.map(r =>
      r.status === "fulfilled" ? r.value : { error: "Failed" },
    );

    return reply.send({ success: true, question, responses });
  });
}

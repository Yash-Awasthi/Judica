/**
 * Simulation Mode — Phase 5.3: Multi-Agent World Simulation
 *
 * Inspired by:
 * - Generative Agents: Interactive Simulacra (Park et al., 2023, Stanford) — foundational
 *   paper on LLM-powered agent societies (arxiv 2304.03442).
 * - TinyTroupe (microsoft/TinyTroupe, MIT) — LLM multiagent persona simulation for
 *   business insights, market research, brainstorming.
 * - AI Town (a16z-infra/ai-town, MIT, a16z, 8k stars) — interactive agent town
 *   for exploring emergent social behaviour.
 *
 * The council orchestrates N personas in a shared environment:
 * - Each agent acts from their own perspective, goals, memory
 * - Agents can interact with each other (messages injected into memories)
 * - Each tick: all agents observe world + each other → take action → world updates
 * - Results streamed via SSE or returned as full run
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";
import { getPersona, injectPersonaMemory, type Persona } from "./simulation-personas.js";
import { getSimEnvironment, buildEnvironmentContext, type SimEnvironment } from "./simulation-environment.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Simulation {
  id: string;
  userId: number;
  name: string;
  environmentId: string;
  personaIds: string[];
  status: "idle" | "running" | "paused" | "completed";
  currentTick: number;
  maxTicks: number;
  tickLog: SimTick[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SimTick {
  tick: number;
  actions: SimAction[];
  worldEvent?: string;
  timestamp: Date;
}

export interface SimAction {
  personaId: string;
  personaName: string;
  action: string;
  reasoning?: string;
  targetPersonaId?: string;
}

// In-memory store
const simStore = new Map<string, Simulation>();
let simCounter = 1;

function simId(): string {
  return `sim_${Date.now()}_${simCounter++}`;
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = () => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
});

async function getPersonaAction(
  persona: Persona,
  simEnv: SimEnvironment,
  recentActions: SimAction[],
  worldEvent?: string,
): Promise<{ action: string; reasoning: string; targetPersonaId?: string }> {
  const envContext = buildEnvironmentContext(simEnv, persona.id);
  const otherActionsText = recentActions
    .filter(a => a.personaId !== persona.id)
    .map(a => `${a.personaName}: ${a.action}`)
    .join("\n");

  const prompt = `You are ${persona.name} in a simulation. Act from your perspective.

${envContext}

YOUR PROFILE:
Backstory: ${persona.backstory}
Goals: ${persona.goals.join(", ")}
Constraints: ${persona.constraints.join(", ")}
Recent memory: ${persona.memory.slice(-5).join(" | ") || "nothing yet"}

OTHER AGENTS' RECENT ACTIONS:
${otherActionsText || "(none yet this tick)"}

${worldEvent ? `WORLD EVENT THIS TICK: ${worldEvent}` : ""}

What do you do this tick? Respond with JSON:
{
  "action": "what you do (1-2 sentences, first person)",
  "reasoning": "why (1 sentence)",
  "targetPersona": "name of another agent you're interacting with, or null"
}`;

  const response = await askProvider(llmProvider(), [{ role: "user", content: prompt }]);
  const text = typeof response === "string" ? response : (response as any)?.content ?? "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        action: parsed.action ?? "observes the situation",
        reasoning: parsed.reasoning ?? "",
        targetPersonaId: parsed.targetPersona ?? undefined,
      };
    }
  } catch { /* fall through */ }

  return { action: text.slice(0, 200) || "continues their activities", reasoning: "" };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const createSimSchema = z.object({
  name:           z.string().min(1).max(200),
  environmentId:  z.string().min(1),
  personaIds:     z.array(z.string().min(1)).min(1).max(20),
  maxTicks:       z.number().int().min(1).max(100).default(10),
});

const runTickSchema = z.object({
  worldEvent: z.string().max(500).optional(),
  ticks:      z.number().int().min(1).max(10).default(1),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function simulationRunnerPlugin(app: FastifyInstance) {

  /**
   * POST /simulate/runs
   * Create a simulation (doesn't start it yet).
   */
  app.post("/simulate/runs", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createSimSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { name, environmentId, personaIds, maxTicks } = parsed.data;

    // Validate environment + personas exist and belong to user
    const simEnv = getSimEnvironment(environmentId);
    if (!simEnv || simEnv.userId !== userId) {
      return reply.status(404).send({ error: "Environment not found" });
    }

    for (const pid of personaIds) {
      const persona = getPersona(pid);
      if (!persona || persona.userId !== userId) {
        return reply.status(404).send({ error: `Persona ${pid} not found` });
      }
    }

    const id = simId();
    const now = new Date();
    const simulation: Simulation = {
      id, userId, name, environmentId, personaIds,
      status: "idle", currentTick: 0, maxTicks,
      tickLog: [], createdAt: now, updatedAt: now,
    };

    simStore.set(id, simulation);
    return reply.status(201).send({ success: true, simulation });
  });

  /**
   * GET /simulate/runs
   * List simulations.
   */
  app.get("/simulate/runs", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const runs = [...simStore.values()]
      .filter(s => s.userId === userId)
      .map(s => ({
        id: s.id, name: s.name, status: s.status,
        currentTick: s.currentTick, maxTicks: s.maxTicks,
        personaCount: s.personaIds.length, createdAt: s.createdAt,
      }));

    return reply.send({ success: true, runs, count: runs.length });
  });

  /**
   * GET /simulate/runs/:id
   * Get simulation state.
   */
  app.get("/simulate/runs/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simulation = simStore.get(id);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    return reply.send({ success: true, simulation });
  });

  /**
   * POST /simulate/runs/:id/tick
   * Advance the simulation by N ticks.
   * Each tick: all agents observe → act → world updates → memories updated.
   */
  app.post("/simulate/runs/:id/tick", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simulation = simStore.get(id);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    if (simulation.currentTick >= simulation.maxTicks) {
      return reply.status(400).send({ error: "Simulation has reached max ticks", status: "completed" });
    }

    const parsed = runTickSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { worldEvent, ticks } = parsed.data;
    const simEnv = getSimEnvironment(simulation.environmentId);
    if (!simEnv) return reply.status(404).send({ error: "Environment not found" });

    simulation.status = "running";
    const newTicks: SimTick[] = [];

    const ticksToRun = Math.min(ticks, simulation.maxTicks - simulation.currentTick);

    for (let t = 0; t < ticksToRun; t++) {
      simulation.currentTick++;
      simEnv.tick = simulation.currentTick;

      const tickWorldEvent = t === 0 ? worldEvent : undefined;
      if (tickWorldEvent) {
        simEnv.eventLog.push({ tick: simEnv.tick, event: tickWorldEvent, timestamp: new Date() });
      }

      // Each persona acts in parallel
      const actions: SimAction[] = [];
      const actionPromises = simulation.personaIds.map(async (pid) => {
        const persona = getPersona(pid);
        if (!persona) return;

        const { action, reasoning, targetPersonaId } = await getPersonaAction(
          persona, simEnv, actions, tickWorldEvent,
        );

        actions.push({
          personaId: pid,
          personaName: persona.name,
          action,
          reasoning,
          targetPersonaId,
        });

        // Inject this action into persona's memory
        injectPersonaMemory(pid, `[Tick ${simulation.currentTick}] I: ${action}`);

        // Inject into target's memory if interacting
        if (targetPersonaId) {
          injectPersonaMemory(targetPersonaId,
            `[Tick ${simulation.currentTick}] ${persona.name}: ${action}`);
        }
      });

      await Promise.allSettled(actionPromises);

      const tick: SimTick = {
        tick: simulation.currentTick,
        actions,
        worldEvent: tickWorldEvent,
        timestamp: new Date(),
      };
      simulation.tickLog.push(tick);
      newTicks.push(tick);
    }

    simulation.status = simulation.currentTick >= simulation.maxTicks ? "completed" : "idle";
    simulation.updatedAt = new Date();

    return reply.send({
      success: true,
      simulationId: id,
      currentTick: simulation.currentTick,
      maxTicks: simulation.maxTicks,
      status: simulation.status,
      newTicks,
    });
  });

  /**
   * POST /simulate/runs/:id/reset
   * Reset the simulation to tick 0.
   */
  app.post("/simulate/runs/:id/reset", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simulation = simStore.get(id);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    simulation.currentTick = 0;
    simulation.status = "idle";
    simulation.tickLog = [];
    simulation.updatedAt = new Date();

    return reply.send({ success: true, message: "Simulation reset to tick 0" });
  });

  /**
   * GET /simulate/runs/:id/transcript
   * Full readable transcript of the simulation.
   */
  app.get("/simulate/runs/:id/transcript", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simulation = simStore.get(id);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    const lines: string[] = [`# Simulation: ${simulation.name}`, ""];
    for (const tick of simulation.tickLog) {
      lines.push(`## Tick ${tick.tick}${tick.worldEvent ? ` — ${tick.worldEvent}` : ""}`);
      for (const action of tick.actions) {
        lines.push(`**${action.personaName}**: ${action.action}`);
        if (action.reasoning) lines.push(`  _(${action.reasoning})_`);
      }
      lines.push("");
    }

    return reply.send({ success: true, transcript: lines.join("\n"), ticks: simulation.tickLog.length });
  });

  /**
   * DELETE /simulate/runs/:id
   */
  app.delete("/simulate/runs/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const simulation = simStore.get(id);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    simStore.delete(id);
    return reply.send({ success: true });
  });
}

export function getSimulation(id: string): Simulation | undefined {
  return simStore.get(id);
}

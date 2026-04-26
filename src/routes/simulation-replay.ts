/**
 * Simulation Mode — Phase 5.7: Simulation Branching & Replay
 *
 * Inspired by:
 * - LangGraph (langchain-ai/langgraph, MIT) — checkpoint-based time-travel
 *   and state forking for agent workflows.
 * - Redux DevTools (reduxjs/redux-devtools, MIT, 14k stars) — time-travel debugging
 *   pattern: rewind state, replay from any checkpoint.
 *
 * Extends Phase 5.3 simulation runner with:
 * - Named checkpoints (save state at any tick)
 * - Step-back: restore to a previous checkpoint
 * - Replay: re-execute ticks from a checkpoint (with optional new events)
 * - Side-by-side snapshot comparison
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSimulation, type SimTick } from "./simulation-runner.js";
import { getPersona, injectPersonaMemory } from "./simulation-personas.js";
import { getSimEnvironment, buildEnvironmentContext } from "./simulation-environment.js";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimCheckpoint {
  id: string;
  simulationId: string;
  userId: number;
  name: string;
  tick: number;
  /** Deep snapshot of tickLog up to this point */
  tickLogSnapshot: SimTick[];
  /** Notes about what's happening at this checkpoint */
  notes?: string;
  createdAt: Date;
}

const checkpointStore = new Map<string, SimCheckpoint>();
let cpCounter = 1;

function cpId(): string {
  return `cp_${Date.now()}_${cpCounter++}`;
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = () => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
});

// ─── Schema ───────────────────────────────────────────────────────────────────

const createCheckpointSchema = z.object({
  name:  z.string().min(1).max(200),
  notes: z.string().max(500).optional(),
});

const replaySchema = z.object({
  ticks:      z.number().int().min(1).max(20).default(5),
  worldEvent: z.string().max(500).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function simulationReplayPlugin(app: FastifyInstance) {

  /**
   * POST /simulate/runs/:simId/checkpoints
   * Save a named checkpoint at the current tick.
   */
  app.post("/simulate/runs/:simId/checkpoints", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { simId } = req.params as { simId: string };
    const simulation = getSimulation(simId);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    const parsed = createCheckpointSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const id = cpId();
    const checkpoint: SimCheckpoint = {
      id,
      simulationId: simId,
      userId,
      name: parsed.data.name,
      tick: simulation.currentTick,
      tickLogSnapshot: JSON.parse(JSON.stringify(simulation.tickLog)), // deep copy
      notes: parsed.data.notes,
      createdAt: new Date(),
    };
    checkpointStore.set(id, checkpoint);

    return reply.status(201).send({ success: true, checkpoint: {
      id, name: checkpoint.name, tick: checkpoint.tick, notes: checkpoint.notes, createdAt: checkpoint.createdAt,
    }});
  });

  /**
   * GET /simulate/runs/:simId/checkpoints
   * List checkpoints for a simulation.
   */
  app.get("/simulate/runs/:simId/checkpoints", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { simId } = req.params as { simId: string };
    const checkpoints = [...checkpointStore.values()]
      .filter(cp => cp.simulationId === simId && cp.userId === userId)
      .map(cp => ({ id: cp.id, name: cp.name, tick: cp.tick, notes: cp.notes, createdAt: cp.createdAt }))
      .sort((a, b) => a.tick - b.tick);

    return reply.send({ success: true, checkpoints, count: checkpoints.length });
  });

  /**
   * GET /simulate/checkpoints/:id
   * Get full checkpoint including tick log snapshot.
   */
  app.get("/simulate/checkpoints/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const checkpoint = checkpointStore.get(id);
    if (!checkpoint || checkpoint.userId !== userId) {
      return reply.status(404).send({ error: "Checkpoint not found" });
    }

    return reply.send({ success: true, checkpoint });
  });

  /**
   * DELETE /simulate/checkpoints/:id
   */
  app.delete("/simulate/checkpoints/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const checkpoint = checkpointStore.get(id);
    if (!checkpoint || checkpoint.userId !== userId) {
      return reply.status(404).send({ error: "Checkpoint not found" });
    }

    checkpointStore.delete(id);
    return reply.send({ success: true });
  });

  /**
   * POST /simulate/checkpoints/:id/restore
   * Restore a simulation to the state at this checkpoint.
   * This rewinds the simulation's tickLog — future ticks start fresh from this point.
   */
  app.post("/simulate/checkpoints/:id/restore", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const checkpoint = checkpointStore.get(id);
    if (!checkpoint || checkpoint.userId !== userId) {
      return reply.status(404).send({ error: "Checkpoint not found" });
    }

    const simulation = getSimulation(checkpoint.simulationId);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    // Rewind to checkpoint state
    simulation.tickLog = JSON.parse(JSON.stringify(checkpoint.tickLogSnapshot));
    simulation.currentTick = checkpoint.tick;
    simulation.status = "idle";
    simulation.updatedAt = new Date();

    return reply.send({
      success: true,
      message: `Simulation restored to tick ${checkpoint.tick}`,
      currentTick: checkpoint.tick,
      checkpointName: checkpoint.name,
    });
  });

  /**
   * POST /simulate/checkpoints/:id/replay
   * Re-execute N ticks from this checkpoint point.
   * Optionally inject a new world event (divergent replay).
   */
  app.post("/simulate/checkpoints/:id/replay", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const checkpoint = checkpointStore.get(id);
    if (!checkpoint || checkpoint.userId !== userId) {
      return reply.status(404).send({ error: "Checkpoint not found" });
    }

    const parsed = replaySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { ticks, worldEvent } = parsed.data;

    const simulation = getSimulation(checkpoint.simulationId);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    const simEnv = getSimEnvironment(simulation.environmentId);
    if (!simEnv) return reply.status(404).send({ error: "Environment not found" });

    const envContext = buildEnvironmentContext(simEnv);
    const newTicks: SimTick[] = [];
    let replayTick = checkpoint.tick;

    for (let t = 0; t < ticks; t++) {
      replayTick++;
      const actions: Array<{ personaId: string; personaName: string; action: string; reasoning: string }> = [];
      const tickWorldEvent = t === 0 ? worldEvent : undefined;

      const promises = simulation.personaIds.map(async (pid) => {
        const persona = getPersona(pid);
        if (!persona) return;

        // Rebuild memory from checkpoint ticks
        const checkpointMemory = checkpoint.tickLogSnapshot
          .flatMap(tick => tick.actions
            .filter(a => a.personaId === pid)
            .map(a => `[Tick ${tick.tick}] I: ${a.action}`),
          ).slice(-8);

        const prompt = `You are ${persona.name} in a simulation replay.

${envContext}

YOUR PROFILE:
Backstory: ${persona.backstory}
Goals: ${persona.goals.join(", ")}
Constraints: ${persona.constraints.join(", ")}
Checkpoint memory: ${checkpointMemory.join(" | ") || "nothing"}

${tickWorldEvent ? `WORLD EVENT: ${tickWorldEvent}` : ""}
OTHER AGENTS: ${actions.map(a => `${a.personaName}: ${a.action}`).join(" | ") || "(none yet)"}

TICK: ${replayTick}

What do you do? JSON: {"action": "...", "reasoning": "..."}`;

        const response = await askProvider(llmProvider(), [{ role: "user", content: prompt }]);
        const text = typeof response === "string" ? response : (response as any)?.content ?? "";

        let action = "continues their activities";
        let reasoning = "";
        try {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            action = parsed.action ?? action;
            reasoning = parsed.reasoning ?? reasoning;
          }
        } catch { action = text.slice(0, 200) || action; }

        actions.push({ personaId: pid, personaName: persona.name, action, reasoning });
        injectPersonaMemory(pid, `[Replay T${replayTick}] ${action}`);
      });

      await Promise.allSettled(promises);

      const tick: SimTick = { tick: replayTick, actions, worldEvent: tickWorldEvent, timestamp: new Date() };
      newTicks.push(tick);
    }

    return reply.send({
      success: true,
      checkpointId: id,
      checkpointTick: checkpoint.tick,
      replayedTicks: newTicks,
      count: newTicks.length,
    });
  });

  /**
   * GET /simulate/checkpoints/:cpA/diff/:cpB
   * Compare two checkpoints tick-by-tick.
   */
  app.get("/simulate/checkpoints/:cpA/diff/:cpB", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { cpA, cpB } = req.params as { cpA: string; cpB: string };
    const checkA = checkpointStore.get(cpA);
    const checkB = checkpointStore.get(cpB);

    if (!checkA || checkA.userId !== userId || !checkB || checkB.userId !== userId) {
      return reply.status(404).send({ error: "One or both checkpoints not found" });
    }

    const mapA = new Map(checkA.tickLogSnapshot.map(t => [t.tick, t]));
    const mapB = new Map(checkB.tickLogSnapshot.map(t => [t.tick, t]));
    const allTicks = new Set([...mapA.keys(), ...mapB.keys()]);

    const diff = [...allTicks].sort((a, b) => a - b).map(tick => ({
      tick,
      [checkA.name]: mapA.get(tick)?.actions?.map(a => `${a.personaName}: ${a.action}`) ?? [],
      [checkB.name]: mapB.get(tick)?.actions?.map(a => `${a.personaName}: ${a.action}`) ?? [],
    }));

    return reply.send({
      success: true,
      checkpointA: { id: cpA, name: checkA.name, tick: checkA.tick },
      checkpointB: { id: cpB, name: checkB.name, tick: checkB.tick },
      diff,
    });
  });
}

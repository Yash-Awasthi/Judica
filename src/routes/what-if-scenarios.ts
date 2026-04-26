/**
 * Simulation Mode — Phase 5.4: What-If Scenario Runner
 *
 * Inspired by:
 * - MiroFish (666ghj/MiroFish) — swarm intelligence with counterfactual branching.
 * - LangGraph (langchain-ai/langgraph, MIT) — checkpoint-based time-travel and state forking.
 * - Redux DevTools (reduxjs/redux-devtools, MIT, 14k stars) — time-travel debugging pattern.
 * - git worktrees — branch state, mutate, compare.
 *
 * What-if scenarios:
 * - Fork a simulation at any tick → create a branch with a variable change
 * - Run branch forward independently
 * - Compare branches side by side (diff view)
 * - Multiple branches from the same fork point (compare N outcomes)
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";
import { getSimulation, type SimTick } from "./simulation-runner.js";
import { getPersona } from "./simulation-personas.js";
import { getSimEnvironment, buildEnvironmentContext } from "./simulation-environment.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScenarioBranch {
  id: string;
  userId: number;
  parentSimulationId: string;
  forkTick: number;
  name: string;
  /** The "what if" variable injected at fork point */
  variable: string;
  /** Ticks run on this branch after the fork */
  tickLog: SimTick[];
  currentTick: number;
  status: "idle" | "running" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

const branchStore = new Map<string, ScenarioBranch>();
let branchCounter = 1;

function branchId(): string {
  return `branch_${Date.now()}_${branchCounter++}`;
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = () => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
});

async function getPersonaActionInBranch(
  personaId: string,
  personaName: string,
  backstory: string,
  goals: string[],
  constraints: string[],
  memory: string[],
  envContext: string,
  recentActions: Array<{ personaName: string; action: string }>,
  variable: string,
  tick: number,
): Promise<{ action: string; reasoning: string }> {
  const prompt = `You are ${personaName} in a simulation. Act from your perspective.

${envContext}

YOUR PROFILE:
Backstory: ${backstory}
Goals: ${goals.join(", ")}
Constraints: ${constraints.join(", ")}
Recent memory: ${memory.slice(-5).join(" | ") || "nothing yet"}

WHAT-IF VARIABLE (a change was injected at this point): ${variable}

OTHER AGENTS' RECENT ACTIONS:
${recentActions.map(a => `${a.personaName}: ${a.action}`).join("\n") || "(none)"}

CURRENT TICK: ${tick}

How do you respond to this new situation? Respond with JSON:
{
  "action": "what you do (1-2 sentences, first person)",
  "reasoning": "why (1 sentence)"
}`;

  const response = await askProvider(llmProvider(), [{ role: "user", content: prompt }]);
  const text = typeof response === "string" ? response : (response as any)?.content ?? "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { action: parsed.action ?? "adapts to the change", reasoning: parsed.reasoning ?? "" };
    }
  } catch { /* fall through */ }

  return { action: text.slice(0, 200) || "adapts to the new situation", reasoning: "" };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const forkSchema = z.object({
  name:       z.string().min(1).max(200),
  /** "What if X happens?" — the variable change injected at fork */
  variable:   z.string().min(1).max(1000),
  forkAtTick: z.number().int().min(0).optional(), // default: current tick
  runTicks:   z.number().int().min(1).max(20).default(5),
});

const advanceBranchSchema = z.object({
  ticks: z.number().int().min(1).max(10).default(1),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function whatIfScenariosPlugin(app: FastifyInstance) {

  /**
   * POST /simulate/runs/:simId/branches
   * Fork a simulation at a tick with a "what if" variable.
   * Immediately runs runTicks on the branch.
   */
  app.post("/simulate/runs/:simId/branches", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { simId } = req.params as { simId: string };
    const simulation = getSimulation(simId);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    const parsed = forkSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { name, variable, runTicks } = parsed.data;
    const forkTick = parsed.data.forkAtTick ?? simulation.currentTick;

    const simEnv = getSimEnvironment(simulation.environmentId);
    if (!simEnv) return reply.status(404).send({ error: "Environment not found" });

    const id = branchId();
    const now = new Date();

    // Copy tick history up to fork point
    const historicTicks = simulation.tickLog.filter(t => t.tick <= forkTick);

    const branch: ScenarioBranch = {
      id, userId,
      parentSimulationId: simId,
      forkTick,
      name,
      variable,
      tickLog: [],
      currentTick: forkTick,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };
    branchStore.set(id, branch);

    // Build persona memory snapshots at fork point (from historic ticks)
    const personaMemories = new Map<string, string[]>();
    for (const pid of simulation.personaIds) {
      const persona = getPersona(pid);
      if (!persona) continue;
      // Reconstruct memory from tick history
      const mem: string[] = [];
      for (const tick of historicTicks) {
        for (const action of tick.actions) {
          if (action.personaId === pid) mem.push(`[Tick ${tick.tick}] I: ${action.action}`);
          else if (action.targetPersonaId === pid) mem.push(`[Tick ${tick.tick}] ${action.personaName}: ${action.action}`);
        }
      }
      personaMemories.set(pid, mem.slice(-10));
    }

    // Run ticks on the branch
    const envContext = buildEnvironmentContext(simEnv);

    for (let t = 0; t < runTicks; t++) {
      branch.currentTick++;
      const actions: Array<{ personaId: string; personaName: string; action: string; reasoning: string }> = [];

      const promises = simulation.personaIds.map(async (pid) => {
        const persona = getPersona(pid);
        if (!persona) return;

        const mem = personaMemories.get(pid) ?? [];
        const { action, reasoning } = await getPersonaActionInBranch(
          pid, persona.name, persona.backstory, persona.goals, persona.constraints,
          mem, envContext,
          actions.map(a => ({ personaName: a.personaName, action: a.action })),
          variable,
          branch.currentTick,
        );

        actions.push({ personaId: pid, personaName: persona.name, action, reasoning });
        mem.push(`[Tick ${branch.currentTick}] I: ${action}`);
        personaMemories.set(pid, mem.slice(-15));
      });

      await Promise.allSettled(promises);

      branch.tickLog.push({
        tick: branch.currentTick,
        actions,
        worldEvent: t === 0 ? variable : undefined,
        timestamp: new Date(),
      });
    }

    branch.status = "idle";
    branch.updatedAt = new Date();

    return reply.status(201).send({ success: true, branch });
  });

  /**
   * GET /simulate/runs/:simId/branches
   * List all branches for a simulation.
   */
  app.get("/simulate/runs/:simId/branches", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { simId } = req.params as { simId: string };
    const branches = [...branchStore.values()]
      .filter(b => b.userId === userId && b.parentSimulationId === simId)
      .map(b => ({
        id: b.id, name: b.name, variable: b.variable,
        forkTick: b.forkTick, currentTick: b.currentTick,
        status: b.status, createdAt: b.createdAt,
      }));

    return reply.send({ success: true, branches, count: branches.length });
  });

  /**
   * GET /simulate/branches/:id
   * Get full branch state.
   */
  app.get("/simulate/branches/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const branch = branchStore.get(id);
    if (!branch || branch.userId !== userId) {
      return reply.status(404).send({ error: "Branch not found" });
    }

    return reply.send({ success: true, branch });
  });

  /**
   * POST /simulate/branches/:id/tick
   * Continue running a branch forward.
   */
  app.post("/simulate/branches/:id/tick", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const branch = branchStore.get(id);
    if (!branch || branch.userId !== userId) {
      return reply.status(404).send({ error: "Branch not found" });
    }

    const parsed = advanceBranchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { ticks } = parsed.data;
    const simulation = getSimulation(branch.parentSimulationId);
    const simEnv = simulation ? getSimEnvironment(simulation.environmentId) : null;
    if (!simulation || !simEnv) return reply.status(404).send({ error: "Parent simulation/env not found" });

    const envContext = buildEnvironmentContext(simEnv);
    const newTicks: SimTick[] = [];

    for (let t = 0; t < ticks; t++) {
      branch.currentTick++;
      const actions: Array<{ personaId: string; personaName: string; action: string; reasoning: string }> = [];

      const promises = simulation.personaIds.map(async (pid) => {
        const persona = getPersona(pid);
        if (!persona) return;

        const { action, reasoning } = await getPersonaActionInBranch(
          pid, persona.name, persona.backstory, persona.goals, persona.constraints,
          persona.memory, envContext,
          actions.map(a => ({ personaName: a.personaName, action: a.action })),
          branch.variable,
          branch.currentTick,
        );

        actions.push({ personaId: pid, personaName: persona.name, action, reasoning });
      });

      await Promise.allSettled(promises);

      const tick: SimTick = {
        tick: branch.currentTick,
        actions,
        timestamp: new Date(),
      };
      branch.tickLog.push(tick);
      newTicks.push(tick);
    }

    branch.updatedAt = new Date();
    return reply.send({ success: true, branchId: id, currentTick: branch.currentTick, newTicks });
  });

  /**
   * GET /simulate/runs/:simId/compare
   * Compare two branches (or a branch vs the original simulation).
   * Returns a side-by-side diff of actions per tick.
   */
  app.get("/simulate/runs/:simId/compare", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { simId } = req.params as { simId: string };
    const { branchA, branchB } = req.query as { branchA?: string; branchB?: string };

    const simulation = getSimulation(simId);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    // Get tick logs for both sides
    const sideA = branchA
      ? branchStore.get(branchA)?.tickLog ?? []
      : simulation.tickLog;
    const sideB = branchB
      ? branchStore.get(branchB)?.tickLog ?? []
      : simulation.tickLog;

    const labelA = branchA ? (branchStore.get(branchA)?.name ?? branchA) : "Original";
    const labelB = branchB ? (branchStore.get(branchB)?.name ?? branchB) : "Original";

    // Sanitize labels to prevent prototype pollution via computed property injection
    const safeKey = (s: string) => s.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 64) || "branch";

    // Align by tick number
    const allTicks = new Set([...sideA.map(t => t.tick), ...sideB.map(t => t.tick)]);
    const tickMap = (log: SimTick[]) => new Map(log.map(t => [t.tick, t]));
    const mapA = tickMap(sideA);
    const mapB = tickMap(sideB);

    const comparison = [...allTicks].sort((a, b) => a - b).map(tick => ({
      tick,
      [safeKey(labelA)]: mapA.get(tick)?.actions ?? [],
      [safeKey(labelB)]: mapB.get(tick)?.actions ?? [],
    }));

    return reply.send({
      success: true,
      labelA,
      labelB,
      comparison,
    });
  });

  /**
   * DELETE /simulate/branches/:id
   */
  app.delete("/simulate/branches/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const branch = branchStore.get(id);
    if (!branch || branch.userId !== userId) {
      return reply.status(404).send({ error: "Branch not found" });
    }

    branchStore.delete(id);
    return reply.send({ success: true });
  });
}

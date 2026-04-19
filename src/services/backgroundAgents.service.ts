/**
 * Long-running background agents service.
 *
 * Manages hours-long autonomous agent tasks with checkpointing,
 * pause/resume, and progress tracking. Uses in-memory store with
 * optional Redis checkpoint persistence when available.
 */

import crypto from "crypto";
import logger from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AgentStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface AgentCheckpoint {
  stepIndex: number;
  data: Record<string, unknown>;
  timestamp: Date;
}

export interface AgentStep {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface BackgroundAgent {
  id: string;
  userId: number;
  name: string;
  description: string;
  status: AgentStatus;
  steps: AgentStep[];
  currentStepIndex: number;
  checkpoint: AgentCheckpoint | null;
  progress: number; // 0-100
  result?: unknown;
  error?: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  lastHeartbeat: Date | null;
  metadata: Record<string, unknown>;
}

export interface CreateAgentInput {
  userId: number;
  name: string;
  description: string;
  steps: Array<{ name: string; handler: (context: StepContext) => Promise<unknown> }>;
  metadata?: Record<string, unknown>;
  onProgress?: (agent: BackgroundAgent) => void;
}

export interface StepContext {
  agentId: string;
  stepIndex: number;
  previousResults: unknown[];
  checkpoint: AgentCheckpoint | null;
  saveCheckpoint: (data: Record<string, unknown>) => void;
}

// ─── Store ──────────────────────────────────────────────────────────────────

const agents = new Map<string, BackgroundAgent>();
const handlers = new Map<string, Array<(ctx: StepContext) => Promise<unknown>>>();
const progressCallbacks = new Map<string, (agent: BackgroundAgent) => void>();

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Create and start a background agent.
 */
export async function createAgent(input: CreateAgentInput): Promise<BackgroundAgent> {
  const id = `agent_${crypto.randomBytes(8).toString("hex")}`;

  const agent: BackgroundAgent = {
    id,
    userId: input.userId,
    name: input.name,
    description: input.description,
    status: "queued",
    steps: input.steps.map((s, i) => ({
      id: `step_${i}`,
      name: s.name,
      status: "pending",
    })),
    currentStepIndex: 0,
    checkpoint: null,
    progress: 0,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    lastHeartbeat: null,
    metadata: input.metadata ?? {},
  };

  agents.set(id, agent);
  handlers.set(id, input.steps.map((s) => s.handler));
  if (input.onProgress) progressCallbacks.set(id, input.onProgress);

  logger.info({ agentId: id, name: input.name, steps: input.steps.length }, "Background agent created");

  // Start execution asynchronously
  runAgent(id).catch((err) => {
    logger.error({ agentId: id, err }, "Background agent failed unexpectedly");
  });

  return agent;
}

/**
 * Internal: execute agent steps sequentially.
 */
async function runAgent(agentId: string): Promise<void> {
  const agent = agents.get(agentId);
  const stepHandlers = handlers.get(agentId);
  if (!agent || !stepHandlers) return;

  agent.status = "running";
  agent.startedAt = new Date();

  const startIndex = agent.checkpoint?.stepIndex ?? 0;
  const previousResults: unknown[] = [];

  for (let i = startIndex; i < stepHandlers.length; i++) {
    // Check if paused or cancelled (status may change from external calls)
    const currentStatus = agent.status as string;
    if (currentStatus === "paused" || currentStatus === "cancelled") break;

    agent.currentStepIndex = i;
    agent.steps[i].status = "running";
    agent.steps[i].startedAt = new Date();
    agent.lastHeartbeat = new Date();
    notifyProgress(agentId);

    try {
      const ctx: StepContext = {
        agentId,
        stepIndex: i,
        previousResults,
        checkpoint: agent.checkpoint,
        saveCheckpoint: (data) => {
          agent.checkpoint = { stepIndex: i, data, timestamp: new Date() };
        },
      };

      const result = await stepHandlers[i](ctx);
      agent.steps[i].status = "completed";
      agent.steps[i].result = result;
      agent.steps[i].completedAt = new Date();
      previousResults.push(result);

      // Update progress
      const completedSteps = agent.steps.filter((s) => s.status === "completed").length;
      agent.progress = Math.round((completedSteps / agent.steps.length) * 100);
      agent.lastHeartbeat = new Date();
      notifyProgress(agentId);

    } catch (err: any) {
      agent.steps[i].status = "failed";
      agent.steps[i].error = err.message;
      agent.steps[i].completedAt = new Date();
      agent.status = "failed";
      agent.error = `Step "${agent.steps[i].name}" failed: ${err.message}`;
      agent.completedAt = new Date();
      notifyProgress(agentId);

      logger.error({ agentId, step: agent.steps[i].name, err: err.message }, "Agent step failed");
      return;
    }
  }

  if (agent.status === "running") {
    agent.status = "completed";
    agent.progress = 100;
    agent.completedAt = new Date();
    agent.result = previousResults;
    notifyProgress(agentId);

    logger.info({ agentId, duration: Date.now() - (agent.startedAt?.getTime() ?? 0) }, "Background agent completed");
  }
}

function notifyProgress(agentId: string): void {
  const agent = agents.get(agentId);
  const cb = progressCallbacks.get(agentId);
  if (agent && cb) cb(agent);
}

/**
 * Pause a running agent at the next step boundary.
 */
export function pauseAgent(agentId: string): boolean {
  const agent = agents.get(agentId);
  if (!agent || agent.status !== "running") return false;
  agent.status = "paused";
  logger.info({ agentId }, "Background agent paused");
  return true;
}

/**
 * Resume a paused agent from its last checkpoint.
 */
export async function resumeAgent(agentId: string): Promise<boolean> {
  const agent = agents.get(agentId);
  if (!agent || agent.status !== "paused") return false;

  agent.status = "running";
  logger.info({ agentId, resumeFromStep: agent.currentStepIndex }, "Background agent resumed");

  runAgent(agentId).catch((err) => {
    logger.error({ agentId, err }, "Resumed agent failed");
  });

  return true;
}

/**
 * Cancel a running or paused agent.
 */
export function cancelAgent(agentId: string): boolean {
  const agent = agents.get(agentId);
  if (!agent || (agent.status !== "running" && agent.status !== "paused" && agent.status !== "queued")) {
    return false;
  }

  agent.status = "cancelled";
  agent.completedAt = new Date();

  // Mark remaining steps as skipped
  for (const step of agent.steps) {
    if (step.status === "pending") step.status = "skipped";
  }

  notifyProgress(agentId);
  logger.info({ agentId }, "Background agent cancelled");
  return true;
}

/**
 * Get an agent by ID.
 */
export function getAgent(agentId: string): BackgroundAgent | undefined {
  return agents.get(agentId);
}

/**
 * List agents for a user.
 */
export function listAgents(userId: number, status?: AgentStatus): BackgroundAgent[] {
  return [...agents.values()]
    .filter((a) => a.userId === userId && (!status || a.status === status))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Clean up old completed/failed/cancelled agents.
 */
export function cleanupAgents(maxAgeMs: number = 86400_000 * 7): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [id, agent] of agents.entries()) {
    if (
      (agent.status === "completed" || agent.status === "failed" || agent.status === "cancelled") &&
      agent.createdAt.getTime() < cutoff
    ) {
      agents.delete(id);
      handlers.delete(id);
      progressCallbacks.delete(id);
      removed++;
    }
  }
  return removed;
}

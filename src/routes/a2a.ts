/**
 * A2A Protocol — Agent-to-Agent Communication — Phase 4.14
 *
 * Implements the Agent2Agent (A2A) protocol proposed by Google DeepMind:
 * agents can discover, connect to, and delegate tasks to each other
 * via a standardized REST interface.
 *
 * Core concepts:
 * - Agent Card: describes an agent's capabilities, skills, and endpoint
 * - Task delegation: send a task to a peer agent and get a response
 * - Skill matching: discover agents that can handle specific tasks
 * - Multi-agent mesh: forward tasks across a network of agents
 *
 * Inspired by:
 * - google-deepmind/agent2agent A2A spec
 * - AutoGen (microsoft/autogen) multi-agent communication
 * - CrewAI agent delegation
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

// ─── A2A types (aligned with google-deepmind/agent2agent spec) ───────────────

interface AgentCard {
  id: string;
  name: string;
  description: string;
  url: string;          // Endpoint where this agent receives tasks
  skills: AgentSkill[];
  version: string;
  createdAt: string;
  isLocal: boolean;     // true = this server, false = remote
  metadata?: Record<string, unknown>;
}

interface AgentSkill {
  id: string;
  name: string;
  description: string;
  /** Input schema hint */
  inputType?: string;
  /** Output schema hint */
  outputType?: string;
  tags?: string[];
}

interface A2ATask {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  skill: string;
  input: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error" | "rejected";
  output?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Local registries ─────────────────────────────────────────────────────────

const agentRegistry = new Map<string, AgentCard>();
const taskRegistry  = new Map<string, A2ATask>();

// Built-in agent card for THIS server
const SELF_AGENT_ID = "judica-council";
const selfCard: AgentCard = {
  id: SELF_AGENT_ID,
  name: "judica Council",
  description: "Multi-agent AI council with deliberation, research, and task management capabilities",
  url: "/api/a2a/tasks",
  version: "1.0.0",
  isLocal: true,
  createdAt: new Date().toISOString(),
  skills: [
    { id: "deliberate",  name: "Deliberate",   description: "Multi-agent deliberation on a question",  inputType: "text", outputType: "text", tags: ["reasoning", "council"] },
    { id: "research",    name: "Research",      description: "Deep research on a topic",               inputType: "text", outputType: "text", tags: ["search", "analysis"] },
    { id: "summarize",   name: "Summarize",     description: "Summarize provided text or URL content", inputType: "text", outputType: "text", tags: ["summary"] },
    { id: "build_task",  name: "Create Task",   description: "Create a task in the build graph",       inputType: "json", outputType: "json", tags: ["tasks"] },
    { id: "kg_extract",  name: "KG Extract",    description: "Extract entities from text into KG",     inputType: "text", outputType: "json", tags: ["knowledge"] },
  ],
};
agentRegistry.set(SELF_AGENT_ID, selfCard);

// ─── Schemas ─────────────────────────────────────────────────────────────────

const registerAgentSchema = z.object({
  id:          z.string().min(1).max(100),
  name:        z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  url:         z.string().url(),
  skills:      z.array(z.object({
    id:          z.string().min(1),
    name:        z.string().min(1),
    description: z.string().optional(),
    inputType:   z.string().optional(),
    outputType:  z.string().optional(),
    tags:        z.array(z.string()).optional(),
  })).optional(),
  version:     z.string().optional(),
  metadata:    z.record(z.string(), z.unknown()).optional(),
});

const delegateTaskSchema = z.object({
  toAgentId: z.string().min(1),
  skill:     z.string().min(1),
  input:     z.record(z.string(), z.unknown()),
  /** Whether to execute locally if toAgentId is self (default: true) */
  allowLocalExecution: z.boolean().optional(),
});

// ─── Local skill executor ─────────────────────────────────────────────────────

async function executeLocalSkill(
  skill: string,
  input: Record<string, unknown>,
): Promise<{ output: unknown; error?: string }> {
  const provider = {
    name: "openai",
    type: "api" as const,
    apiKey: env.OPENAI_API_KEY ?? "",
    model: "gpt-4o-mini",
    systemPrompt: "You are a precise AI assistant.",
  };

  const text = (input.text ?? input.content ?? input.query ?? JSON.stringify(input)) as string;

  try {
    switch (skill) {
      case "deliberate":
      case "summarize": {
        const res = await askProvider(provider, [{ role: "user", content: text }]);
        return { output: { text: res.text } };
      }
      case "research": {
        const res = await askProvider(
          { ...provider, systemPrompt: "You are a deep research analyst. Provide comprehensive analysis." },
          [{ role: "user", content: `Research: ${text}` }],
        );
        return { output: { text: res.text } };
      }
      default:
        return { output: null, error: `Unknown skill: ${skill}` };
    }
  } catch (err) {
    return { output: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function a2aPlugin(app: FastifyInstance) {

  /**
   * GET /a2a/agents
   * List all registered agents (discovery endpoint).
   */
  app.get("/a2a/agents", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { skill, tag } = req.query as { skill?: string; tag?: string };
    let agents = [...agentRegistry.values()];

    if (skill) {
      agents = agents.filter((a) => a.skills.some((s) => s.id === skill || s.name.toLowerCase().includes(skill.toLowerCase())));
    }
    if (tag) {
      agents = agents.filter((a) => a.skills.some((s) => s.tags?.includes(tag)));
    }

    return { success: true, agents, count: agents.length };
  });

  /**
   * GET /a2a/agents/:agentId
   * Get an agent card (public, no auth required — discovery).
   */
  app.get("/a2a/agents/:agentId", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const card = agentRegistry.get(agentId);
    if (!card) return reply.status(404).send({ error: "Agent not found" });
    return { success: true, agent: card };
  });

  /**
   * GET /a2a/card
   * Return THIS server's agent card (unauthenticated — for peer discovery).
   */
  app.get("/a2a/card", async (_req, reply) => {
    return selfCard;
  });

  /**
   * POST /a2a/agents
   * Register a remote agent in this server's registry.
   */
  app.post("/a2a/agents", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = registerAgentSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { id, name, description, url, skills, version, metadata } = parsed.data;
    const card: AgentCard = {
      id,
      name,
      description: description ?? "",
      url,
      skills: (skills ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? "",
        inputType: s.inputType,
        outputType: s.outputType,
        tags: s.tags,
      })),
      version: version ?? "1.0.0",
      isLocal: false,
      createdAt: new Date().toISOString(),
      metadata,
    };
    agentRegistry.set(id, card);

    return reply.status(201).send({ success: true, agent: card });
  });

  /**
   * DELETE /a2a/agents/:agentId
   * Deregister a remote agent.
   */
  app.delete("/a2a/agents/:agentId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { agentId } = req.params as { agentId: string };
    if (agentId === SELF_AGENT_ID) return reply.status(400).send({ error: "Cannot deregister self" });
    if (!agentRegistry.has(agentId)) return reply.status(404).send({ error: "Agent not found" });
    agentRegistry.delete(agentId);
    return { success: true };
  });

  /**
   * POST /a2a/delegate
   * Delegate a task to a registered agent (local or remote).
   */
  app.post("/a2a/delegate", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = delegateTaskSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { toAgentId, skill, input, allowLocalExecution = true } = parsed.data;

    const targetAgent = agentRegistry.get(toAgentId);
    if (!targetAgent) return reply.status(404).send({ error: `Agent ${toAgentId} not registered` });

    // Verify skill exists
    const agentSkill = targetAgent.skills.find((s) => s.id === skill);
    if (!agentSkill) return reply.status(400).send({ error: `Agent ${toAgentId} does not have skill: ${skill}` });

    const taskId = randomUUID();
    const task: A2ATask = {
      id: taskId,
      fromAgentId: `user-${userId}`,
      toAgentId,
      skill,
      input,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    taskRegistry.set(taskId, task);

    // Execute: local or remote
    if (targetAgent.isLocal && allowLocalExecution) {
      task.status = "running";
      const { output, error } = await executeLocalSkill(skill, input);
      task.status = error ? "error" : "done";
      task.output = output;
      task.error = error;
      task.updatedAt = new Date().toISOString();
    } else {
      // Forward to remote agent
      try {
        task.status = "running";
        const res = await fetch(targetAgent.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skill, input, taskId }),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`Remote agent returned ${res.status}`);
        const result = await res.json() as Record<string, unknown>;
        task.status = "done";
        task.output = result;
      } catch (err) {
        task.status = "error";
        task.error = err instanceof Error ? err.message : String(err);
        logger.error({ taskId, toAgentId, err: task.error }, "a2a: remote delegation failed");
      }
      task.updatedAt = new Date().toISOString();
    }

    taskRegistry.set(taskId, task);
    return { success: true, task };
  });

  /**
   * POST /a2a/tasks
   * Receive an incoming A2A task from a peer agent.
   * This is the public endpoint peers call to send tasks HERE.
   */
  app.post("/a2a/tasks", async (req, reply) => {
    const { skill, input, taskId } = req.body as { skill: string; input: Record<string, unknown>; taskId?: string };
    if (!skill || !input) return reply.status(400).send({ error: "skill and input required" });

    const internalTaskId = taskId ?? randomUUID();
    const { output, error } = await executeLocalSkill(skill, input);

    return {
      taskId: internalTaskId,
      status: error ? "error" : "done",
      output,
      error,
    };
  });

  /**
   * GET /a2a/tasks
   * List outgoing tasks delegated by this user.
   */
  app.get("/a2a/tasks", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const tasks = [...taskRegistry.values()]
      .filter((t) => t.fromAgentId === `user-${userId}`)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { success: true, tasks, count: tasks.length };
  });

  /**
   * GET /a2a/tasks/:taskId
   * Get a specific delegated task.
   */
  app.get("/a2a/tasks/:taskId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { taskId } = req.params as { taskId: string };
    const task = taskRegistry.get(taskId);
    if (!task || task.fromAgentId !== `user-${userId}`) {
      return reply.status(404).send({ error: "Task not found" });
    }
    return { success: true, task };
  });
}

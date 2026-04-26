import { NodeType } from "./types.js";
import type {
  WorkflowDefinition,
  WorkflowNode,
  ExecutionEvent,
  NodeContext,
  NodeSelfHealingConfig,
} from "./types.js";
import { nodeHandlers } from "./nodes/index.js";
import logger from "../lib/logger.js";

const DEFAULT_NODE_TIMEOUT_MS = 60_000; // 60s per node
// Configurable HITL gate timeout (default 24 hours)
// NaN guards — fall back to defaults if env vars are non-numeric
const _parsedGateTimeout = parseInt(process.env.WORKFLOW_GATE_TIMEOUT_MS || "86400000", 10);
const GATE_TIMEOUT_MS = Number.isFinite(_parsedGateTimeout) && _parsedGateTimeout > 0 ? _parsedGateTimeout : 86400000;
// Global workflow execution budget
const _parsedWfDuration = parseInt(process.env.WORKFLOW_MAX_DURATION_MS || "3600000", 10);
const MAX_WORKFLOW_DURATION_MS = Number.isFinite(_parsedWfDuration) && _parsedWfDuration > 0 ? _parsedWfDuration : 3600000; // 1h default
const _parsedWfCost = parseFloat(process.env.WORKFLOW_MAX_COST_USD || "0");
const MAX_WORKFLOW_COST_USD = Number.isFinite(_parsedWfCost) && _parsedWfCost > 0 ? _parsedWfCost : Infinity;

interface PendingGate {
  resolve: (choice: string) => void;
  promise: Promise<string>;
  createdAt: number; // Track creation time for timeout
}

/** Buffered result from a single node execution. */
interface NodeResult {
  nodeId: string;
  output: Record<string, unknown>;
  events: ExecutionEvent[];
  skipped: boolean;
}

// Gate state persistence interface
// This interface (along with ExecutionStateStore below) allows external
// implementations backed by Redis/DB for horizontal scaling. The in-memory defaults
// are single-process only. Replace both stores for multi-replica deployments.
interface GateStore {
  set(runId: string, nodeId: string, state: { prompt: string; options: string[]; createdAt: number }): Promise<void>;
  get(runId: string, nodeId: string): Promise<{ prompt: string; options: string[]; createdAt: number } | null>;
  delete(runId: string, nodeId: string): Promise<void>;
}

// Execution state persistence interface for crash recovery
export interface ExecutionStateStore {
  save(runId: string, state: { level: number; contextMap: Record<string, unknown>; skippedNodes: string[] }): Promise<void>;
  load(runId: string): Promise<{ level: number; contextMap: Record<string, unknown>; skippedNodes: string[] } | null>;
  clear(runId: string): Promise<void>;
}

// In-memory store (replace with Redis in production for multi-replica)
class InMemoryGateStore implements GateStore {
  private store = new Map<string, { prompt: string; options: string[]; createdAt: number }>();
  private key(runId: string, nodeId: string) { return `${runId}:${nodeId}`; }
  async set(runId: string, nodeId: string, state: { prompt: string; options: string[]; createdAt: number }) {
    this.store.set(this.key(runId, nodeId), state);
    logger.debug({ runId, nodeId }, "Gate state persisted (in-memory — use Redis for multi-replica)");
  }
  async get(runId: string, nodeId: string) { return this.store.get(this.key(runId, nodeId)) || null; }
  async delete(runId: string, nodeId: string) { this.store.delete(this.key(runId, nodeId)); }
}

const gateStore: GateStore = new InMemoryGateStore();

// ─── Global self-healing defaults (4.21) ─────────────────────────────────────
// Exposed via GET/PUT /api/workflows/self-healing/config. Updated at runtime
// without restart. Per-node `selfHealing` overrides these defaults.

export interface SelfHealingGlobalConfig {
  enabled: boolean;
  maxAttempts: number;
  strategies: Array<"retry_with_adjusted_params" | "swap_provider" | "rewrite_prompt">;
}

const _parsedMaxAttempts = parseInt(process.env.WORKFLOW_SELF_HEALING_MAX_ATTEMPTS || "2", 10);
const DEFAULT_SELF_HEALING_MAX_ATTEMPTS = Number.isFinite(_parsedMaxAttempts) && _parsedMaxAttempts > 0 ? Math.min(_parsedMaxAttempts, 5) : 2;

export const selfHealingConfig: SelfHealingGlobalConfig = {
  enabled: process.env.WORKFLOW_SELF_HEALING === "true",
  maxAttempts: DEFAULT_SELF_HEALING_MAX_ATTEMPTS,
  strategies: ["retry_with_adjusted_params", "rewrite_prompt"],
};

// Idempotency key tracking to prevent duplicate executions
const activeExecutions = new Set<string>();

// Distributed lock interface for exactly-once execution guarantee
// In production, implement with Redis SETNX or DB advisory locks
export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

// Default in-memory lock (single-process only)
export class InMemoryLock implements DistributedLock {
  private locks = new Map<string, number>();
  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing > now) return false;
    this.locks.set(key, now + ttlMs);
    return true;
  }
  async release(key: string): Promise<void> {
    this.locks.delete(key);
  }
}

export class WorkflowExecutor {
  private definition: WorkflowDefinition;
  private runId: string;
  private userId: number;
  private pendingGates = new Map<string, PendingGate>();
  // Optional idempotency key for deduplication
  private idempotencyKey?: string;

  constructor(definition: WorkflowDefinition, runId: string, userId: number, idempotencyKey?: string) {
    // Deep clone to prevent mutation of the original definition
    // Allows safe re-runs and concurrent executions of the same workflow
    this.definition = JSON.parse(JSON.stringify(definition));
    this.runId = runId;
    this.userId = userId;
    this.idempotencyKey = idempotencyKey;

    // Log workflow instantiation with correlation ID for observability
    logger.info({ runId, userId, idempotencyKey, nodeCount: definition.nodes.length }, "WorkflowExecutor created");
  }

  /**
   * Resume a workflow from a specific node, using previously saved state.
   * Allows partial failure recovery without re-running completed nodes.
   */
  async *resumeFrom(
    inputs: Record<string, unknown>,
    savedState: { contextMap: Record<string, unknown>; completedNodes: string[] }
  ): AsyncGenerator<ExecutionEvent> {
    // Mark previously completed nodes and inject their outputs
    logger.info({ runId: this.runId, resumeFromNodes: savedState.completedNodes.length }, "Resuming workflow from checkpoint");

    // Delegate to run() but with pre-seeded context — for now, re-run with inputs
    // Full implementation requires level-aware resume (skipping completed waves)
    yield* this.run(inputs);
  }

  /**
   * Resume a human gate that is waiting for user input.
   */
  resumeGate(nodeId: string, choice: string): void {
    const gate = this.pendingGates.get(nodeId);
    if (!gate) {
      throw new Error(`No pending gate for node ${nodeId}`);
    }
    gate.resolve(choice);
    this.pendingGates.delete(nodeId);
  }

  /**
   * Wave-based Kahn's algorithm.
   * Returns execution levels where all nodes within a level can run in parallel
   * (no intra-level dependencies). Each successive level depends only on prior levels.
   */
  private buildExecutionLevels(
    nodes: WorkflowNode[],
    edges: WorkflowDefinition["edges"]
  ): string[][] {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }

    for (const edge of edges) {
      adjacency.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }

    const levels: string[][] = [];
    let currentWave = nodes
      .map((n) => n.id)
      .filter((id) => inDegree.get(id) === 0);

    while (currentWave.length > 0) {
      levels.push(currentWave);
      const nextWave: string[] = [];
      for (const id of currentWave) {
        for (const neighbor of adjacency.get(id) || []) {
          const newDeg = (inDegree.get(neighbor) || 1) - 1;
          inDegree.set(neighbor, newDeg);
          if (newDeg === 0) {
            nextWave.push(neighbor);
          }
        }
      }
      currentWave = nextWave;
    }

    return levels;
  }

  /**
   * Execute a single node, collecting all events into a buffer.
   * On first failure, invokes a recovery LLM node to rewrite inputs, then retries once.
   * Never throws — errors are captured as node_error events.
   */
  private async executeNode(
    node: WorkflowNode,
    nodeInputs: Record<string, unknown>,
    contextMap: Map<string, Record<string, unknown>>,
    attempt = 0
  ): Promise<NodeResult> {
    const events: ExecutionEvent[] = [];

    // Attach correlation ID to all node execution logs
    logger.info({ runId: this.runId, nodeId: node.id, nodeType: node.type, attempt }, "Node execution starting");

    events.push({
      type: "node_start",
      nodeId: node.id,
      nodeType: node.type as NodeType,
    });

    const handler = nodeHandlers.get(node.type as NodeType);
    if (!handler) {
      const error = `No handler registered for node type "${node.type}"`;
      events.push({ type: "node_error", nodeId: node.id, nodeType: node.type as NodeType, error });
      events.push({ type: "workflow_error", error: `Node ${node.id}: ${error}` });
      return { nodeId: node.id, output: {}, events, skipped: false };
    }

    const ctx: NodeContext = {
      inputs: nodeInputs,
      nodeData: node.data,
      runId: this.runId,
      userId: this.userId,
    };

    try {
      const timeoutMs = (node.data.timeout as number) || DEFAULT_NODE_TIMEOUT_MS;
      // Store timer ref to clear on resolution (prevent fire-after-cancel leaks)
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const output = await Promise.race([
        handler(ctx),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`Node "${node.id}" timed out after ${timeoutMs}ms`)),
            timeoutMs
          );
        }),
      ]).finally(() => clearTimeout(timeoutHandle!));

      events.push({
        type: "node_complete",
        nodeId: node.id,
        nodeType: node.type as NodeType,
        output,
      });

      return { nodeId: node.id, output, events, skipped: false };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      // ── Self-healing (4.21) ───────────────────────────────────────────────
      // Merge global defaults with per-node overrides.
      // Security note: self-healing allows an LLM to rewrite node inputs —
      // only safe on idempotent node types. Enable explicitly via config or node data.
      const nodeShCfg = (node.selfHealing ?? {}) as Partial<NodeSelfHealingConfig>;
      const shEnabled  = nodeShCfg.enabled  ?? selfHealingConfig.enabled;
      const maxAttempts = Math.min(Math.max(1, nodeShCfg.maxAttempts ?? selfHealingConfig.maxAttempts), 5);
      const strategies  = nodeShCfg.strategies ?? selfHealingConfig.strategies;
      const hitlPrompt  = nodeShCfg.hitlPrompt
        ?? `Node "${node.id}" (type: ${node.type}) failed after ${maxAttempts} auto-recovery attempts.\nError: ${error.slice(0, 400)}\n\nPlease review and choose how to proceed.`;

      // Only retry idempotent node types to prevent duplicate side effects
      const IDEMPOTENT_TYPES = new Set([NodeType.LLM, NodeType.CONDITION, NodeType.INPUT]);
      const isIdempotent = IDEMPOTENT_TYPES.has(node.type as NodeType);

      if (shEnabled && isIdempotent && attempt < maxAttempts) {
        const strategyIndex = attempt; // each attempt tries the next strategy
        const strategy = strategies[strategyIndex % strategies.length] ?? "retry_with_adjusted_params";

        logger.info({ runId: this.runId, nodeId: node.id, attempt, strategy, maxAttempts }, "Self-healing: attempting recovery");

        const recoveryEvents: ExecutionEvent[] = [];
        recoveryEvents.push({
          type: "node_start",
          nodeId: `${node.id}:recovery:${attempt}`,
          nodeType: NodeType.LLM,
        });

        let healedInputs = nodeInputs;

        try {
          const recoveryHandler = nodeHandlers.get(NodeType.LLM);
          if (recoveryHandler) {
            let recoveryPrompt: string;
            if (strategy === "rewrite_prompt") {
              recoveryPrompt = `A workflow node's prompt produced a failure. Rewrite the prompt to fix the problem.\n\nNode type: ${String(node.type).replace(/[^a-zA-Z0-9_.-]/g, "")}\nCurrent prompt/inputs: ${JSON.stringify(nodeInputs, null, 2).slice(0, 2000)}\nError: ${String(error).slice(0, 500)}\n\nReturn a JSON object where "prompt" key contains the rewritten prompt text.`;
            } else {
              recoveryPrompt = `A workflow node failed. Suggest corrected input values.\n\nNode type: ${String(node.type).replace(/[^a-zA-Z0-9_.-]/g, "")}\nOriginal inputs: ${JSON.stringify(nodeInputs, null, 2).slice(0, 2000)}\nError: ${String(error).slice(0, 500)}\n\nReturn a JSON object with corrected input fields only.`;
            }

            const recoveryCtx: NodeContext = {
              inputs: { prompt: recoveryPrompt },
              nodeData: {
                model: node.data.model || "auto",
                systemPrompt: "You are a workflow self-healing agent. Return only valid JSON with corrected values.",
                responseFormat: "json",
              },
              runId: this.runId,
              userId: this.userId,
            };

            let recoveryTimer: ReturnType<typeof setTimeout>;
            const recoveryOutput = await Promise.race([
              recoveryHandler(recoveryCtx),
              new Promise<never>((_, reject) => {
                recoveryTimer = setTimeout(() => reject(new Error("Recovery timed out")), 30_000);
              }),
            ]).finally(() => clearTimeout(recoveryTimer!));

            recoveryEvents.push({
              type: "node_complete",
              nodeId: `${node.id}:recovery:${attempt}`,
              nodeType: NodeType.LLM,
              output: recoveryOutput,
            });

            if (typeof recoveryOutput.result === "object" && recoveryOutput.result !== null) {
              const recovered = recoveryOutput.result as Record<string, unknown>;
              healedInputs = strategy === "rewrite_prompt" && typeof recovered.prompt === "string"
                ? { ...nodeInputs, prompt: recovered.prompt }
                : { ...nodeInputs, ...recovered };
            }
          }
        } catch (recoveryErr) {
          recoveryEvents.push({
            type: "node_error",
            nodeId: `${node.id}:recovery:${attempt}`,
            nodeType: NodeType.LLM,
            error: `Recovery agent failed: ${recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)}`,
          });
        }

        const retryResult = await this.executeNode(node, healedInputs, contextMap, attempt + 1);
        return {
          ...retryResult,
          events: [...events, ...recoveryEvents, ...retryResult.events],
        };
      }

      // All auto-recovery attempts exhausted — escalate to HUMAN_GATE
      if (shEnabled && isIdempotent && attempt >= maxAttempts) {
        logger.warn({ runId: this.runId, nodeId: node.id, attempt, maxAttempts }, "Self-healing exhausted — escalating to HUMAN_GATE");
        events.push({
          type: "human_gate_pending",
          nodeId: `${node.id}:hitl`,
          prompt: hitlPrompt,
          options: ["retry", "skip", "abort"],
        });
        // Persist the gate state so the caller can inspect it
        await gateStore.set(this.runId, `${node.id}:hitl`, {
          prompt: hitlPrompt,
          options: ["retry", "skip", "abort"],
          createdAt: Date.now(),
        });
        events.push({ type: "node_error", nodeId: node.id, nodeType: node.type as NodeType, error: `Self-healing exhausted after ${maxAttempts} attempts. Waiting for human intervention.` });
        return { nodeId: node.id, output: {}, events, skipped: false };
      }

      // Self-healing disabled or non-idempotent — emit error directly
      events.push({ type: "node_error", nodeId: node.id, nodeType: node.type as NodeType, error });
      events.push({ type: "workflow_error", error: `Node ${node.id} failed: ${error}` });
      return { nodeId: node.id, output: {}, events, skipped: false };
    }
  }

  /**
   * Execute the workflow, yielding events as progress is made.
   * Nodes within the same execution wave run in parallel via Promise.all.
   * HUMAN_GATE nodes are always executed serially after their wave's parallel nodes.
   */
  async *run(
    inputs: Record<string, unknown>
  ): AsyncGenerator<ExecutionEvent> {
    // Idempotency check — prevent duplicate concurrent executions
    const dedupeKey = this.idempotencyKey || this.runId;
    if (activeExecutions.has(dedupeKey)) {
      yield {
        type: "workflow_error",
        error: `Duplicate execution rejected: idempotency key "${dedupeKey}" already active`,
      };
      return;
    }
    activeExecutions.add(dedupeKey);

    try {
    const { nodes, edges } = this.definition;

    // ── Build auxiliary maps ─────────────────────────────────────────────
    const nodeMap = new Map<string, WorkflowNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    const adjacency = new Map<string, { target: string; sourceHandle?: string; targetHandle?: string }[]>();
    const predecessors = new Map<string, { source: string; sourceHandle?: string; targetHandle?: string }[]>();

    for (const node of nodes) {
      adjacency.set(node.id, []);
      predecessors.set(node.id, []);
    }

    for (const edge of edges) {
      adjacency.get(edge.source)!.push({
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
      predecessors.get(edge.target)!.push({
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
    }

    // ── Validate: detect cycles ──────────────────────────────────────────
    const levels = this.buildExecutionLevels(nodes, edges);
    const totalInLevels = levels.reduce((sum, lvl) => sum + lvl.length, 0);
    if (totalInLevels !== nodes.length) {
      yield {
        type: "workflow_error",
        error: "Workflow contains a cycle — topological sort failed",
      };
      return;
    }

    // DAG validation beyond cycle detection
    const allNodeIds = new Set(nodes.map(n => n.id));
    const reachableFromInputs = new Set<string>();
    const inputNodes = nodes.filter(n => n.type === NodeType.INPUT);
    const queue = inputNodes.map(n => n.id);
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (reachableFromInputs.has(current)) continue;
      reachableFromInputs.add(current);
      for (const neighbor of adjacency.get(current) || []) {
        queue.push(neighbor.target);
      }
    }
    const unreachable = nodes.filter(n => n.type !== NodeType.INPUT && !reachableFromInputs.has(n.id));
    if (unreachable.length > 0) {
      logger.warn({ unreachableNodes: unreachable.map(n => n.id) }, "Workflow has unreachable nodes");
    }

    // Check for invalid edge references
    for (const edge of this.definition.edges) {
      if (!allNodeIds.has(edge.source) || !allNodeIds.has(edge.target)) {
        yield {
          type: "workflow_error",
          error: `Invalid edge "${edge.id}": references non-existent node (source: ${edge.source}, target: ${edge.target})`,
        };
        return;
      }
    }

    // ── Execution context ────────────────────────────────────────────────
    const contextMap = new Map<string, Record<string, unknown>>();
    const conditionBranches = new Map<string, string>();
    // Track skipped nodes explicitly to fix skip propagation
    const skippedNodes = new Set<string>();

    // ── Seed INPUT nodes ─────────────────────────────────────────────────
    for (const node of nodes) {
      if (node.type === NodeType.INPUT) {
        const inputName = (node.data.name as string) || node.id;
        const value = inputs[inputName] ?? node.data.default ?? null;
        contextMap.set(node.id, { [inputName]: value, value });
        (node.data as Record<string, unknown>).__executed = true;
      }
    }

    // ── Helper: gather inputs for a node from context ────────────────────
    const gatherInputs = (
      nodeId: string
    ): { nodeInputs: Record<string, unknown>; skip: boolean } => {
      const nodeInputs: Record<string, unknown> = {};
      let skippedCount = 0;
      let activeCount = 0;
      const preds = predecessors.get(nodeId) || [];

      for (const pred of preds) {
        const predNode = nodeMap.get(pred.source);

        if (predNode?.type === NodeType.CONDITION) {
          const branch = conditionBranches.get(pred.source);
          if (pred.sourceHandle && branch && pred.sourceHandle !== branch) {
            skippedCount++;
            continue;
          }
        }

        // Check explicit skipped set instead of fragile heuristic
        if (skippedNodes.has(pred.source)) {
          skippedCount++;
          continue;
        }

        activeCount++;
        const predOutput = contextMap.get(pred.source);
        // Sanitize inter-node data to prevent injection chain attacks
        if (predOutput) {
          if (pred.targetHandle) {
            nodeInputs[pred.targetHandle] = predOutput;
          } else {
            // R3-01: Filter forbidden keys before Object.assign to prevent prototype pollution
            // via crafted workflow node outputs containing __proto__ / constructor keys.
            const MERGE_FORBIDDEN = new Set(["__proto__", "constructor", "prototype", "__defineGetter__", "__defineSetter__"]);
            for (const [k, v] of Object.entries(predOutput as Record<string, unknown>)) {
              if (!MERGE_FORBIDDEN.has(k)) nodeInputs[k] = v;
            }
          }
        }
      }

      const skip = preds.length > 0 && activeCount === 0 && skippedCount > 0;
      return { nodeInputs, skip };
    };

    // Track execution start time for global budget enforcement
    const executionStartTime = Date.now();
    let accumulatedCost = 0;

    // State persistence hook (override for production Redis/DB backing)
    const persistState = async (state: { level: number; contextMap: Record<string, unknown>; skippedNodes: string[] }) => {
      // Default: no-op. In production, implement Redis/DB persistence here.
      logger.debug({ runId: this.runId, level: state.level }, "Workflow state checkpoint");
    };

    // ── Wave-by-wave execution ───────────────────────────────────────────
    for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
      const level = levels[levelIdx];

      // Check global duration budget
      if (Date.now() - executionStartTime > MAX_WORKFLOW_DURATION_MS) {
        yield {
          type: "workflow_error",
          error: `Workflow exceeded max duration of ${MAX_WORKFLOW_DURATION_MS}ms`,
        };
        return;
      }

      // Check global cost budget
      if (accumulatedCost >= MAX_WORKFLOW_COST_USD) {
        yield {
          type: "workflow_error",
          error: `Workflow exceeded max cost of $${MAX_WORKFLOW_COST_USD}`,
        };
        return;
      }
      // Separate HUMAN_GATEs (serial) from everything else (parallel)
      const parallelIds = level.filter(
        (id) =>
          nodeMap.get(id)!.type !== NodeType.INPUT &&
          nodeMap.get(id)!.type !== NodeType.HUMAN_GATE
      );
      const gateIds = level.filter((id) => nodeMap.get(id)!.type === NodeType.HUMAN_GATE);

      // ── Parallel execution of non-gate nodes ───────────────────────────
      if (parallelIds.length > 0) {
        const parallelTasks = parallelIds.map((nodeId) => {
          const node = nodeMap.get(nodeId)!;
          const { nodeInputs, skip } = gatherInputs(nodeId);
          if (skip) {
            return Promise.resolve<NodeResult>({
              nodeId,
              output: {},
              events: [],
              skipped: true,
            });
          }
          return this.executeNode(node, nodeInputs, contextMap);
        });

        const results = await Promise.all(parallelTasks);

        for (const result of results) {
          // Yield buffered events
          for (const event of result.events) {
            yield event;
            // If a fatal workflow_error was emitted, stop the entire run
            if (event.type === "workflow_error") {
              return;
            }
          }

          // Track skipped nodes explicitly
          if (result.skipped) {
            skippedNodes.add(result.nodeId);
          }

          // Update context
          contextMap.set(result.nodeId, result.output);
          const node = nodeMap.get(result.nodeId)!;
          (node.data as Record<string, unknown>).__executed = true;

          // Track condition branches
          if (node.type === NodeType.CONDITION && typeof result.output.branch === "string") {
            conditionBranches.set(result.nodeId, result.output.branch);
          }

          // Accumulate cost from LLM nodes for budget enforcement
          if (result.output.usage && typeof (result.output.usage as Record<string, unknown>).estimatedCost === "number") {
            accumulatedCost += (result.output.usage as Record<string, unknown>).estimatedCost as number;
          }
        }
      }

      // ── Serial HUMAN_GATE execution ────────────────────────────────────
      for (const nodeId of gateIds) {
        const node = nodeMap.get(nodeId)!;
        const { nodeInputs, skip } = gatherInputs(nodeId);

        if (skip) {
          contextMap.set(nodeId, {});
          skippedNodes.add(nodeId); // Track skipped gate nodes
          continue;
        }

        yield {
          type: "node_start",
          nodeId,
          nodeType: NodeType.HUMAN_GATE,
        };

        let gateResolve!: (choice: string) => void;
        const gatePromise = new Promise<string>((resolve) => {
          gateResolve = resolve;
        });
        this.pendingGates.set(nodeId, { resolve: gateResolve, promise: gatePromise, createdAt: Date.now() });

        // Persist gate state for recovery
        const gatePromptText = (node.data.prompt as string) || "Awaiting human input";
        const gateOptions = (node.data.options as string[]) || [];
        await gateStore.set(this.runId, nodeId, {
          prompt: gatePromptText,
          options: gateOptions,
          createdAt: Date.now()
        });

        yield {
          type: "human_gate_pending",
          nodeId,
          nodeType: NodeType.HUMAN_GATE,
          prompt: gatePromptText,
          options: gateOptions,
        };

        // Race gate resolution against timeout
        // Clear timeout timer on resolution to prevent fire-after-cancel
        let gateTimer: ReturnType<typeof setTimeout>;
        const choice = await Promise.race([
          gatePromise,
          new Promise<string>((_, reject) => {
            gateTimer = setTimeout(() => reject(new Error(`HITL gate "${nodeId}" timed out after ${GATE_TIMEOUT_MS}ms`)), GATE_TIMEOUT_MS);
          })
        ]).catch((err) => {
          logger.warn({ nodeId, err: (err as Error).message }, "HITL gate timed out — using timeout default");
          return "__timeout__";
        }).finally(() => clearTimeout(gateTimer!));

        // Clean up persisted gate state
        await gateStore.delete(this.runId, nodeId);
        const output = { ...nodeInputs, choice };
        contextMap.set(nodeId, output);
        (node.data as Record<string, unknown>).__executed = true;

        yield {
          type: "node_complete",
          nodeId,
          nodeType: NodeType.HUMAN_GATE,
          output,
        };
      }

      // Persist execution state checkpoint after each wave
      await persistState({
        level: levelIdx,
        contextMap: Object.fromEntries(contextMap),
        skippedNodes: [...skippedNodes],
      });
    }

    // ── Collect OUTPUT nodes and yield workflow_complete ──────────────────
    const finalOutputs: Record<string, unknown> = {};
    for (const node of nodes) {
      if (node.type === NodeType.OUTPUT) {
        const outputName = (node.data.name as string) || node.id;
        finalOutputs[outputName] = contextMap.get(node.id) || {};
      }
    }

    yield {
      type: "workflow_complete",
      outputs: finalOutputs,
    };
    } finally {
      // Clean up idempotency tracking
      activeExecutions.delete(dedupeKey);
    }
  }
}

import { NodeType } from "./types.js";
import type {
  WorkflowDefinition,
  WorkflowNode,
  ExecutionEvent,
  NodeContext,
} from "./types.js";
import { nodeHandlers } from "./nodes/index.js";

const DEFAULT_NODE_TIMEOUT_MS = 60_000; // 60s per node

interface PendingGate {
  resolve: (choice: string) => void;
  promise: Promise<string>;
}

/** Buffered result from a single node execution. */
interface NodeResult {
  nodeId: string;
  output: Record<string, unknown>;
  events: ExecutionEvent[];
  skipped: boolean;
}

export class WorkflowExecutor {
  private definition: WorkflowDefinition;
  private runId: string;
  private userId: number;
  private pendingGates = new Map<string, PendingGate>();

  constructor(definition: WorkflowDefinition, runId: string, userId: number) {
    this.definition = definition;
    this.runId = runId;
    this.userId = userId;
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
      const output = await Promise.race([
        handler(ctx),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Node "${node.id}" timed out after ${timeoutMs}ms`)),
            timeoutMs
          )
        ),
      ]);

      events.push({
        type: "node_complete",
        nodeId: node.id,
        nodeType: node.type as NodeType,
        output,
      });

      return { nodeId: node.id, output, events, skipped: false };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      // Self-healing: on first failure, attempt LLM-assisted input recovery, then retry
      if (attempt === 0) {
        const recoveryEvents: ExecutionEvent[] = [];
        recoveryEvents.push({
          type: "node_start",
          nodeId: `${node.id}:recovery`,
          nodeType: NodeType.LLM,
        });

        try {
          const recoveryHandler = nodeHandlers.get(NodeType.LLM);
          if (recoveryHandler) {
            const recoveryCtx: NodeContext = {
              inputs: {
                prompt: `A workflow node failed. Rewrite the inputs to fix the problem.\n\nNode type: ${node.type}\nOriginal inputs: ${JSON.stringify(nodeInputs, null, 2)}\nError: ${error}\n\nReturn a JSON object with corrected input values.`,
              },
              nodeData: {
                model: node.data.model || "auto",
                systemPrompt: "You are a workflow self-healing agent. Return only valid JSON.",
                responseFormat: "json",
              },
              runId: this.runId,
              userId: this.userId,
            };

            const recoveryOutput = await Promise.race([
              recoveryHandler(recoveryCtx),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Recovery timed out")), 30_000)
              ),
            ]);

            recoveryEvents.push({
              type: "node_complete",
              nodeId: `${node.id}:recovery`,
              nodeType: NodeType.LLM,
              output: recoveryOutput,
            });

            // Parse recovered inputs and retry
            const healedInputs =
              typeof recoveryOutput.result === "object" && recoveryOutput.result !== null
                ? (recoveryOutput.result as Record<string, unknown>)
                : nodeInputs;

            const retryResult = await this.executeNode(node, healedInputs, contextMap, 1);
            return {
              ...retryResult,
              events: [...events, ...recoveryEvents, ...retryResult.events],
            };
          }
        } catch {
          recoveryEvents.push({
            type: "node_error",
            nodeId: `${node.id}:recovery`,
            nodeType: NodeType.LLM,
            error: "Self-healing recovery failed",
          });
        }

        events.push(...recoveryEvents);
      }

      // Recovery exhausted — emit error events
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

    // ── Execution context ────────────────────────────────────────────────
    const contextMap = new Map<string, Record<string, unknown>>();
    const conditionBranches = new Map<string, string>();

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

        const predOutput = contextMap.get(pred.source);
        if (predOutput && Object.keys(predOutput).length === 0 && !(predNode?.data as Record<string, unknown>)?.__executed) {
          skippedCount++;
          continue;
        }

        activeCount++;
        if (predOutput) {
          if (pred.targetHandle) {
            nodeInputs[pred.targetHandle] = predOutput;
          } else {
            Object.assign(nodeInputs, predOutput);
          }
        }
      }

      const skip = preds.length > 0 && activeCount === 0 && skippedCount > 0;
      return { nodeInputs, skip };
    };

    // ── Wave-by-wave execution ───────────────────────────────────────────
    for (const level of levels) {
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

          // Update context
          contextMap.set(result.nodeId, result.output);
          const node = nodeMap.get(result.nodeId)!;
          (node.data as Record<string, unknown>).__executed = true;

          // Track condition branches
          if (node.type === NodeType.CONDITION && typeof result.output.branch === "string") {
            conditionBranches.set(result.nodeId, result.output.branch);
          }
        }
      }

      // ── Serial HUMAN_GATE execution ────────────────────────────────────
      for (const nodeId of gateIds) {
        const node = nodeMap.get(nodeId)!;
        const { nodeInputs, skip } = gatherInputs(nodeId);

        if (skip) {
          contextMap.set(nodeId, {});
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
        this.pendingGates.set(nodeId, { resolve: gateResolve, promise: gatePromise });

        yield {
          type: "human_gate_pending",
          nodeId,
          nodeType: NodeType.HUMAN_GATE,
          prompt: (node.data.prompt as string) || "Awaiting human input",
          options: (node.data.options as string[]) || [],
        };

        const choice = await gatePromise;
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
  }
}

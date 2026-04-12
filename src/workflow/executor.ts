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
   * Execute the workflow, yielding events as progress is made.
   */
  async *run(
    inputs: Record<string, unknown>
  ): AsyncGenerator<ExecutionEvent> {
    const { nodes, edges } = this.definition;

    // ── Build node map ──────────────────────────────────────────────────
    const nodeMap = new Map<string, WorkflowNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    // ── Build adjacency list and in-degree map ──────────────────────────
    const adjacency = new Map<string, { target: string; sourceHandle?: string; targetHandle?: string }[]>();
    const inDegree = new Map<string, number>();

    for (const node of nodes) {
      adjacency.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    for (const edge of edges) {
      adjacency.get(edge.source)!.push({
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }

    // ── Topological sort (Kahn's algorithm) ─────────────────────────────
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const topoOrder: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      topoOrder.push(current);
      for (const edge of adjacency.get(current) || []) {
        const newDeg = (inDegree.get(edge.target) || 1) - 1;
        inDegree.set(edge.target, newDeg);
        if (newDeg === 0) {
          queue.push(edge.target);
        }
      }
    }

    if (topoOrder.length !== nodes.length) {
      yield {
        type: "workflow_error",
        error: "Workflow contains a cycle — topological sort failed",
      };
      return;
    }

    // ── Build reverse adjacency (predecessors for each node) ────────────
    const predecessors = new Map<string, { source: string; sourceHandle?: string; targetHandle?: string }[]>();
    for (const node of nodes) {
      predecessors.set(node.id, []);
    }
    for (const edge of edges) {
      predecessors.get(edge.target)!.push({
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
    }

    // ── Execution context: stores each node's output ────────────────────
    const contextMap = new Map<string, Record<string, unknown>>();

    // ── Seed INPUT nodes with the provided workflow inputs ───────────────
    for (const node of nodes) {
      if (node.type === NodeType.INPUT) {
        const inputName = (node.data.name as string) || node.id;
        const value = inputs[inputName] ?? node.data.default ?? null;
        contextMap.set(node.id, { [inputName]: value, value });
      }
    }

    // ── Track which branches a CONDITION node chose ─────────────────────
    const conditionBranches = new Map<string, string>(); // nodeId -> "true" | "false"

    // ── Execute nodes in topological order ──────────────────────────────
    for (const nodeId of topoOrder) {
      const node = nodeMap.get(nodeId)!;

      // INPUT nodes are already seeded
      if (node.type === NodeType.INPUT) continue;

      // ── Gather inputs from predecessor outputs ────────────────────────
      const nodeInputs: Record<string, unknown> = {};
      let skippedCount = 0;
      let activeCount = 0;
      const preds = predecessors.get(nodeId) || [];

      for (const pred of preds) {
        const predNode = nodeMap.get(pred.source);

        // For CONDITION predecessors, only follow the matching branch
        if (predNode?.type === NodeType.CONDITION) {
          const branch = conditionBranches.get(pred.source);
          // sourceHandle indicates which branch this edge represents
          if (pred.sourceHandle && branch && pred.sourceHandle !== branch) {
            skippedCount++;
            continue;
          }
        }

        // If a predecessor was itself skipped (empty output from a skipped branch),
        // propagate the skip for that path
        const predOutput = contextMap.get(pred.source);
        if (predOutput && Object.keys(predOutput).length === 0 && !nodeMap.get(pred.source)?.data.__executed) {
          skippedCount++;
          continue;
        }

        activeCount++;
        if (predOutput) {
          // If targetHandle is set, store under that key; otherwise merge all
          if (pred.targetHandle) {
            nodeInputs[pred.targetHandle] = predOutput;
          } else {
            Object.assign(nodeInputs, predOutput);
          }
        }
      }

      // If ALL predecessor paths were skipped (no active branch leads here), skip this node.
      // IMPORTANT: For diamond / merge nodes where some predecessors are skipped
      // (e.g., the unselected branch of a condition), we should still execute
      // as long as at least one active predecessor delivered data.
      if (preds.length > 0 && activeCount === 0 && skippedCount > 0) {
        contextMap.set(nodeId, {});
        continue;
      }

      // ── Yield node_start ──────────────────────────────────────────────
      yield {
        type: "node_start",
        nodeId,
        nodeType: node.type as NodeType,
      };

      // ── Handle HUMAN_GATE specially ───────────────────────────────────
      if (node.type === NodeType.HUMAN_GATE) {
        let gateResolve!: (choice: string) => void;
        const gatePromise = new Promise<string>((resolve) => {
          gateResolve = resolve;
        });
        this.pendingGates.set(nodeId, {
          resolve: gateResolve,
          promise: gatePromise,
        });

        yield {
          type: "human_gate_pending",
          nodeId,
          nodeType: NodeType.HUMAN_GATE,
          prompt: (node.data.prompt as string) || "Awaiting human input",
          options: (node.data.options as string[]) || [],
        };

        // Wait for resumeGate to be called
        const choice = await gatePromise;
        const output = { ...nodeInputs, choice };
        contextMap.set(nodeId, output);

        yield {
          type: "node_complete",
          nodeId,
          nodeType: NodeType.HUMAN_GATE,
          output,
        };
        continue;
      }

      // ── Look up and execute the node handler ──────────────────────────
      const handler = nodeHandlers.get(node.type as NodeType);
      if (!handler) {
        const error = `No handler registered for node type "${node.type}"`;
        yield { type: "node_error", nodeId, nodeType: node.type as NodeType, error };
        yield { type: "workflow_error", error: `Node ${nodeId}: ${error}` };
        return;
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
            setTimeout(() => reject(new Error(`Node "${nodeId}" timed out after ${timeoutMs}ms`)), timeoutMs)
          ),
        ]);
        contextMap.set(nodeId, output);

        // Track condition branches
        if (node.type === NodeType.CONDITION && typeof output.branch === "string") {
          conditionBranches.set(nodeId, output.branch);
        }

        yield {
          type: "node_complete",
          nodeId,
          nodeType: node.type as NodeType,
          output,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        yield { type: "node_error", nodeId, nodeType: node.type as NodeType, error };
        yield { type: "workflow_error", error: `Node ${nodeId} failed: ${error}` };
        return;
      }
    }

    // ── Collect OUTPUT nodes and yield workflow_complete ─────────────────
    const finalOutputs: Record<string, unknown> = {};
    for (const node of nodes) {
      if (node.type === NodeType.OUTPUT) {
        const outputName = (node.data.name as string) || node.id;
        const nodeOutput = contextMap.get(node.id) || {};
        finalOutputs[outputName] = nodeOutput;
      }
    }

    yield {
      type: "workflow_complete",
      outputs: finalOutputs,
    };
  }
}

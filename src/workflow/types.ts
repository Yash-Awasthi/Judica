import { z } from "zod";

// Schema version for workflow definition compatibility
export const WORKFLOW_SCHEMA_VERSION = 1;

export enum NodeType {
  INPUT = "input",
  OUTPUT = "output",
  LLM = "llm",
  TOOL = "tool",
  CONDITION = "condition",
  LOOP = "loop",
  TEMPLATE = "template",
  CODE = "code",
  HTTP = "http",
  HUMAN_GATE = "human_gate",
  MERGE = "merge",
  SPLIT = "split",
}

// Discriminated union node data types for type-safe narrowing
export interface LLMNodeData {
  type: "llm";
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: string;
  timeout?: number;
}

export interface ConditionNodeData {
  type: "condition";
  expression: string;
  branches: string[];
  timeout?: number;
}

export interface CodeNodeData {
  type: "code";
  language: "javascript" | "typescript" | "python";
  script: string;
  timeout?: number;
}

export interface HTTPNodeData {
  type: "http";
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface HumanGateNodeData {
  type: "human_gate";
  prompt?: string;
  options?: string[];
  timeout?: number;
}

export interface InputNodeData {
  type: "input";
  name: string;
  default?: unknown;
}

export interface OutputNodeData {
  type: "output";
  name: string;
}

export interface GenericNodeData {
  type: string;
  timeout?: number;
  [key: string]: unknown;
}

/**
 * Per-node self-healing configuration (4.21).
 * Controls automatic recovery attempts before falling through to a HUMAN_GATE.
 */
export interface NodeSelfHealingConfig {
  /** Enable self-healing for this node (default: inherits global setting). */
  enabled?: boolean;
  /** Maximum automatic fix attempts before escalating to HUMAN_GATE (default: 2). */
  maxAttempts?: number;
  /**
   * Recovery strategies tried in order.
   * - "retry_with_adjusted_params" — re-run with LLM-corrected inputs
   * - "swap_provider"              — retry LLM nodes with a fallback provider
   * - "rewrite_prompt"             — ask recovery agent to rewrite the failing prompt
   */
  strategies?: Array<"retry_with_adjusted_params" | "swap_provider" | "rewrite_prompt">;
  /** Human-gate fallback prompt shown when all strategies are exhausted (default: auto-generated). */
  hitlPrompt?: string;
}

// Union of all node data shapes
export type TypedNodeData =
  | LLMNodeData
  | ConditionNodeData
  | CodeNodeData
  | HTTPNodeData
  | HumanGateNodeData
  | InputNodeData
  | OutputNodeData
  | GenericNodeData;

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>; // Kept for backward compat; use TypedNodeData for new code
  /** Per-node self-healing override (4.21). If absent, global defaults apply. */
  selfHealing?: NodeSelfHealingConfig;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowInput {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  description?: string;
  default?: unknown;
}

export interface WorkflowOutput {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  nodeId: string; // which output node provides this
}

export interface WorkflowDefinition {
  // Version field for schema evolution
  version?: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  inputs: WorkflowInput[];
  outputs: WorkflowOutput[];
}

export interface ExecutionEvent {
  type: "node_start" | "node_complete" | "node_error" | "human_gate_pending" | "workflow_complete" | "workflow_error";
  nodeId?: string;
  nodeType?: NodeType;
  output?: unknown;
  error?: string;
  prompt?: string;
  options?: string[];
  outputs?: Record<string, unknown>;
}

export interface NodeContext {
  inputs: Record<string, unknown>;
  nodeData: Record<string, unknown>;
  runId: string;
  // Consistent userId type — use string to match auth layer (UUIDs/JWTs)
  userId: string | number;
}

export type NodeHandler = (ctx: NodeContext) => Promise<Record<string, unknown>>;

// ─── Zod schema for runtime validation of workflow definitions ────────

const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.nativeEnum(NodeType),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()),
});

const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

const WorkflowInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "object"]),
  description: z.string().optional(),
  default: z.unknown().optional(),
});

const WorkflowOutputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "object"]),
  nodeId: z.string().min(1),
});

export const WorkflowDefinitionSchema = z.object({
  version: z.number().int().positive().optional(),
  // Cap array sizes to prevent memory exhaustion from malicious payloads
  nodes: z.array(WorkflowNodeSchema).min(1, "Workflow must have at least one node").max(500, "Workflow cannot exceed 500 nodes"),
  edges: z.array(WorkflowEdgeSchema).max(2000, "Workflow cannot exceed 2000 edges"),
  inputs: z.array(WorkflowInputSchema).max(50, "Workflow cannot exceed 50 inputs"),
  outputs: z.array(WorkflowOutputSchema).max(50, "Workflow cannot exceed 50 outputs"),
});

/** Validate a raw workflow definition at ingestion time.
 * Returns parsed WorkflowDefinition or throws with clear error messages. */
export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition {
  const result = WorkflowDefinitionSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid workflow definition: ${issues}`);
  }
  // Detect cycles in the workflow graph to prevent infinite execution loops
  const def = result.data as WorkflowDefinition;
  const adjacency = new Map<string, string[]>();
  for (const node of def.nodes) adjacency.set(node.id, []);
  for (const edge of def.edges) {
    const targets = adjacency.get(edge.source);
    if (targets) targets.push(edge.target);
  }
  const visited = new Set<string>();
  const inStack = new Set<string>();
  function hasCycle(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (hasCycle(neighbor)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }
  for (const node of def.nodes) {
    if (hasCycle(node.id)) {
      throw new Error("Invalid workflow definition: cycle detected in node graph");
    }
  }

  return def;
}

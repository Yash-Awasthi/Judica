import { z } from "zod";

// P10-95: Schema version for workflow definition compatibility
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

// P10-93: Discriminated union node data types for type-safe narrowing
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

// P10-93: Union of all node data shapes
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
  // P10-95: Version field for schema evolution
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
  // P10-94: Consistent userId type — use string to match auth layer (UUIDs/JWTs)
  userId: string | number;
}

export type NodeHandler = (ctx: NodeContext) => Promise<Record<string, unknown>>;

// ─── P10-92: Zod schema for runtime validation of workflow definitions ────────

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
  nodes: z.array(WorkflowNodeSchema).min(1, "Workflow must have at least one node"),
  edges: z.array(WorkflowEdgeSchema),
  inputs: z.array(WorkflowInputSchema),
  outputs: z.array(WorkflowOutputSchema),
});

/** P10-92: Validate a raw workflow definition at ingestion time.
 * Returns parsed WorkflowDefinition or throws with clear error messages. */
export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition {
  const result = WorkflowDefinitionSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid workflow definition: ${issues}`);
  }
  return result.data as WorkflowDefinition;
}

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

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
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
  userId: number;
}

export type NodeHandler = (ctx: NodeContext) => Promise<Record<string, unknown>>;

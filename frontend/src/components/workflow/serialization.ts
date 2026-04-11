import type { Node, Edge } from "@xyflow/react";

export interface WorkflowDefinition {
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  inputs: WorkflowInputDef[];
  outputs: WorkflowOutputDef[];
}

interface WorkflowNodeDef {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface WorkflowEdgeDef {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface WorkflowInputDef {
  name: string;
  type: string;
  description?: string;
  default?: unknown;
}

interface WorkflowOutputDef {
  name: string;
  type: string;
  nodeId: string;
}

export function definitionFromFlow(nodes: Node[], edges: Edge[]): WorkflowDefinition {
  const defNodes: WorkflowNodeDef[] = nodes.map((n) => ({
    id: n.id,
    type: n.type || "input",
    position: n.position,
    data: n.data as Record<string, unknown>,
  }));

  const defEdges: WorkflowEdgeDef[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || undefined,
    targetHandle: e.targetHandle || undefined,
  }));

  const inputs: WorkflowInputDef[] = nodes
    .filter((n) => n.type === "input")
    .map((n) => ({
      name: (n.data.name as string) || n.id,
      type: (n.data.type as string) || "string",
      description: (n.data.description as string) || undefined,
      default: n.data.default,
    }));

  const outputs: WorkflowOutputDef[] = nodes
    .filter((n) => n.type === "output")
    .map((n) => ({
      name: (n.data.name as string) || n.id,
      type: (n.data.type as string) || "string",
      nodeId: n.id,
    }));

  return { nodes: defNodes, edges: defEdges, inputs, outputs };
}

export function flowFromDefinition(definition: WorkflowDefinition): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = definition.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
  }));

  const edges: Edge[] = definition.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || null,
    targetHandle: e.targetHandle || null,
  }));

  return { nodes, edges };
}

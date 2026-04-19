/**
 * Custom Workflow Nodes service.
 *
 * Allows registration, lookup, and execution of custom node types
 * within agent workflows. Ships with 3 built-in node types.
 */

import crypto from "crypto";
import logger from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NodeDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  inputSchema: Record<string, { required: boolean; type: string }>;
  outputSchema: Record<string, { type: string }>;
  handler: (inputs: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

// ─── In-memory store ────────────────────────────────────────────────────────

const nodeTypes = new Map<string, NodeDefinition>();

// ─── Built-in node types ────────────────────────────────────────────────────

function seedBuiltins(): void {
  const builtins: NodeDefinition[] = [
    {
      id: "custom_llm",
      name: "LLM Prompt",
      description: "Sends a prompt to an LLM and returns the response",
      category: "ai",
      inputSchema: { prompt: { required: true, type: "string" }, model: { required: false, type: "string" } },
      outputSchema: { response: { type: "string" } },
      handler: (inputs) => ({ response: `LLM response to: ${inputs.prompt}` }),
    },
    {
      id: "custom_transform",
      name: "JS Transform",
      description: "Applies a JavaScript transform to input data",
      category: "transform",
      inputSchema: { data: { required: true, type: "any" }, expression: { required: true, type: "string" } },
      outputSchema: { result: { type: "any" } },
      handler: (inputs) => ({ result: inputs.data }),
    },
    {
      id: "custom_filter",
      name: "Data Filter",
      description: "Filters data based on a condition",
      category: "transform",
      inputSchema: { data: { required: true, type: "array" }, condition: { required: true, type: "string" } },
      outputSchema: { filtered: { type: "array" } },
      handler: (inputs) => ({ filtered: Array.isArray(inputs.data) ? inputs.data : [] }),
    },
  ];

  for (const b of builtins) {
    nodeTypes.set(b.id, b);
  }
}

seedBuiltins();

// ─── Core Functions ─────────────────────────────────────────────────────────

export function registerNodeType(def: Omit<NodeDefinition, "id"> & { id?: string }): NodeDefinition {
  const id = def.id || crypto.randomBytes(12).toString("hex");
  if (nodeTypes.has(id)) {
    throw new Error(`Node type '${id}' is already registered`);
  }
  const node: NodeDefinition = { ...def, id };
  nodeTypes.set(id, node);
  logger.info({ nodeId: id }, "Registered custom workflow node type");
  return node;
}

export function listNodeTypes(category?: string): NodeDefinition[] {
  const all = Array.from(nodeTypes.values());
  if (category) {
    return all.filter((n) => n.category === category);
  }
  return all;
}

export function getNodeType(id: string): NodeDefinition | undefined {
  return nodeTypes.get(id);
}

export async function executeNode(
  nodeId: string,
  inputs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const node = nodeTypes.get(nodeId);
  if (!node) {
    throw new Error(`Node type '${nodeId}' not found`);
  }
  logger.debug({ nodeId, inputs }, "Executing custom workflow node");
  const result = await node.handler(inputs);
  return result;
}

export function unregisterNodeType(id: string): boolean {
  const deleted = nodeTypes.delete(id);
  if (deleted) {
    logger.info({ nodeId: id }, "Unregistered custom workflow node type");
  }
  return deleted;
}

export function validateInputs(
  nodeId: string,
  inputs: Record<string, unknown>,
): { valid: boolean; missing: string[] } {
  const node = nodeTypes.get(nodeId);
  if (!node) {
    throw new Error(`Node type '${nodeId}' not found`);
  }
  const missing: string[] = [];
  for (const [key, schema] of Object.entries(node.inputSchema)) {
    if (schema.required && !(key in inputs)) {
      missing.push(key);
    }
  }
  return { valid: missing.length === 0, missing };
}

// ─── Reset (for tests) ─────────────────────────────────────────────────────

export function _reset(): void {
  nodeTypes.clear();
  seedBuiltins();
}

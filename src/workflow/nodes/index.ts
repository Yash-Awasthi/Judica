import { NodeType } from "../types.js";
import type { NodeHandler } from "../types.js";
import { llmHandler } from "./llm.handler.js";
import { toolHandler } from "./tool.handler.js";
import { conditionHandler } from "./condition.handler.js";
import { templateHandler } from "./template.handler.js";
import { codeHandler } from "./code.handler.js";
import { httpHandler } from "./http.handler.js";
import { loopHandler } from "./loop.handler.js";
import { mergeHandler } from "./merge.handler.js";
import { splitHandler } from "./split.handler.js";

// Trivial pass-through for INPUT nodes
const inputHandler: NodeHandler = async (ctx) => ({ ...ctx.inputs });

// Trivial pass-through for OUTPUT nodes
const outputHandler: NodeHandler = async (ctx) => ({ ...ctx.inputs });

// Placeholder for HUMAN_GATE — actual logic lives in the executor
const humanGateHandler: NodeHandler = async (ctx) => ({ ...ctx.inputs });

// P59-06: Exported as ReadonlyMap to prevent handler registry mutation
export const nodeHandlers: ReadonlyMap<NodeType, NodeHandler> = new Map<NodeType, NodeHandler>([
  [NodeType.INPUT, inputHandler],
  [NodeType.OUTPUT, outputHandler],
  [NodeType.LLM, llmHandler],
  [NodeType.TOOL, toolHandler],
  [NodeType.CONDITION, conditionHandler],
  [NodeType.LOOP, loopHandler],
  [NodeType.TEMPLATE, templateHandler],
  [NodeType.CODE, codeHandler],
  [NodeType.HTTP, httpHandler],
  [NodeType.HUMAN_GATE, humanGateHandler],
  [NodeType.MERGE, mergeHandler],
  [NodeType.SPLIT, splitHandler],
]);

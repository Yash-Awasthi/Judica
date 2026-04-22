import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

/**
 * Tool Chain Engine: autonomous sequencing of tool operations.
 * Chains tools like: web search → extraction → analysis → chart → report.
 */

export type ToolType = "web_search" | "extract" | "analyze" | "summarize" | "transform" | "generate";

export interface ToolStep {
  id: string;
  tool: ToolType;
  input: string;
  config?: Record<string, unknown>;
}

export interface ToolStepResult {
  stepId: string;
  tool: ToolType;
  output: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface ToolChain {
  id: string;
  name: string;
  steps: ToolStep[];
  createdAt: string;
}

export interface ToolChainResult {
  chainId: string;
  results: ToolStepResult[];
  finalOutput: string;
  totalDurationMs: number;
  success: boolean;
}

// ─── Built-in Tool Implementations ──────────────────────────────────────────

async function executeWebSearch(input: string): Promise<string> {
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Search and summarize the latest information about: ${input}\n\nProvide a comprehensive summary with key facts and sources.`,
      },
    ],
    temperature: 0,
  });
  return result.text;
}

async function executeExtract(input: string, config?: Record<string, unknown>): Promise<string> {
  const extractionTarget = config?.target || "key facts, entities, and relationships";
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Extract ${extractionTarget} from the following text. Return structured data.\n\n${input.substring(0, 4000)}`,
      },
    ],
    temperature: 0,
  });
  return result.text;
}

async function executeAnalyze(input: string, config?: Record<string, unknown>): Promise<string> {
  const analysisType = config?.type || "comprehensive";
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Perform a ${analysisType} analysis of the following data. Identify patterns, trends, and insights.\n\n${input.substring(0, 4000)}`,
      },
    ],
    temperature: 0,
  });
  return result.text;
}

async function executeSummarize(input: string, config?: Record<string, unknown>): Promise<string> {
  const length = config?.length || "concise";
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Provide a ${length} summary of the following:\n\n${input.substring(0, 4000)}`,
      },
    ],
    temperature: 0,
  });
  return result.text;
}

async function executeTransform(input: string, config?: Record<string, unknown>): Promise<string> {
  const format = config?.format || "structured markdown";
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Transform the following content into ${format}:\n\n${input.substring(0, 4000)}`,
      },
    ],
    temperature: 0,
  });
  return result.text;
}

async function executeGenerate(input: string, config?: Record<string, unknown>): Promise<string> {
  const outputType = config?.outputType || "report";
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Based on the following input, generate a ${outputType}:\n\n${input.substring(0, 4000)}`,
      },
    ],
    temperature: 0.3,
  });
  return result.text;
}

const TOOL_EXECUTORS: Record<ToolType, (input: string, config?: Record<string, unknown>) => Promise<string>> = {
  web_search: executeWebSearch,
  extract: executeExtract,
  analyze: executeAnalyze,
  summarize: executeSummarize,
  transform: executeTransform,
  generate: executeGenerate,
};

// ─── Chain Execution ─────────────────────────────────────────────────────────

/**
 * Execute a single tool step.
 */
async function executeStep(step: ToolStep, previousOutput?: string): Promise<ToolStepResult> {
  const startTime = Date.now();
  const input = previousOutput
    ? `${step.input}\n\nPrevious step output:\n${previousOutput}`
    : step.input;

  try {
    const executor = TOOL_EXECUTORS[step.tool];
    if (!executor) {
      throw new Error(`Unknown tool: ${step.tool}`);
    }

    const output = await executor(input, step.config);

    return {
      stepId: step.id,
      tool: step.tool,
      output,
      durationMs: Date.now() - startTime,
      success: true,
    };
  } catch (err) {
    return {
      stepId: step.id,
      tool: step.tool,
      output: "",
      durationMs: Date.now() - startTime,
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Execute a tool chain sequentially, passing output from each step to the next.
 * Stops on first failure unless continueOnError is set.
 */
export async function executeChain(
  chain: ToolChain,
  options?: { continueOnError?: boolean; onStep?: (result: ToolStepResult) => void },
): Promise<ToolChainResult> {
  const MAX_CHAIN_STEPS = 20;
  if (chain.steps.length > MAX_CHAIN_STEPS) {
    return {
      chainId: chain.id,
      results: [],
      finalOutput: "",
      totalDurationMs: 0,
      success: false,
    };
  }

  const results: ToolStepResult[] = [];
  let previousOutput: string | undefined;
  const startTime = Date.now();

  for (const step of chain.steps) {
    logger.info({ chainId: chain.id, stepId: step.id, tool: step.tool }, "Executing tool chain step");

    const result = await executeStep(step, previousOutput);
    results.push(result);

    if (options?.onStep) {
      options.onStep(result);
    }

    if (!result.success && !options?.continueOnError) {
      logger.warn({ chainId: chain.id, stepId: step.id, error: result.error }, "Chain halted on step failure");
      break;
    }

    previousOutput = result.output;
  }

  const allSuccess = results.every((r) => r.success);
  const finalOutput = results[results.length - 1]?.output || "";

  return {
    chainId: chain.id,
    results,
    finalOutput,
    totalDurationMs: Date.now() - startTime,
    success: allSuccess,
  };
}

/**
 * Build a tool chain from a natural language description.
 */
export async function buildChainFromDescription(description: string): Promise<ToolChain> {
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Create a tool chain to accomplish this task. Available tools: web_search, extract, analyze, summarize, transform, generate.

Return a JSON object:
{
  "name": "chain name",
  "steps": [
    { "id": "step_1", "tool": "web_search", "input": "what to search for" },
    { "id": "step_2", "tool": "extract", "input": "what to extract", "config": {"target": "key metrics"} }
  ]
}

Each step receives the previous step's output automatically. Only output JSON.

Task: ${description}`,
      },
    ],
    temperature: 0,
  });

  const match = result.text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Failed to parse chain description");
  }

  const parsed = JSON.parse(match[0]) as { name: string; steps: ToolStep[] };

  // Validate parsed chain
  if (!Array.isArray(parsed.steps) || parsed.steps.length > 20) {
    throw new Error("Generated chain has too many steps (max 20)");
  }
  for (const step of parsed.steps) {
    if (!step.id || !step.tool || !step.input) {
      throw new Error("Invalid step in generated chain");
    }
  }

  return {
    id: `chain_${Date.now()}`,
    name: parsed.name,
    steps: parsed.steps,
    createdAt: new Date().toISOString(),
  };
}

// ─── Pre-built Chain Templates ───────────────────────────────────────────────

export const CHAIN_TEMPLATES: Record<string, ToolChain> = {
  research_report: {
    id: "template_research_report",
    name: "Research Report",
    steps: [
      { id: "search", tool: "web_search", input: "" },
      { id: "extract", tool: "extract", input: "Extract key findings, statistics, and expert opinions", config: { target: "findings and statistics" } },
      { id: "analyze", tool: "analyze", input: "Analyze the extracted data for patterns and insights", config: { type: "comprehensive" } },
      { id: "report", tool: "generate", input: "Generate a structured research report", config: { outputType: "detailed research report with citations" } },
    ],
    createdAt: "template",
  },
  competitive_analysis: {
    id: "template_competitive_analysis",
    name: "Competitive Analysis",
    steps: [
      { id: "search", tool: "web_search", input: "" },
      { id: "extract", tool: "extract", input: "Extract company data, market positions, and strategies", config: { target: "competitive intelligence" } },
      { id: "analyze", tool: "analyze", input: "Compare competitors across key dimensions", config: { type: "comparative" } },
      { id: "summary", tool: "summarize", input: "Create an executive summary of the competitive landscape", config: { length: "executive" } },
    ],
    createdAt: "template",
  },
  data_pipeline: {
    id: "template_data_pipeline",
    name: "Data Pipeline",
    steps: [
      { id: "extract", tool: "extract", input: "", config: { target: "structured data" } },
      { id: "transform", tool: "transform", input: "Clean and normalize the data", config: { format: "structured JSON" } },
      { id: "analyze", tool: "analyze", input: "Statistical analysis of the dataset", config: { type: "statistical" } },
      { id: "visualize", tool: "generate", input: "Generate a data visualization summary", config: { outputType: "data visualization description with chart recommendations" } },
    ],
    createdAt: "template",
  },
};

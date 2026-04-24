/**
 * Deep Research Orchestrator Loop — multi-cycle agentic research.
 *
 * Flow (modeled after Onyx dr_loop.py):
 * 1. Clarification — refine ambiguous queries (optional)
 * 2. Planning — break query into sub-tasks with priorities
 * 3. Cyclic execution — orchestrator dispatches research agents,
 *    uses think tool, accumulates citations, assesses progress
 * 4. Report generation — synthesize all findings into structured report
 *
 * The orchestrator LLM uses function-calling with three tools:
 * - research_agent: dispatch focused sub-queries
 * - think: reason about gaps and next steps
 * - generate_report: signal readiness for final synthesis
 */

import { randomUUID } from "crypto";
import { routeAndCollect } from "../../router/smartRouter.js";
import type { AdapterMessage } from "../../adapters/types.js";
import { normalizeToolArguments } from "../../adapters/types.js";
import logger from "../logger.js";
import {
  DEEP_RESEARCH_TOOLS,
  ORCHESTRATOR_SYSTEM_PROMPT,
  REPORT_GENERATION_PROMPT,
  CLARIFICATION_PROMPT,
  PLANNING_PROMPT,
} from "./tools.js";
import type {
  DeepResearchConfig,
  DeepResearchSession,
  DeepResearchPhase,
  DeepResearchEvent,
  ResearchPlan,
  ResearchSubTask,
  ResearchCycle,
  ResearchAgentResult,
  ThinkToolResult,
  Citation,
  CitationMapping,
} from "./models.js";
import { DEFAULT_DEEP_RESEARCH_CONFIG, DeepResearchPhase as Phase } from "./models.js";

type EventEmitter = (event: DeepResearchEvent) => void;

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function runDeepResearch(
  query: string,
  userId: number,
  config: Partial<DeepResearchConfig> = {},
  emit?: EventEmitter,
): Promise<DeepResearchSession> {
  const cfg: DeepResearchConfig = { ...DEFAULT_DEEP_RESEARCH_CONFIG, ...config };
  const session: DeepResearchSession = {
    id: randomUUID(),
    userId,
    query,
    config: cfg,
    phase: Phase.CLARIFICATION,
    cycles: [],
    citations: { citations: new Map(), nextId: 1 },
    totalTokens: 0,
    startedAt: new Date(),
  };

  const deadline = Date.now() + cfg.timeoutMs;

  try {
    // Phase 1: Clarification
    if (cfg.enableClarification) {
      emitPhase(emit, Phase.CLARIFICATION);
      const refined = await clarifyQuery(query, cfg);
      session.totalTokens += refined.tokens;
      session.plan = {
        originalQuery: query,
        refinedQuery: refined.refinedQuery,
        subTasks: [],
        strategy: "",
      };
    }

    // Phase 2: Planning
    if (cfg.enablePlanning) {
      emitPhase(emit, Phase.PLANNING);
      const plan = await createResearchPlan(
        session.plan?.refinedQuery ?? query,
        cfg,
      );
      session.totalTokens += plan.tokens;
      session.plan = {
        originalQuery: query,
        refinedQuery: session.plan?.refinedQuery ?? query,
        subTasks: plan.subTasks,
        strategy: plan.strategy,
      };
      emit?.({ type: "plan_ready", plan: session.plan });
    }

    // Phase 3: Cyclic execution
    emitPhase(emit, Phase.RESEARCHING);
    const orchestratorMessages: AdapterMessage[] = [
      {
        role: "user",
        content: buildOrchestratorPrompt(session),
      },
    ];

    for (let cycle = 0; cycle < cfg.maxCycles; cycle++) {
      if (Date.now() > deadline) {
        session.phase = Phase.TIMED_OUT;
        emitPhase(emit, Phase.TIMED_OUT);
        break;
      }

      const cycleResult = await executeCycle(
        cycle,
        orchestratorMessages,
        session,
        cfg,
        emit,
      );

      session.cycles.push(cycleResult.cycle);
      session.totalTokens += cycleResult.tokensUsed;

      emit?.({ type: "cycle_complete", cycle: cycleResult.cycle });

      if (cycleResult.shouldGenerateReport) {
        break;
      }

      // Add cycle results as context for next orchestrator turn
      orchestratorMessages.push({
        role: "assistant",
        content: cycleResult.orchestratorResponse,
      });
      orchestratorMessages.push({
        role: "user",
        content: `Cycle ${cycle + 1} complete. ${cycleResult.cycle.newCitations.length} new citations found. Continue researching or call generate_report if you have sufficient information.`,
      });
    }

    // Phase 4: Report generation
    if (session.phase !== Phase.TIMED_OUT) {
      emitPhase(emit, Phase.GENERATING_REPORT);
      const report = await generateReport(session, cfg, emit);
      session.report = report.text;
      session.totalTokens += report.tokens;
    }

    session.phase = session.phase === Phase.TIMED_OUT ? Phase.TIMED_OUT : Phase.COMPLETE;
    session.completedAt = new Date();
    emit?.({ type: "complete", session });

    return session;
  } catch (err) {
    session.phase = Phase.FAILED;
    session.error = err instanceof Error ? err.message : String(err);
    session.completedAt = new Date();
    emit?.({ type: "error", message: session.error });
    logger.error({ err, sessionId: session.id }, "Deep research failed");
    return session;
  }
}

// ─── Clarification Phase ─────────────────────────────────────────────────────

async function clarifyQuery(
  query: string,
  cfg: DeepResearchConfig,
): Promise<{ refinedQuery: string; tokens: number }> {
  const result = await routeAndCollect(
    {
      model: cfg.orchestratorModel ?? "auto",
      messages: [
        { role: "system", content: CLARIFICATION_PROMPT },
        { role: "user", content: query },
      ],
      temperature: 0.3,
    },
    { tags: ["quality"] },
  );

  try {
    const parsed = JSON.parse(result.text);
    return {
      refinedQuery: parsed.refinedQuery ?? query,
      tokens: result.usage.prompt_tokens + result.usage.completion_tokens,
    };
  } catch {
    return {
      refinedQuery: query,
      tokens: result.usage.prompt_tokens + result.usage.completion_tokens,
    };
  }
}

// ─── Planning Phase ──────────────────────────────────────────────────────────

async function createResearchPlan(
  query: string,
  cfg: DeepResearchConfig,
): Promise<{ strategy: string; subTasks: ResearchSubTask[]; tokens: number }> {
  const result = await routeAndCollect(
    {
      model: cfg.orchestratorModel ?? "auto",
      messages: [
        { role: "system", content: PLANNING_PROMPT },
        { role: "user", content: query },
      ],
      temperature: 0.4,
    },
    { tags: ["quality"] },
  );

  const tokens = result.usage.prompt_tokens + result.usage.completion_tokens;

  try {
    const parsed = JSON.parse(result.text);
    const subTasks: ResearchSubTask[] = (parsed.subTasks ?? []).map(
      (t: { query: string; rationale: string; priority: number }) => ({
        id: randomUUID(),
        query: t.query,
        rationale: t.rationale,
        priority: t.priority ?? 5,
        status: "pending" as const,
      }),
    );
    // Sort by priority (highest first)
    subTasks.sort((a, b) => b.priority - a.priority);

    return { strategy: parsed.strategy ?? "", subTasks, tokens };
  } catch {
    return {
      strategy: "Direct investigation",
      subTasks: [
        {
          id: randomUUID(),
          query,
          rationale: "Primary query investigation",
          priority: 10,
          status: "pending",
        },
      ],
      tokens,
    };
  }
}

// ─── Cycle Execution ─────────────────────────────────────────────────────────

interface CycleResult {
  cycle: ResearchCycle;
  tokensUsed: number;
  shouldGenerateReport: boolean;
  orchestratorResponse: string;
}

async function executeCycle(
  cycleIndex: number,
  orchestratorMessages: AdapterMessage[],
  session: DeepResearchSession,
  cfg: DeepResearchConfig,
  emit?: EventEmitter,
): Promise<CycleResult> {
  const cycle: ResearchCycle = {
    index: cycleIndex,
    subQueries: [],
    agentResults: [],
    newCitations: [],
    assessment: "",
    needsMoreResearch: true,
    startedAt: new Date(),
  };

  let tokensUsed = 0;
  let shouldGenerateReport = false;

  // Ask orchestrator what to do next (with tool calling)
  const result = await routeAndCollect(
    {
      model: cfg.orchestratorModel ?? "auto",
      messages: orchestratorMessages,
      system_prompt: ORCHESTRATOR_SYSTEM_PROMPT,
      tools: DEEP_RESEARCH_TOOLS,
      temperature: 0.5,
    },
    { tags: ["quality", "tool-capable"] },
  );

  tokensUsed += result.usage.prompt_tokens + result.usage.completion_tokens;
  const orchestratorResponse = result.text;

  // Parse tool calls from the response
  // Since routeAndCollect returns text, we parse structured tool invocations
  // In a full implementation, the streaming adapter would yield tool_call chunks
  const toolCalls = parseToolCalls(result.text);

  const agentPromises: Promise<ResearchAgentResult>[] = [];
  let reportSummary = "";

  for (const toolCall of toolCalls) {
    switch (toolCall.name) {
      case "research_agent": {
        const subQuery = (toolCall.args.sub_query as string) ?? "";
        cycle.subQueries.push(subQuery);
        emit?.({ type: "cycle_start", cycleIndex, subQueries: [subQuery] });

        agentPromises.push(
          executeResearchAgent(subQuery, cfg).then((agentResult) => {
            emit?.({ type: "agent_result", cycleIndex, result: agentResult });
            return agentResult;
          }),
        );
        break;
      }
      case "think": {
        const thinkResult: ThinkToolResult = {
          reasoning: (toolCall.args.reasoning as string) ?? "",
          gaps: (toolCall.args.gaps as string[]) ?? [],
          nextQueries: (toolCall.args.next_queries as string[]) ?? [],
        };
        cycle.thinking = thinkResult.reasoning;
        emit?.({ type: "thinking", reasoning: thinkResult.reasoning });
        break;
      }
      case "generate_report": {
        shouldGenerateReport = true;
        reportSummary = (toolCall.args.summary as string) ?? "";
        break;
      }
    }
  }

  // If no tool calls were detected, treat the response as a think step
  if (toolCalls.length === 0 && orchestratorResponse.length > 0) {
    // Orchestrator responded in plain text — try to extract sub-queries
    const fallbackQueries = extractQueriesFromText(orchestratorResponse, session.plan?.refinedQuery ?? session.query);
    for (const q of fallbackQueries.slice(0, cfg.maxParallelAgents)) {
      cycle.subQueries.push(q);
      agentPromises.push(executeResearchAgent(q, cfg));
    }
  }

  // Wait for all research agents (bounded parallelism)
  if (agentPromises.length > 0) {
    const results = await Promise.allSettled(agentPromises);
    for (const r of results) {
      if (r.status === "fulfilled") {
        cycle.agentResults.push(r.value);
        tokensUsed += r.value.tokensUsed;

        // Accumulate citations
        for (const source of r.value.sources) {
          const citationId = String(session.citations.nextId++);
          const citation: Citation = {
            id: citationId,
            title: source.title,
            url: source.url,
            excerpt: source.content.slice(0, 500),
            cycleIndex,
            subQuery: r.value.subQuery,
          };
          session.citations.citations.set(citationId, citation);
          cycle.newCitations.push(citation);
        }
      }
    }
  }

  cycle.assessment = shouldGenerateReport
    ? `Research complete. ${reportSummary}`
    : `Cycle ${cycleIndex + 1} found ${cycle.newCitations.length} new citations.`;
  cycle.needsMoreResearch = !shouldGenerateReport;
  cycle.completedAt = new Date();

  return { cycle, tokensUsed, shouldGenerateReport, orchestratorResponse };
}

// ─── Research Agent ──────────────────────────────────────────────────────────

async function executeResearchAgent(
  subQuery: string,
  cfg: DeepResearchConfig,
): Promise<ResearchAgentResult> {
  // Use the existing webSearch approach from research.service.ts
  const { webSearch } = await import("../../services/research.service.js");

  const sources = await webSearch(subQuery, 5);

  // Synthesize findings
  const sourceSummary = sources
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.content}`)
    .join("\n\n");

  const result = await routeAndCollect(
    {
      model: cfg.agentModel ?? "auto",
      messages: [
        {
          role: "system",
          content:
            "You are a research agent. Synthesize the provided search results into a concise, factual answer. Cite sources using [N] notation.",
        },
        {
          role: "user",
          content: `Question: ${subQuery}\n\nSearch Results:\n${sourceSummary}`,
        },
      ],
      max_tokens: cfg.agentMaxTokens,
      temperature: 0.3,
    },
    { tags: ["fast"] },
  );

  return {
    subQuery,
    answer: result.text,
    sources,
    confidence: sources.length > 0 ? 0.7 : 0.3,
    tokensUsed: result.usage.prompt_tokens + result.usage.completion_tokens,
  };
}

// ─── Report Generation ───────────────────────────────────────────────────────

async function generateReport(
  session: DeepResearchSession,
  cfg: DeepResearchConfig,
  emit?: EventEmitter,
): Promise<{ text: string; tokens: number }> {
  const citationList = Array.from(session.citations.citations.entries())
    .map(([id, c]) => `[${id}] ${c.title} — ${c.url}`)
    .join("\n");

  const researchSummary = session.cycles
    .map(
      (c) =>
        `## Cycle ${c.index + 1}\n` +
        c.agentResults.map((r) => `**${r.subQuery}**: ${r.answer}`).join("\n\n"),
    )
    .join("\n\n---\n\n");

  const result = await routeAndCollect(
    {
      model: cfg.orchestratorModel ?? "auto",
      messages: [
        { role: "system", content: REPORT_GENERATION_PROMPT },
        {
          role: "user",
          content: `Original Query: ${session.query}\n\nRefined Query: ${session.plan?.refinedQuery ?? session.query}\n\nResearch Findings:\n${researchSummary}\n\nAvailable Citations:\n${citationList}`,
        },
      ],
      temperature: 0.4,
    },
    { tags: ["quality"] },
  );

  emit?.({ type: "report_chunk", text: result.text });

  return {
    text: result.text,
    tokens: result.usage.prompt_tokens + result.usage.completion_tokens,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emitPhase(emit: EventEmitter | undefined, phase: DeepResearchPhase): void {
  emit?.({ type: "phase_change", phase });
}

function buildOrchestratorPrompt(session: DeepResearchSession): string {
  const query = session.plan?.refinedQuery ?? session.query;
  const planSection = session.plan?.subTasks.length
    ? `\nResearch Plan:\n${session.plan.subTasks.map((t) => `- [${t.status}] ${t.query} (priority: ${t.priority})`).join("\n")}`
    : "";

  const previousFindings = session.cycles.length > 0
    ? `\nPrevious Findings:\n${session.cycles.map((c) => c.agentResults.map((r) => `- ${r.subQuery}: ${r.answer.slice(0, 200)}...`).join("\n")).join("\n")}`
    : "";

  return `Research Query: ${query}${planSection}${previousFindings}\n\nUse the available tools to investigate this query. Start by dispatching research agents for the highest-priority sub-tasks.`;
}

interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

function parseToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];

  // Try to find JSON tool call patterns in the response
  const toolCallPattern = /\{"name"\s*:\s*"(research_agent|think|generate_report)"[^}]*"arguments"\s*:\s*(\{[^}]*\})\s*\}/g;
  let match;
  while ((match = toolCallPattern.exec(text)) !== null) {
    try {
      const args = JSON.parse(match[2]);
      calls.push({ name: match[1], args });
    } catch {
      // Skip malformed tool calls
    }
  }

  // Also check for structured function call format
  const functionCallPattern = /<function_call>\s*(\w+)\((.*?)\)\s*<\/function_call>/gs;
  while ((match = functionCallPattern.exec(text)) !== null) {
    try {
      const args = JSON.parse(match[2]);
      calls.push({ name: match[1], args });
    } catch {
      // Skip malformed
    }
  }

  return calls;
}

function extractQueriesFromText(text: string, originalQuery: string): string[] {
  // Try to extract questions or research topics from plain text
  const lines = text.split("\n").filter((l) => l.trim().length > 10);
  const queries: string[] = [];

  for (const line of lines) {
    const trimmed = line.replace(/^[-*\d.)\s]+/, "").trim();
    if (trimmed.endsWith("?") || trimmed.toLowerCase().startsWith("search for") || trimmed.toLowerCase().startsWith("investigate")) {
      queries.push(trimmed);
    }
  }

  // Fallback: use the original query
  if (queries.length === 0) {
    queries.push(originalQuery);
  }

  return queries;
}

/**
 * Deep Research Tool Definitions — tools the orchestrator LLM can call.
 *
 * Three tools modeled after Onyx:
 * 1. research_agent — dispatches a focused sub-query to a research agent
 * 2. think_tool — lets the orchestrator reason about gaps and next steps
 * 3. generate_report — triggers final report synthesis
 */

import type { AdapterTool } from "../../adapters/types.js";

// ─── Research Agent Tool ─────────────────────────────────────────────────────

export const RESEARCH_AGENT_TOOL: AdapterTool = {
  name: "research_agent",
  description:
    "Dispatch a focused research sub-query to a research agent. " +
    "The agent will search the web, knowledge base, and other sources " +
    "to find relevant information. Use this to investigate specific aspects " +
    "of the overall research question. You can dispatch multiple agents in parallel.",
  parameters: {
    type: "object",
    properties: {
      sub_query: {
        type: "string",
        description: "The specific sub-question to investigate",
      },
      search_sources: {
        type: "array",
        items: { type: "string", enum: ["web", "knowledge_base", "documents"] },
        description: "Which sources to search (default: all)",
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (default: 5)",
      },
    },
    required: ["sub_query"],
  },
};

// ─── Think Tool ──────────────────────────────────────────────────────────────

export const THINK_TOOL: AdapterTool = {
  name: "think",
  description:
    "Use this tool to reason about the research so far. " +
    "Analyze what you've learned, identify gaps in your knowledge, " +
    "and decide what to investigate next. The output of this tool " +
    "is converted to reasoning tokens for the next cycle.",
  parameters: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description: "Your analysis of current findings and what's missing",
      },
      gaps: {
        type: "array",
        items: { type: "string" },
        description: "Specific knowledge gaps identified",
      },
      next_queries: {
        type: "array",
        items: { type: "string" },
        description: "Recommended sub-queries for the next research cycle",
      },
    },
    required: ["reasoning"],
  },
};

// ─── Generate Report Tool ────────────────────────────────────────────────────

export const GENERATE_REPORT_TOOL: AdapterTool = {
  name: "generate_report",
  description:
    "Signal that you have gathered enough information and are ready to " +
    "generate the final research report. Call this when you believe the " +
    "research is comprehensive enough to answer the original question, " +
    "or when you've exhausted useful avenues of investigation.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Brief summary of key findings to guide report generation",
      },
      key_themes: {
        type: "array",
        items: { type: "string" },
        description: "Main themes/topics the report should cover",
      },
    },
    required: ["summary"],
  },
};

// ─── All Tools ───────────────────────────────────────────────────────────────

export const DEEP_RESEARCH_TOOLS: AdapterTool[] = [
  RESEARCH_AGENT_TOOL,
  THINK_TOOL,
  GENERATE_REPORT_TOOL,
];

// ─── Orchestrator System Prompt ──────────────────────────────────────────────

export const ORCHESTRATOR_SYSTEM_PROMPT = `You are a deep research orchestrator. Your job is to thoroughly investigate a user's question by:

1. Breaking the question into focused sub-queries
2. Dispatching research agents to investigate each sub-query
3. Analyzing the results and identifying knowledge gaps
4. Iterating with additional research cycles until you have comprehensive coverage
5. Generating a well-structured final report with citations

You have three tools available:
- **research_agent**: Dispatch a sub-query to a research agent that searches web and knowledge bases
- **think**: Reason about your findings, identify gaps, and plan next steps
- **generate_report**: Signal you're ready to produce the final report

Strategy:
- Start broad, then narrow into specifics based on findings
- Use the think tool between cycles to assess progress
- Aim for comprehensive coverage, not just a single perspective
- When you have sufficient information (usually 2-5 cycles), call generate_report
- Always cite sources in your final report

Important:
- Be efficient — don't repeat searches for the same information
- If a sub-query returns poor results, try rephrasing rather than repeating
- Consider multiple perspectives and potential contradictions
- Call generate_report when additional cycles yield diminishing returns`;

export const REPORT_GENERATION_PROMPT = `Based on all the research gathered, generate a comprehensive, well-structured report that answers the original question.

Requirements:
- Use markdown formatting with clear headers and sections
- Include inline citations using [N] notation referencing the citation list
- Present multiple perspectives where relevant
- Highlight areas of uncertainty or conflicting information
- Include a "Sources" section at the end listing all citations
- Be thorough but concise — aim for clarity over length`;

export const CLARIFICATION_PROMPT = `Analyze the following research query and determine if it needs clarification or refinement.

If the query is clear and specific enough for research, return it unchanged.
If ambiguous, rephrase it to be more precise while preserving the user's intent.
If it covers multiple topics, identify the primary focus.

Return a JSON object:
{
  "refinedQuery": "the refined query",
  "isAmbiguous": true/false,
  "subTopics": ["identified sub-topics"],
  "suggestedFocus": "recommended primary focus"
}`;

export const PLANNING_PROMPT = `Create a research plan for the following query. Break it down into 3-7 focused sub-tasks that, when completed, will provide comprehensive coverage.

For each sub-task, provide:
- A specific sub-question to investigate
- Why this sub-task matters for answering the overall query
- Priority (1-10, higher = investigate first)

Return a JSON object:
{
  "strategy": "high-level research approach",
  "subTasks": [
    {
      "query": "specific sub-question",
      "rationale": "why this matters",
      "priority": 8
    }
  ]
}`;

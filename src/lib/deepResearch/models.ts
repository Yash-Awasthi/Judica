/**
 * Deep Research Models — modeled after Onyx's deep_research subsystem.
 *
 * Multi-cycle agentic research with:
 * - Clarification phase (refine ambiguous queries)
 * - Planning phase (break into research sub-tasks)
 * - Cyclic execution (max N cycles, timeout-bounded)
 * - Tool dispatch: research_agent, think_tool, generate_report
 * - Cross-cycle citation accumulation
 */

// ─── Configuration ───────────────────────────────────────────────────────────

export interface DeepResearchConfig {
  /** Maximum research cycles before forcing report generation. */
  maxCycles: number;
  /** Overall timeout in milliseconds. */
  timeoutMs: number;
  /** Max concurrent research agent dispatches per cycle. */
  maxParallelAgents: number;
  /** Max tokens per research agent sub-query. */
  agentMaxTokens: number;
  /** Whether to include a clarification phase. */
  enableClarification: boolean;
  /** Whether to include a planning phase. */
  enablePlanning: boolean;
  /** Model to use for the orchestrator. */
  orchestratorModel?: string;
  /** Model to use for research agents. */
  agentModel?: string;
}

export const DEFAULT_DEEP_RESEARCH_CONFIG: DeepResearchConfig = {
  maxCycles: 8,
  timeoutMs: 30 * 60 * 1000, // 30 minutes
  maxParallelAgents: 3,
  agentMaxTokens: 4096,
  enableClarification: true,
  enablePlanning: true,
};

// ─── Research Phases ─────────────────────────────────────────────────────────

export enum DeepResearchPhase {
  CLARIFICATION = "clarification",
  PLANNING = "planning",
  RESEARCHING = "researching",
  THINKING = "thinking",
  GENERATING_REPORT = "generating_report",
  COMPLETE = "complete",
  FAILED = "failed",
  TIMED_OUT = "timed_out",
}

// ─── Citation ────────────────────────────────────────────────────────────────

export interface Citation {
  id: string;
  /** Source title. */
  title: string;
  /** Source URL. */
  url: string;
  /** Relevant excerpt from the source. */
  excerpt: string;
  /** Which research cycle found this. */
  cycleIndex: number;
  /** Which sub-query produced this citation. */
  subQuery: string;
}

export interface CitationMapping {
  /** All citations accumulated across cycles, keyed by citation ID. */
  citations: Map<string, Citation>;
  /** Next citation number for sequential labeling. */
  nextId: number;
}

// ─── Research Plan ───────────────────────────────────────────────────────────

export interface ResearchSubTask {
  id: string;
  /** The sub-question to investigate. */
  query: string;
  /** Why this sub-task matters for the overall query. */
  rationale: string;
  /** Priority: higher = investigate first. */
  priority: number;
  status: "pending" | "in_progress" | "done" | "failed";
  /** Result from the research agent. */
  result?: ResearchAgentResult;
}

export interface ResearchPlan {
  /** Original user query. */
  originalQuery: string;
  /** Clarified/refined query (after clarification phase). */
  refinedQuery: string;
  /** Breakdown of sub-tasks. */
  subTasks: ResearchSubTask[];
  /** High-level research strategy. */
  strategy: string;
}

// ─── Cycle ───────────────────────────────────────────────────────────────────

export interface ResearchCycle {
  index: number;
  /** Sub-queries dispatched in this cycle. */
  subQueries: string[];
  /** Results from research agents. */
  agentResults: ResearchAgentResult[];
  /** Think tool reasoning (if used). */
  thinking?: string;
  /** New citations discovered in this cycle. */
  newCitations: Citation[];
  /** Orchestrator's assessment after this cycle. */
  assessment: string;
  /** Whether the orchestrator wants more cycles. */
  needsMoreResearch: boolean;
  startedAt: Date;
  completedAt?: Date;
}

// ─── Tool Results ────────────────────────────────────────────────────────────

export interface ResearchAgentResult {
  subQuery: string;
  /** Synthesized answer from the agent. */
  answer: string;
  /** Sources found by the agent. */
  sources: Array<{ title: string; url: string; content: string }>;
  /** Confidence level 0-1. */
  confidence: number;
  /** Tokens consumed. */
  tokensUsed: number;
}

export interface ThinkToolResult {
  /** The orchestrator's reasoning about what to do next. */
  reasoning: string;
  /** Identified gaps in current knowledge. */
  gaps: string[];
  /** Recommended next sub-queries. */
  nextQueries: string[];
}

// ─── Deep Research Session ───────────────────────────────────────────────────

export interface DeepResearchSession {
  id: string;
  userId: number;
  query: string;
  config: DeepResearchConfig;
  phase: DeepResearchPhase;
  plan?: ResearchPlan;
  cycles: ResearchCycle[];
  citations: CitationMapping;
  /** Final generated report (markdown). */
  report?: string;
  /** Total tokens consumed across all cycles. */
  totalTokens: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

// ─── SSE Events ──────────────────────────────────────────────────────────────

export type DeepResearchEvent =
  | { type: "phase_change"; phase: DeepResearchPhase }
  | { type: "plan_ready"; plan: ResearchPlan }
  | { type: "cycle_start"; cycleIndex: number; subQueries: string[] }
  | { type: "agent_result"; cycleIndex: number; result: ResearchAgentResult }
  | { type: "thinking"; reasoning: string }
  | { type: "cycle_complete"; cycle: ResearchCycle }
  | { type: "report_chunk"; text: string }
  | { type: "complete"; session: DeepResearchSession }
  | { type: "error"; message: string };

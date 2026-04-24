/**
 * Deep Research — barrel export.
 */

export { runDeepResearch } from "./loop.js";

export {
  DeepResearchPhase,
  DEFAULT_DEEP_RESEARCH_CONFIG,
} from "./models.js";

export type {
  DeepResearchConfig,
  DeepResearchSession,
  DeepResearchEvent,
  ResearchPlan,
  ResearchSubTask,
  ResearchCycle,
  ResearchAgentResult,
  ThinkToolResult,
  Citation,
  CitationMapping,
} from "./models.js";

export {
  DEEP_RESEARCH_TOOLS,
  ORCHESTRATOR_SYSTEM_PROMPT,
  REPORT_GENERATION_PROMPT,
} from "./tools.js";

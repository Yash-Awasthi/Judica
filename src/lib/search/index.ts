/**
 * Search — barrel export for ranking configuration.
 */

export {
  RankingProfile,
  PROFILE_ALPHA,
  DEFAULT_RANKING_OPTIONS,
  applyRecencyBias,
  applyFeedbackBoost,
  resolveHybridAlpha,
  weightedRRF,
} from "./rankingConfig.js";

export type { SearchRankingOptions } from "./rankingConfig.js";

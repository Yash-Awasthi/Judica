/**
 * Search Ranking Configuration — hybrid alpha, ranking profiles,
 * recency bias, and feedback boosting.
 *
 * Modeled after Onyx's configurable hybrid_alpha parameter and
 * multiple ranking profiles.
 */

// ─── Ranking Profiles ─────────────────────────────────────────────────────────

export enum RankingProfile {
  /** Default: balanced semantic + keyword (alpha=0.5). */
  HYBRID_SEMANTIC = "hybrid_semantic",
  /** Keyword-heavy: for exact-match queries (alpha=0.2). */
  HYBRID_KEYWORD = "hybrid_keyword",
  /** Title-weighted: for admin search / known-item search (alpha=0.3). */
  ADMIN_SEARCH = "admin_search",
  /** Pure semantic: for abstract/conceptual queries (alpha=1.0). */
  PURE_SEMANTIC = "pure_semantic",
  /** Pure keyword: for exact code/ID searches (alpha=0.0). */
  PURE_KEYWORD = "pure_keyword",
}

/** Alpha values per ranking profile: 0.0 = pure keyword, 1.0 = pure semantic. */
export const PROFILE_ALPHA: Record<RankingProfile, number> = {
  [RankingProfile.HYBRID_SEMANTIC]: 0.5,
  [RankingProfile.HYBRID_KEYWORD]: 0.2,
  [RankingProfile.ADMIN_SEARCH]: 0.3,
  [RankingProfile.PURE_SEMANTIC]: 1.0,
  [RankingProfile.PURE_KEYWORD]: 0.0,
};

// ─── Search Options ───────────────────────────────────────────────────────────

export interface SearchRankingOptions {
  /**
   * Hybrid alpha: 0.0 = pure keyword, 1.0 = pure semantic.
   * Overrides the profile's default alpha when set.
   */
  hybridAlpha?: number;

  /** Ranking profile to use. Default: HYBRID_SEMANTIC. */
  rankingProfile?: RankingProfile;

  /**
   * Recency bias multiplier: how much to boost recent documents.
   * 0.0 = no recency bias, 1.0 = strong recency bias.
   * Applied as exponential decay: score *= (1 + recencyBias * decay_factor)
   */
  recencyBiasMultiplier?: number;

  /**
   * User feedback boost: how much to boost documents with positive feedback.
   * Applied per-document based on stored boostFactor.
   */
  feedbackBoostWeight?: number;

  /** Title-to-content weight ratio for admin search. */
  titleWeight?: number;

  /** Whether to use HyDE for query expansion. */
  useHyde?: boolean;

  /** Number of results to retrieve from each search path before fusion. */
  retrievalMultiplier?: number;
}

export const DEFAULT_RANKING_OPTIONS: Required<SearchRankingOptions> = {
  hybridAlpha: 0.5,
  rankingProfile: RankingProfile.HYBRID_SEMANTIC,
  recencyBiasMultiplier: 0.1,
  feedbackBoostWeight: 0.05,
  titleWeight: 2.0,
  useHyde: false,
  retrievalMultiplier: 3,
};

// ─── Scoring Functions ────────────────────────────────────────────────────────

/**
 * Apply recency decay to a score. More recent documents get a boost.
 * Uses exponential decay with configurable half-life.
 */
export function applyRecencyBias(
  score: number,
  docTimestampSecs: number | undefined,
  recencyBias: number,
  halfLifeDays: number = 30,
): number {
  if (!docTimestampSecs || recencyBias <= 0) return score;

  const ageSeconds = (Date.now() / 1000) - docTimestampSecs;
  const ageDays = ageSeconds / 86400;
  const decayFactor = Math.exp(-0.693 * ageDays / halfLifeDays); // ln(2) = 0.693
  return score * (1 + recencyBias * decayFactor);
}

/**
 * Apply feedback boost to a score based on stored boost factor.
 * Positive boostFactor increases score; negative decreases.
 */
export function applyFeedbackBoost(
  score: number,
  boostFactor: number,
  feedbackWeight: number,
): number {
  if (boostFactor === 0 || feedbackWeight <= 0) return score;
  return score * (1 + feedbackWeight * boostFactor);
}

/**
 * Resolve the effective hybrid alpha from options.
 * Explicit hybridAlpha overrides the profile default.
 */
export function resolveHybridAlpha(options: SearchRankingOptions): number {
  if (options.hybridAlpha !== undefined) {
    return Math.max(0, Math.min(1, options.hybridAlpha));
  }
  const profile = options.rankingProfile ?? RankingProfile.HYBRID_SEMANTIC;
  return PROFILE_ALPHA[profile];
}

/**
 * Fuse vector and keyword scores using weighted Reciprocal Rank Fusion.
 * Alpha controls the blend: 0.0 = pure keyword, 1.0 = pure semantic.
 */
export function weightedRRF(
  vectorResults: Array<{ id: string; score: number; [key: string]: unknown }>,
  keywordResults: Array<{ id: string; score: number; [key: string]: unknown }>,
  alpha: number,
  k: number = 60,
): Array<{ id: string; score: number; [key: string]: unknown }> {
  const scoreMap = new Map<string, { item: Record<string, unknown>; rrfScore: number }>();

  // Semantic path weighted by alpha
  vectorResults.forEach((item, rank) => {
    const rrfContrib = alpha * (1 / (rank + 1 + k));
    const existing = scoreMap.get(item.id);
    if (existing) {
      existing.rrfScore += rrfContrib;
    } else {
      scoreMap.set(item.id, { item, rrfScore: rrfContrib });
    }
  });

  // Keyword path weighted by (1 - alpha)
  keywordResults.forEach((item, rank) => {
    const rrfContrib = (1 - alpha) * (1 / (rank + 1 + k));
    const existing = scoreMap.get(item.id);
    if (existing) {
      existing.rrfScore += rrfContrib;
    } else {
      scoreMap.set(item.id, { item, rrfScore: rrfContrib });
    }
  });

  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ item, rrfScore }) => ({ ...item, id: item.id as string, score: rrfScore }));
}

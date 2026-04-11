// ─── Router barrel export ────────────────────────────────────────────────────
export { route, routeAndCollect } from "./smartRouter.js";
export type { RouteOptions } from "./smartRouter.js";

export { canUse, recordUsage, getRemainingQuota, resetQuota, getAllQuotas } from "./quotaTracker.js";
export type { QuotaStatus } from "./quotaTracker.js";

export { checkRPM, recordRequest, getCurrentRPM } from "./rpmLimiter.js";

export { estimateTokens, estimateStringTokens } from "./tokenEstimator.js";

export {
  selectProvider,
  getChainEntry,
  FREE_TIER_CHAIN,
  PAID_CHAIN,
} from "./providerChain.js";
export type { ChainEntry } from "./providerChain.js";

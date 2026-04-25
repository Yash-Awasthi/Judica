/**
 * EE Search — enterprise search features.
 * Includes post-query censoring and advanced ranking.
 */

import { requireEE } from "../../config/edition.js";

/**
 * Post-query censoring: filters search results AFTER retrieval
 * based on verified permissions from external sources.
 * This is a second layer of ACL enforcement for external permission systems.
 */
export async function postQueryCensor(
  _results: Array<{ id: string; [key: string]: unknown }>,
  _userId: number,
  _connectorId: string,
): Promise<Array<{ id: string; [key: string]: unknown }>> {
  requireEE("Post-Query Censoring");
  return [];
}

/**
 * Enterprise ranking features: custom ranking models,
 * A/B testing of ranking profiles, analytics on search quality.
 */
export interface RankingExperiment {
  id: string;
  name: string;
  controlProfile: string;
  treatmentProfile: string;
  trafficSplit: number;
  startDate: Date;
  endDate?: Date;
}

export async function createRankingExperiment(
  _experiment: Omit<RankingExperiment, "id">,
): Promise<RankingExperiment> {
  requireEE("Ranking Experiments");
  throw new Error("Not yet implemented");
}

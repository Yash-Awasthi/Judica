import prisma from "../lib/db.js";
import logger from "../lib/logger.js";

/**
 * Update model reliability scores after a debate round.
 *
 * @param conflicts - pairs of agents that contradicted each other
 * @param concessions - agent IDs that conceded during debate
 * @param memberModels - map of memberId -> model name
 */
export async function updateReliability(
  conflicts: Array<{ agentA: string; agentB: string; modelA?: string; modelB?: string }>,
  concessions: string[],
  memberModels: Map<string, string>
): Promise<void> {
  try {
    // Collect all models involved
    const modelUpdates = new Map<
      string,
      { contradicted: number; agreedWith: number; totalResponses: number }
    >();

    const getOrInit = (model: string) => {
      if (!modelUpdates.has(model)) {
        modelUpdates.set(model, { contradicted: 0, agreedWith: 0, totalResponses: 1 });
      }
      return modelUpdates.get(model)!;
    };

    // For each conflict: increment contradicted for both models
    for (const conflict of conflicts) {
      const modelA = conflict.modelA || memberModels.get(conflict.agentA);
      const modelB = conflict.modelB || memberModels.get(conflict.agentB);
      if (modelA) getOrInit(modelA).contradicted++;
      if (modelB) getOrInit(modelB).contradicted++;
    }

    // For each concession: increment agreedWith for the conceding agent's model
    for (const agentId of concessions) {
      const model = memberModels.get(agentId);
      if (model) getOrInit(model).agreedWith++;
    }

    // Upsert each model's reliability
    for (const [model, deltas] of modelUpdates.entries()) {
      const existing = await prisma.modelReliability.findUnique({
        where: { model },
      });

      const totalResponses = (existing?.totalResponses ?? 0) + deltas.totalResponses;
      const agreedWith = (existing?.agreedWith ?? 0) + deltas.agreedWith;
      const contradicted = (existing?.contradicted ?? 0) + deltas.contradicted;
      const toolErrors = existing?.toolErrors ?? 0;

      // score = (agreedWith / (agreedWith + contradicted + 1)) * 0.7
      //       + (1 - toolErrors/(totalResponses+1)) * 0.3
      const agreementScore = agreedWith / (agreedWith + contradicted + 1);
      const errorScore = 1 - toolErrors / (totalResponses + 1);
      const avgConfidence = agreementScore * 0.7 + errorScore * 0.3;

      await prisma.modelReliability.upsert({
        where: { model },
        create: {
          model,
          totalResponses,
          agreedWith,
          contradicted,
          toolErrors,
          avgConfidence,
        },
        update: {
          totalResponses,
          agreedWith,
          contradicted,
          avgConfidence,
        },
      });
    }
  } catch (err) {
    logger.error({ err }, "Failed to update model reliability scores");
  }
}

/**
 * Load reliability scores for a set of models.
 */
export async function getReliabilityScores(
  models: string[]
): Promise<Map<string, { avgConfidence: number; totalResponses: number }>> {
  const result = new Map<string, { avgConfidence: number; totalResponses: number }>();
  if (models.length === 0) return result;

  const rows = await prisma.modelReliability.findMany({
    where: { model: { in: models } },
  });

  for (const row of rows) {
    result.set(row.model, {
      avgConfidence: row.avgConfidence,
      totalResponses: row.totalResponses,
    });
  }

  return result;
}

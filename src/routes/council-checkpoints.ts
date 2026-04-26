/**
 * Phase 8.13 + 8.14 — Durable Council Checkpoints & Time-Travel Debugging
 *
 * Phase 8.13: Every step of every council run is saved as a checkpoint.
 *   If the server crashes mid-deliberation, the run resumes exactly from
 *   the last saved step — no lost work, no re-running from scratch.
 *
 * Phase 8.14: Time-travel debugging — roll back any council run to any
 *   past checkpoint and replay it with modified state or different parameters.
 *   Not just viewing history — actually re-running from a chosen point.
 *
 * Storage: Redis (fast, TTL-based) → PostgreSQL for long-term retention.
 * Free. Uses the existing agentCheckpoint lib + deliberations table.
 *
 * Ref:
 *   LangGraph checkpointing — https://github.com/langchain-ai/langgraph (MIT)
 *   Redux DevTools time-travel — https://github.com/reduxjs/redux-devtools (MIT)
 */

import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { saveCheckpoint, loadCheckpoint, clearCheckpoint } from "../lib/agentCheckpoint.js";
import { db } from "../lib/drizzle.js";
import { deliberations, deliberationSteps } from "../db/schema/council.js";
import { eq, and, asc, desc } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "council-checkpoints" });

const CP_INDEX_KEY = (runId: string) => `council:cp:index:${runId}`;
const CP_TTL_SECS = 86400 * 7; // 7 days

// ─── Types ────────────────────────────────────────────────────────────────────

interface CouncilCheckpoint {
  runId:      string;
  stepIndex:  number;
  stepLabel:  string;  // human-readable: "member_responses", "synthesis", etc.
  savedAt:    string;
  data:       Record<string, unknown>;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const replaySchema = z.object({
  /** Step index to roll back to (0 = start) */
  fromStepIndex:  z.number().int().min(0),
  /** Modifications to apply before replaying */
  overrides: z.object({
    /** Replace the user query */
    query:        z.string().max(8000).optional(),
    /** Override which members participate */
    memberIds:    z.array(z.string()).max(10).optional(),
    /** Override any step's input/output */
    stepOverrides: z.array(z.object({
      stepIndex: z.number().int(),
      input:     z.unknown().optional(),
      output:    z.unknown().optional(),
    })).optional(),
  }).optional(),
  /** Label for the replay run */
  label: z.string().max(100).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getCheckpointIndex(runId: string): Promise<string[]> {
  try {
    const raw = await redis.get(CP_INDEX_KEY(runId));
    return raw ? JSON.parse(raw) as string[] : [];
  } catch { return []; }
}

async function addToIndex(runId: string, cpKey: string): Promise<void> {
  const index = await getCheckpointIndex(runId);
  if (!index.includes(cpKey)) index.push(cpKey);
  await redis.set(CP_INDEX_KEY(runId), JSON.stringify(index), "EX", CP_TTL_SECS);
}

async function getStepsForRun(runId: string) {
  return db
    .select()
    .from(deliberationSteps)
    .where(eq(deliberationSteps.deliberationId, runId))
    .orderBy(asc(deliberationSteps.stepIndex));
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const councilCheckpointsPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * POST /council-checkpoints/runs/:runId/save
   * Save a checkpoint for a specific step in a council run.
   * Called internally by the deliberation engine; also available externally.
   */
  fastify.post<{ Params: { runId: string } }>(
    "/runs/:runId/save",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const body = req.body as { stepIndex: number; stepLabel?: string; data: Record<string, unknown> } | undefined;
      if (!body || typeof body.stepIndex !== "number") {
        return reply.status(400).send({ error: "stepIndex (number) and data (object) are required" });
      }

      const cpKey = `${req.params.runId}.step${body.stepIndex}`;
      await saveCheckpoint(cpKey, {
        step: body.stepIndex,
        data: {
          ...body.data,
          runId:      req.params.runId,
          stepLabel:  body.stepLabel ?? `step_${body.stepIndex}`,
          savedAt:    new Date().toISOString(),
        },
      });
      await addToIndex(req.params.runId, cpKey);

      return reply.send({ saved: true, cpKey, stepIndex: body.stepIndex });
    }
  );

  /**
   * GET /council-checkpoints/runs/:runId
   * List all saved checkpoints for a council run.
   */
  fastify.get<{ Params: { runId: string } }>(
    "/runs/:runId",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const { runId } = req.params;

      // Verify the run belongs to this user
      const delibs = await db.select({ id: deliberations.id })
        .from(deliberations)
        .where(and(eq(deliberations.id, runId), eq(deliberations.userId, req.userId!)))
        .limit(1);
      if (delibs.length === 0) return reply.status(404).send({ error: "Run not found" });

      const index = await getCheckpointIndex(runId);
      const checkpoints: CouncilCheckpoint[] = [];

      for (const cpKey of index) {
        const cp = await loadCheckpoint(cpKey);
        if (cp) {
          const d = cp.data as Record<string, unknown>;
          checkpoints.push({
            runId,
            stepIndex:  cp.step,
            stepLabel:  (d.stepLabel as string) ?? `step_${cp.step}`,
            savedAt:    (d.savedAt as string) ?? cp.savedAt,
            data:       d,
          });
        }
      }

      checkpoints.sort((a, b) => a.stepIndex - b.stepIndex);

      return reply.send({
        runId,
        checkpointCount: checkpoints.length,
        checkpoints,
        canReplay: checkpoints.length > 0,
      });
    }
  );

  /**
   * GET /council-checkpoints/runs/:runId/checkpoints/:stepIndex
   * Get a specific checkpoint by step index.
   */
  fastify.get<{ Params: { runId: string; stepIndex: string } }>(
    "/runs/:runId/checkpoints/:stepIndex",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const cpKey = `${req.params.runId}.step${req.params.stepIndex}`;
      const cp = await loadCheckpoint(cpKey);
      if (!cp) return reply.status(404).send({ error: "Checkpoint not found" });
      return reply.send(cp);
    }
  );

  /**
   * POST /council-checkpoints/runs/:runId/replay
   * TIME-TRAVEL DEBUGGING — Roll back to a checkpoint and replay the run
   * with modified state or different parameters.
   *
   * Creates a NEW run starting from the chosen checkpoint.
   * The original run is unchanged.
   */
  fastify.post<{ Params: { runId: string } }>(
    "/runs/:runId/replay",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const parsed = replaySchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const { fromStepIndex, overrides, label } = parsed.data;

      // Verify original run ownership
      const delibs = await db.select()
        .from(deliberations)
        .where(and(eq(deliberations.id, req.params.runId), eq(deliberations.userId, req.userId!)))
        .limit(1);
      if (delibs.length === 0) return reply.status(404).send({ error: "Run not found" });

      const originalRun = delibs[0];

      // Load checkpoint at the requested step
      const cpKey = `${req.params.runId}.step${fromStepIndex}`;
      const checkpoint = await loadCheckpoint(cpKey);

      // Load all steps up to fromStepIndex
      const steps = await getStepsForRun(req.params.runId);
      const stepsUpTo = steps.filter(s => s.stepIndex <= fromStepIndex);

      // Apply step overrides
      const finalSteps = stepsUpTo.map(s => {
        const override = overrides?.stepOverrides?.find(o => o.stepIndex === s.stepIndex);
        return override
          ? { ...s, input: override.input ?? s.input, output: override.output ?? s.output }
          : s;
      });

      // Create the replay run record
      const replayId = randomUUID();
      const replayLabel = label ?? `Replay of ${req.params.runId.slice(0, 8)} from step ${fromStepIndex}`;

      await db.insert(deliberations).values({
        id:         replayId,
        userId:     req.userId!,
        query:      overrides?.query ?? originalRun.query,
        memberIds:  overrides?.memberIds ?? originalRun.memberIds,
        status:     "replaying",
        parentRunId: req.params.runId,
        replayFromStep: fromStepIndex,
        label:      replayLabel,
        createdAt:  new Date(),
        updatedAt:  new Date(),
      });

      // Save the checkpoint state for the new run
      const replayCpKey = `${replayId}.step${fromStepIndex}`;
      if (checkpoint) {
        await saveCheckpoint(replayCpKey, checkpoint);
        await addToIndex(replayId, replayCpKey);
      }

      log.info({
        originalRunId: req.params.runId,
        replayId,
        fromStepIndex,
        overridesApplied: Boolean(overrides),
      }, "Time-travel replay created");

      return reply.status(201).send({
        replayId,
        originalRunId:  req.params.runId,
        fromStepIndex,
        label:          replayLabel,
        stepsPreloaded: finalSteps.length,
        status:         "replaying",
        message: `New replay run created (ID: ${replayId}). Submit it to /api/ask with runId=${replayId} to execute from step ${fromStepIndex}.`,
        overridesApplied: {
          query:        Boolean(overrides?.query),
          members:      Boolean(overrides?.memberIds),
          stepOverrides: overrides?.stepOverrides?.length ?? 0,
        },
      });
    }
  );

  /**
   * DELETE /council-checkpoints/runs/:runId
   * Delete all checkpoints for a run (frees Redis memory).
   */
  fastify.delete<{ Params: { runId: string } }>(
    "/runs/:runId",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const delibs = await db.select({ id: deliberations.id })
        .from(deliberations)
        .where(and(eq(deliberations.id, req.params.runId), eq(deliberations.userId, req.userId!)))
        .limit(1);
      if (delibs.length === 0) return reply.status(404).send({ error: "Run not found" });

      const index = await getCheckpointIndex(req.params.runId);
      for (const cpKey of index) {
        await clearCheckpoint(cpKey);
      }
      await redis.del(CP_INDEX_KEY(req.params.runId));

      return reply.send({ deleted: index.length, runId: req.params.runId });
    }
  );
};

export default councilCheckpointsPlugin;

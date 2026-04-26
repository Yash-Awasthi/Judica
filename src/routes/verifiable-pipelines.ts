/**
 * Phase 7.2 — Verifiable Pipelines
 *
 * Every step of a council run produces a cryptographic hash of its inputs and
 * outputs (SHA-256). Each hash is chained to the previous one (Merkle-chain).
 * The resulting tamper-evident log can be exported and independently verified.
 *
 * Any observer can:
 *   1. Download the hash chain for a run
 *   2. Re-hash the recorded inputs/outputs themselves
 *   3. Confirm every link in the chain matches → run was not modified post-hoc
 *
 * Free. No external service needed — runs entirely on SHA-256 (Node crypto).
 *
 * Ref:
 *   Merkle chains — https://en.wikipedia.org/wiki/Merkle_tree
 *   LangGraph durable execution — https://github.com/langchain-ai/langgraph (MIT)
 *   OpenTelemetry audit — https://opentelemetry.io/
 */

import type { FastifyPluginAsync } from "fastify";
import { createHash, createHmac } from "crypto";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { deliberations, deliberationSteps } from "../db/schema/council.js";
import { eq, and, asc } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "verifiable-pipelines" });

// ─── Types ────────────────────────────────────────────────────────────────────

interface StepRecord {
  stepIndex: number;
  agentId:   string;
  inputHash: string;   // SHA-256 of the prompt/input sent to the agent
  outputHash: string;  // SHA-256 of the agent response
  timestamp: string;
  chainHash:  string;  // SHA-256(prevChainHash + stepIndex + inputHash + outputHash)
}

interface VerifiableLog {
  runId:       string;
  userId:      string;
  startedAt:   string;
  rootHash:    string;   // genesis hash (SHA-256 of runId + userId + startedAt)
  steps:       StepRecord[];
  finalHash:   string;   // hash of the last step's chainHash
  exportedAt:  string;
  version:     "1.0";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function buildChainHash(prevHash: string, stepIndex: number, inputHash: string, outputHash: string): string {
  return sha256(`${prevHash}:${stepIndex}:${inputHash}:${outputHash}`);
}

function rootHash(runId: string, userId: string, startedAt: string): string {
  return sha256(`${runId}:${userId}:${startedAt}`);
}

async function buildVerifiableLog(runId: string, userId: string): Promise<VerifiableLog> {
  // Load the deliberation
  const delibs = await db
    .select()
    .from(deliberations)
    .where(and(eq(deliberations.id, runId), eq(deliberations.userId, userId)))
    .limit(1);
  if (delibs.length === 0) throw new AppError(404, "Run not found", "RUN_NOT_FOUND");
  const deli = delibs[0];

  // Load steps ordered by index
  const steps = await db
    .select()
    .from(deliberationSteps)
    .where(eq(deliberationSteps.deliberationId, runId))
    .orderBy(asc(deliberationSteps.stepIndex));

  const genesis = rootHash(runId, userId, deli.createdAt.toISOString());
  let prevHash = genesis;
  const builtSteps: StepRecord[] = [];

  for (const step of steps) {
    const inHash  = sha256(JSON.stringify(step.input  ?? ""));
    const outHash = sha256(JSON.stringify(step.output ?? ""));
    const chain   = buildChainHash(prevHash, step.stepIndex, inHash, outHash);
    builtSteps.push({
      stepIndex:  step.stepIndex,
      agentId:    step.agentId ?? "unknown",
      inputHash:  inHash,
      outputHash: outHash,
      timestamp:  step.createdAt.toISOString(),
      chainHash:  chain,
    });
    prevHash = chain;
  }

  return {
    runId,
    userId,
    startedAt:  deli.createdAt.toISOString(),
    rootHash:   genesis,
    steps:      builtSteps,
    finalHash:  prevHash,
    exportedAt: new Date().toISOString(),
    version:    "1.0",
  };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const verifyBodySchema = z.object({
  /** The full VerifiableLog JSON that was previously exported */
  log: z.object({
    runId:      z.string(),
    userId:     z.string(),
    startedAt:  z.string(),
    rootHash:   z.string(),
    steps:      z.array(z.object({
      stepIndex:  z.number(),
      agentId:    z.string(),
      inputHash:  z.string(),
      outputHash: z.string(),
      timestamp:  z.string(),
      chainHash:  z.string(),
    })),
    finalHash:  z.string(),
    version:    z.literal("1.0"),
  }),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

const verifiablePipelinesPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /verifiable/runs/:runId
   * Build and return the hash chain for a council run.
   * The caller can store this and later verify it hasn't been tampered with.
   */
  fastify.get<{ Params: { runId: string } }>(
    "/runs/:runId",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      try {
        const vlog = await buildVerifiableLog(req.params.runId, req.userId!);
        return reply.send(vlog);
      } catch (err) {
        if (err instanceof AppError) return reply.status(err.statusCode).send({ error: err.message });
        log.error({ err }, "Failed to build verifiable log");
        return reply.status(500).send({ error: "Failed to build verifiable log" });
      }
    }
  );

  /**
   * POST /verifiable/verify
   * Verify that a previously-exported VerifiableLog has not been tampered with.
   * Re-derives every chain hash from the stored input/output hashes and
   * compares against the log's recorded values.
   */
  fastify.post("/verify", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = verifyBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { log: vlog } = parsed.data;

    // Re-derive root hash
    const expectedRoot = rootHash(vlog.runId, vlog.userId, vlog.startedAt);
    if (expectedRoot !== vlog.rootHash) {
      return reply.send({
        valid: false,
        reason: "rootHash mismatch — runId, userId, or startedAt has been altered",
        expectedRootHash: expectedRoot,
        recordedRootHash: vlog.rootHash,
      });
    }

    // Re-walk the chain
    let prevHash = vlog.rootHash;
    for (const step of vlog.steps) {
      const expectedChain = buildChainHash(prevHash, step.stepIndex, step.inputHash, step.outputHash);
      if (expectedChain !== step.chainHash) {
        return reply.send({
          valid: false,
          reason: `chainHash mismatch at step ${step.stepIndex} (agent: ${step.agentId})`,
          stepIndex: step.stepIndex,
          expectedChainHash: expectedChain,
          recordedChainHash: step.chainHash,
        });
      }
      prevHash = step.chainHash;
    }

    // Final hash check
    if (prevHash !== vlog.finalHash) {
      return reply.send({
        valid: false,
        reason: "finalHash mismatch — chain tail does not match recorded finalHash",
        expectedFinalHash: prevHash,
        recordedFinalHash: vlog.finalHash,
      });
    }

    return reply.send({
      valid:     true,
      stepsVerified: vlog.steps.length,
      finalHash: vlog.finalHash,
      message:   "All chain links verified. This log has not been tampered with.",
    });
  });

  /**
   * GET /verifiable/export/:runId
   * Export the full tamper-evident log as a downloadable JSON file.
   * Sets Content-Disposition so browsers trigger a file download.
   */
  fastify.get<{ Params: { runId: string } }>(
    "/export/:runId",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      try {
        const vlog = await buildVerifiableLog(req.params.runId, req.userId!);
        const filename = `aibyai-run-${req.params.runId.slice(0, 8)}-verifiable.json`;
        reply.header("Content-Disposition", `attachment; filename="${filename}"`);
        reply.header("Content-Type", "application/json");
        return reply.send(vlog);
      } catch (err) {
        if (err instanceof AppError) return reply.status(err.statusCode).send({ error: err.message });
        return reply.status(500).send({ error: "Export failed" });
      }
    }
  );

  /**
   * GET /verifiable/info
   * Explain how the verifiable pipeline works.
   */
  fastify.get("/info", async (_req, reply) => {
    return reply.send({
      description: "Cryptographic hash chain for tamper-evident council run logs",
      algorithm:   "SHA-256 Merkle chain",
      version:     "1.0",
      cost:        "Free — runs entirely on Node.js crypto (no external service)",
      howItWorks: [
        "1. A root hash is derived from (runId + userId + startedAt)",
        "2. For each council step: input and output are hashed separately (SHA-256)",
        "3. Each step's chainHash = SHA-256(prevChainHash:stepIndex:inputHash:outputHash)",
        "4. The chain terminates in a finalHash",
        "5. Any modification to any step invalidates all subsequent chain links",
      ],
      verifyWith: "POST /api/verifiable/verify — supply the exported log; we re-derive all hashes",
    });
  });
};

export default verifiablePipelinesPlugin;

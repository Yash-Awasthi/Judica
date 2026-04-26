/**
 * Interrupt-Modify-Resume — Phase 7.18
 *
 * Routes:
 *   POST   /imr/runs              — Create a new deliberation run
 *   GET    /imr/runs              — List recent runs for the user
 *   GET    /imr/runs/:id          — Get a specific run
 *   POST   /imr/runs/:id/interrupt — Interrupt a running deliberation
 *   PATCH  /imr/runs/:id/modify   — Apply a modification to an interrupted run
 *   POST   /imr/runs/:id/resume   — Resume an interrupted run
 *   DELETE /imr/runs/:id          — Cancel a run
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createRun,
  interruptRun,
  modifyRun,
  resumeRun,
  cancelRun,
  getRun,
  listRuns,
} from "../lib/interruptResume.js";

const createSchema = z.object({
  question: z.string().min(1).max(10_000),
});

const modifySchema = z.object({
  modification: z.string().min(1).max(5_000),
});

const resumeSchema = z.object({
  questionOverride: z.string().max(10_000).optional(),
});

export async function interruptResumePlugin(app: FastifyInstance) {

  app.post("/imr/runs", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const run = await createRun(userId, parsed.data.question);
    return { success: true, run };
  });

  app.get("/imr/runs", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const runs = await listRuns(userId, 20);
    return { success: true, count: runs.length, runs };
  });

  app.get("/imr/runs/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const run = await getRun(userId, id);
    if (!run) return reply.status(404).send({ error: "Run not found" });
    return { success: true, run };
  });

  app.post("/imr/runs/:id/interrupt", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    try {
      const run = await interruptRun(userId, id);
      if (!run) return reply.status(404).send({ error: "Run not found" });
      return { success: true, run };
    } catch (err) {
      return reply.status(409).send({ error: (err as Error).message });
    }
  });

  app.patch("/imr/runs/:id/modify", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const parsed = modifySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      const run = await modifyRun(userId, id, parsed.data.modification);
      if (!run) return reply.status(404).send({ error: "Run not found" });
      return { success: true, run };
    } catch (err) {
      return reply.status(409).send({ error: (err as Error).message });
    }
  });

  app.post("/imr/runs/:id/resume", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const parsed = resumeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      const run = await resumeRun(userId, id, parsed.data.questionOverride);
      if (!run) return reply.status(404).send({ error: "Run not found" });
      return { success: true, run };
    } catch (err) {
      return reply.status(409).send({ error: (err as Error).message });
    }
  });

  app.delete("/imr/runs/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const run = await cancelRun(userId, id);
    if (!run) return reply.status(404).send({ error: "Run not found" });
    return { success: true, run };
  });
}

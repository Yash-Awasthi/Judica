import { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { researchJobs } from "../db/schema/research.js";
import { eq, and, desc, count } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { runResearch } from "../services/research.service.js";
import { randomUUID } from "crypto";
import logger from "../lib/logger.js";

/**
 * @openapi
 * /api/research:
 *   post:
 *     summary: Start a new research job
 *     description: Creates a new research job for the authenticated user and begins processing it asynchronously. Each user may have at most 2 concurrent running jobs.
 *     tags:
 *       - Research
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 maxLength: 2000
 *                 description: The research query to investigate
 *     responses:
 *       201:
 *         description: Research job created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 status:
 *                   type: string
 *                   example: pending
 *                 query:
 *                   type: string
 *       400:
 *         description: Invalid or missing query
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Maximum concurrent research jobs reached
 */
const researchPlugin: FastifyPluginAsync = async (fastify) => {
  // POST /api/research — start research job
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { query } = request.body as { query?: string };
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      throw new AppError(400, "Query is required", "RESEARCH_QUERY_REQUIRED");
    }
    if (query.length > 2000) {
      throw new AppError(400, "Query too long (max 2000 chars)", "RESEARCH_QUERY_TOO_LONG");
    }

    const userId = request.userId!;

    // Check for running jobs (limit 2 concurrent per user)
    const [runningCount] = await db
      .select({ value: count() })
      .from(researchJobs)
      .where(and(eq(researchJobs.userId, userId), eq(researchJobs.status, "running")));

    if (runningCount.value >= 2) {
      throw new AppError(429, "Maximum 2 concurrent research jobs", "RESEARCH_LIMIT");
    }

    const now = new Date();
    const [job] = await db
      .insert(researchJobs)
      .values({
        id: randomUUID(),
        userId,
        query: query.trim(),
        updatedAt: now,
      })
      .returning();

    // Run research async
    runResearch(job.id, userId, query.trim()).catch((err) => {
      logger.error({ err, jobId: job.id }, "Research job failed");
    });

    reply.code(201);
    return { id: job.id, status: "pending", query: query.trim() };
  });

  /**
   * @openapi
   * /api/research:
   *   get:
   *     summary: List research jobs
   *     description: Returns the 20 most recent research jobs for the authenticated user, ordered by creation date descending.
   *     tags:
   *       - Research
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of research jobs
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 jobs:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       query:
   *                         type: string
   *                       status:
   *                         type: string
   *                         enum: [pending, running, done, failed]
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *                       updatedAt:
   *                         type: string
   *                         format: date-time
   *       401:
   *         description: Unauthorized
   */
  // GET /api/research — list user's jobs
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request) => {
    const jobs = await db
      .select({
        id: researchJobs.id,
        query: researchJobs.query,
        status: researchJobs.status,
        createdAt: researchJobs.createdAt,
        updatedAt: researchJobs.updatedAt,
      })
      .from(researchJobs)
      .where(eq(researchJobs.userId, request.userId!))
      .orderBy(desc(researchJobs.createdAt))
      .limit(20);

    return { jobs };
  });

  /**
   * @openapi
   * /api/research/{id}:
   *   get:
   *     summary: Get research job detail
   *     description: Returns the full detail of a specific research job owned by the authenticated user.
   *     tags:
   *       - Research
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The research job ID
   *     responses:
   *       200:
   *         description: Research job details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                 query:
   *                   type: string
   *                 status:
   *                   type: string
   *                   enum: [pending, running, done, failed]
   *                 report:
   *                   type: string
   *                   nullable: true
   *                 steps:
   *                   type: array
   *                   nullable: true
   *                   items:
   *                     type: object
   *                 createdAt:
   *                   type: string
   *                   format: date-time
   *                 updatedAt:
   *                   type: string
   *                   format: date-time
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Research job not found
   */
  // GET /api/research/:id — get job detail
  fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };

    const [job] = await db
      .select()
      .from(researchJobs)
      .where(and(eq(researchJobs.id, id), eq(researchJobs.userId, request.userId!)))
      .limit(1);

    if (!job) throw new AppError(404, "Research job not found", "RESEARCH_NOT_FOUND");
    return job;
  });

  /**
   * @openapi
   * /api/research/{id}/stream:
   *   get:
   *     summary: Stream research job updates via SSE
   *     description: Opens a Server-Sent Events connection to stream real-time progress updates for a research job. If the job is already complete, the report or error is sent immediately and the stream closes. For pending or running jobs, updates are polled every 2 seconds.
   *     tags:
   *       - Research
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The research job ID
   *     responses:
   *       200:
   *         description: SSE stream of research job events
   *         content:
   *           text/event-stream:
   *             schema:
   *               type: string
   *               description: "Server-Sent Events stream. Event types: step_complete, report_ready, error, done."
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Research job not found
   */
  // GET /api/research/:id/stream — SSE streaming
  fastify.get("/:id/stream", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [job] = await db
      .select()
      .from(researchJobs)
      .where(and(eq(researchJobs.id, id), eq(researchJobs.userId, request.userId!)))
      .limit(1);

    if (!job) throw new AppError(404, "Research job not found", "RESEARCH_NOT_FOUND");

    // If already done, send report immediately
    if (job.status === "done" || job.status === "failed") {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      if (job.status === "done") {
        reply.raw.write(`data: ${JSON.stringify({ type: "report_ready", report: job.report })}\n\n`);
      } else {
        reply.raw.write(`data: ${JSON.stringify({ type: "error", message: "Research failed" })}\n\n`);
      }
      reply.raw.write(`data: ${JSON.stringify({ type: "done", jobId: job.id })}\n\n`);
      reply.raw.end();
      return;
    }

    // For pending/running jobs, poll and stream updates
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let lastStepCount = 0;
    const interval = setInterval(async () => {
      try {
        const [current] = await db
          .select()
          .from(researchJobs)
          .where(eq(researchJobs.id, job.id))
          .limit(1);

        if (!current) {
          clearInterval(interval);
          reply.raw.end();
          return;
        }

        const steps = (current.steps as any[]) || [];
        // Send new completed steps
        for (let i = lastStepCount; i < steps.length; i++) {
          if (steps[i].status === "done") {
            reply.raw.write(`data: ${JSON.stringify({
              type: "step_complete",
              stepIndex: i,
              question: steps[i].question,
              answer: steps[i].answer,
            })}\n\n`);
            lastStepCount = i + 1;
          }
        }

        if (current.status === "done") {
          reply.raw.write(`data: ${JSON.stringify({ type: "report_ready", report: current.report })}\n\n`);
          reply.raw.write(`data: ${JSON.stringify({ type: "done", jobId: current.id })}\n\n`);
          clearInterval(interval);
          reply.raw.end();
        } else if (current.status === "failed") {
          reply.raw.write(`data: ${JSON.stringify({ type: "error", message: "Research failed" })}\n\n`);
          clearInterval(interval);
          reply.raw.end();
        }
      } catch (err) {
        logger.error({ err }, "Research stream poll error");
      }
    }, 2000);

    request.raw.on("close", () => clearInterval(interval));
  });

  /**
   * @openapi
   * /api/research/{id}:
   *   delete:
   *     summary: Delete a research job
   *     description: Permanently deletes a research job owned by the authenticated user.
   *     tags:
   *       - Research
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The research job ID
   *     responses:
   *       200:
   *         description: Job deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Research job not found
   */
  // DELETE /api/research/:id — delete job
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };

    const [job] = await db
      .select()
      .from(researchJobs)
      .where(and(eq(researchJobs.id, id), eq(researchJobs.userId, request.userId!)))
      .limit(1);

    if (!job) throw new AppError(404, "Research job not found", "RESEARCH_NOT_FOUND");

    await db.delete(researchJobs).where(eq(researchJobs.id, job.id));
    return { success: true };
  });
};

export default researchPlugin;

import { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { codeRepositories } from "../db/schema/repos.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { searchRepo } from "../services/repoSearch.service.js";
import { repoQueue } from "../queue/queues.js";
import logger from "../lib/logger.js";

/**
 * @openapi
 * /api/repos:
 *   get:
 *     tags:
 *       - Repositories
 *     summary: List user's repositories
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of repositories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       source:
 *                         type: string
 *                       repoUrl:
 *                         type: string
 *                       name:
 *                         type: string
 *                       indexed:
 *                         type: boolean
 *                       fileCount:
 *                         type: integer
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 */
const reposPlugin: FastifyPluginAsync = async (fastify) => {
  // GET / — list user's repos
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request) => {
    const userId = String(request.userId);
    const repos = await db
      .select({
        id: codeRepositories.id,
        source: codeRepositories.source,
        repoUrl: codeRepositories.repoUrl,
        name: codeRepositories.name,
        indexed: codeRepositories.indexed,
        fileCount: codeRepositories.fileCount,
        createdAt: codeRepositories.createdAt,
      })
      .from(codeRepositories)
      .where(eq(codeRepositories.userId, userId))
      .orderBy(desc(codeRepositories.createdAt));

    return { data: repos };
  });

  /**
   * @openapi
   * /api/repos/github:
   *   post:
   *     tags:
   *       - Repositories
   *     summary: Start GitHub repository ingestion
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - owner
   *               - repo
   *             properties:
   *               owner:
   *                 type: string
   *                 description: GitHub repository owner
   *               repo:
   *                 type: string
   *                 description: GitHub repository name
   *     responses:
   *       202:
   *         description: Ingestion queued
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                 owner:
   *                   type: string
   *                 repo:
   *                   type: string
   *       400:
   *         description: Missing owner or repo
   *       401:
   *         description: Unauthorized
   */
  // POST /github — start ingestion
  fastify.post("/github", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = String(request.userId);
    const { owner, repo } = request.body as { owner?: string; repo?: string };

    if (!owner || !repo) {
      reply.code(400);
      return { error: "owner and repo are required" };
    }

    // Queue the ingestion via BullMQ
    await repoQueue.add("ingest", { userId, owner: owner.trim(), repo: repo.trim() });

    reply.code(202);
    return { message: "Ingestion queued", owner, repo };
  });

  /**
   * @openapi
   * /api/repos/{id}/status:
   *   get:
   *     tags:
   *       - Repositories
   *     summary: Get repository indexing status
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     responses:
   *       200:
   *         description: Repository status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 indexed:
   *                   type: boolean
   *                 fileCount:
   *                   type: integer
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Repository not found
   */
  // GET /:id/status — return indexed status
  fastify.get("/:id/status", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = String(request.userId);
    const { id } = request.params as { id: string };

    const [repoRecord] = await db
      .select({
        indexed: codeRepositories.indexed,
        fileCount: codeRepositories.fileCount,
      })
      .from(codeRepositories)
      .where(and(eq(codeRepositories.id, id), eq(codeRepositories.userId, userId)))
      .limit(1);

    if (!repoRecord) {
      reply.code(404);
      return { error: "Repository not found" };
    }

    return repoRecord;
  });

  /**
   * @openapi
   * /api/repos/{id}/search:
   *   post:
   *     tags:
   *       - Repositories
   *     summary: Search repository files
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
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
   *                 description: Search query
   *     responses:
   *       200:
   *         description: Search results
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items:
   *                     type: object
   *       400:
   *         description: Missing query
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Repository not found
   */
  // POST /:id/search — search repo files
  fastify.post("/:id/search", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = String(request.userId);
    const { id } = request.params as { id: string };
    const { query } = request.body as { query?: string };

    if (!query) {
      reply.code(400);
      return { error: "query is required" };
    }

    const [repoRecord] = await db
      .select()
      .from(codeRepositories)
      .where(and(eq(codeRepositories.id, id), eq(codeRepositories.userId, userId)))
      .limit(1);

    if (!repoRecord) {
      reply.code(404);
      return { error: "Repository not found" };
    }

    const results = await searchRepo(id, query);
    return { data: results };
  });

  /**
   * @openapi
   * /api/repos/{id}:
   *   delete:
   *     tags:
   *       - Repositories
   *     summary: Delete a repository and cascade files
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     responses:
   *       200:
   *         description: Repository deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Repository not found
   */
  // DELETE /:id — delete repo + cascade files
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = String(request.userId);
    const { id } = request.params as { id: string };

    const [repoRecord] = await db
      .select()
      .from(codeRepositories)
      .where(and(eq(codeRepositories.id, id), eq(codeRepositories.userId, userId)))
      .limit(1);

    if (!repoRecord) {
      reply.code(404);
      return { error: "Repository not found" };
    }

    await db.delete(codeRepositories).where(eq(codeRepositories.id, id));
    return { message: "Repository deleted" };
  });
};

export default reposPlugin;

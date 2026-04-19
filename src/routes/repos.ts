import { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { codeRepositories } from "../db/schema/repos.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { searchRepo } from "../services/repoSearch.service.js";
import { repoQueue } from "../queue/queues.js";

const reposPlugin: FastifyPluginAsync = async (fastify) => {
  // GET / — list user's repos
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request) => {
    const userId = request.userId!;
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

    // POST /github — start ingestion
  fastify.post("/github", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = request.userId!;
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

    // GET /:id/status — return indexed status
  fastify.get("/:id/status", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = request.userId!;
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

    // POST /:id/search — search repo files
  fastify.post("/:id/search", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = request.userId!;
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

    // DELETE /:id — delete repo + cascade files
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = request.userId!;
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

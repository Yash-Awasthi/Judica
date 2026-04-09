import { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { traces } from "../db/schema/traces.js";
import { eq, and, gte, lte, count, desc, type SQL } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";

const tracesPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /api/traces:
   *   get:
   *     tags:
   *       - Analytics
   *     summary: List traces with filtering and pagination
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *         description: Filter by trace type
   *       - in: query
   *         name: date_from
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Start date filter
   *       - in: query
   *         name: date_to
   *         schema:
   *           type: string
   *           format: date-time
   *         description: End date filter
   *       - in: query
   *         name: conversation_id
   *         schema:
   *           type: string
   *         description: Filter by conversation ID
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *         description: Page number
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *           maximum: 100
   *         description: Items per page
   *     responses:
   *       200:
   *         description: Paginated list of traces
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 traces:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       conversationId:
   *                         type: string
   *                       workflowRunId:
   *                         type: string
   *                       type:
   *                         type: string
   *                       totalLatencyMs:
   *                         type: number
   *                       totalTokens:
   *                         type: integer
   *                       totalCostUsd:
   *                         type: number
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *                 total:
   *                   type: integer
   *                 page:
   *                   type: integer
   *                 limit:
   *                   type: integer
   *                 pages:
   *                   type: integer
   *       401:
   *         description: Unauthorized
   */
  fastify.get(
    "/",
    { preHandler: fastifyRequireAuth },
    async (request) => {
      const userId = (request as any).userId!;
      const {
        type,
        date_from,
        date_to,
        conversation_id,
        page = "1",
        limit = "20",
      } = request.query as Record<string, string | undefined>;

      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

      const conditions: SQL[] = [eq(traces.userId, userId)];

      if (type) conditions.push(eq(traces.type, type));
      if (conversation_id) conditions.push(eq(traces.conversationId, conversation_id));
      if (date_from) conditions.push(gte(traces.createdAt, new Date(date_from)));
      if (date_to) conditions.push(lte(traces.createdAt, new Date(date_to)));

      const whereClause = and(...conditions);

      const [traceRows, countResult] = await Promise.all([
        db
          .select({
            id: traces.id,
            conversationId: traces.conversationId,
            workflowRunId: traces.workflowRunId,
            type: traces.type,
            totalLatencyMs: traces.totalLatencyMs,
            totalTokens: traces.totalTokens,
            totalCostUsd: traces.totalCostUsd,
            createdAt: traces.createdAt,
          })
          .from(traces)
          .where(whereClause)
          .orderBy(desc(traces.createdAt))
          .offset((pageNum - 1) * limitNum)
          .limit(limitNum),
        db
          .select({ value: count() })
          .from(traces)
          .where(whereClause),
      ]);

      const total = countResult[0]?.value ?? 0;

      return {
        traces: traceRows,
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      };
    },
  );

  /**
   * @openapi
   * /api/traces/{id}:
   *   get:
   *     tags:
   *       - Analytics
   *     summary: Get trace detail by ID
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Trace ID
   *     responses:
   *       200:
   *         description: Trace detail
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Trace not found
   */
  fastify.get(
    "/:id",
    { preHandler: fastifyRequireAuth },
    async (request, reply) => {
      const userId = (request as any).userId!;
      const { id } = request.params as { id: string };

      const [trace] = await db
        .select()
        .from(traces)
        .where(and(eq(traces.id, id), eq(traces.userId, userId)))
        .limit(1);

      if (!trace) {
        return reply.status(404).send({ error: "Trace not found" });
      }

      return trace;
    },
  );
};

export { tracesPlugin };
export default tracesPlugin;

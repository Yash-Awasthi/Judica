import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { askCouncil } from "../lib/council.js";
import { Message } from "../lib/providers.js";
import logger from "../lib/logger.js";
import { fastifyOptionalAuth } from "../middleware/fastifyAuth.js";
import { askSchema } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";
import { getCachedResponse, setCachedResponse } from "../lib/cache.js";
import { prepareCouncilMembers as prepareCouncilWithArchetypes, streamCouncil } from "../lib/council.js";
import { env } from "../config/env.js";
import {
  createConversation,
  findConversationById,
  createChat,
  getRecentHistory,
  retrieveRelevantContext,
  formatContextForInjection
} from "../services/conversationService.js";
import { updateDailyUsage } from "../services/usageService.js";
import { classifyQuery, formatRouterMetadata, getAutoArchetypes, type QueryType } from "../lib/router.js";
import {
  getDefaultMembers,
  getDefaultMaster,
  resolveApiKey,
  CouncilServiceError,
  prepareCouncilMembers
} from "../services/councilService.js";
import { loadFileContext, loadRAGContext, buildEnrichedQuestion } from "../services/messageBuilder.service.js";
import { detectArtifact, saveArtifact } from "../services/artifacts.service.js";
import { startTrace, addStep, endTrace } from "../observability/tracer.js";
import { searchRepo } from "../services/repoSearch.service.js";
import { db } from "../lib/drizzle.js";
import { codeRepositories } from "../db/schema/repos.js";
import { and, eq } from "drizzle-orm";
import { dailyUsage } from "../db/schema/users.js";
import { sql } from "drizzle-orm";
import { DAILY_REQUEST_LIMIT, DAILY_TOKEN_LIMIT } from "../config/quotas.js";

const MAX_DAILY_REQUESTS = DAILY_REQUEST_LIMIT;
const MAX_DAILY_TOKENS = DAILY_TOKEN_LIMIT;

function handleCouncilError(err: unknown): never {
  if (err instanceof CouncilServiceError) {
    throw new AppError(400, err.message);
  }
  throw err;
}

async function fastifyCheckQuota(request: FastifyRequest, reply: FastifyReply) {
  if (!request.userId) {
    return;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [updatedUsage] = await db
    .insert(dailyUsage)
    .values({
      userId: request.userId,
      date: today,
      requests: 1,
      tokens: 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dailyUsage.userId, dailyUsage.date],
      set: {
        requests: sql`${dailyUsage.requests} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (updatedUsage.requests > MAX_DAILY_REQUESTS || updatedUsage.tokens > MAX_DAILY_TOKENS) {
    logger.warn({
      userId: request.userId,
      requests: updatedUsage.requests,
      tokens: updatedUsage.tokens,
    }, "User exceeded daily quota limit");
    reply
      .header("X-Quota-Limit", MAX_DAILY_REQUESTS.toString())
      .header("X-Quota-Used", updatedUsage.requests.toString())
      .header("X-Token-Limit", MAX_DAILY_TOKENS.toString())
      .header("X-Token-Used", updatedUsage.tokens.toString())
      .header("Retry-After", "86400")
      .code(429)
      .send({ error: "Daily request or token quota exceeded. Please try again tomorrow." });
    return;
  }

  reply
    .header("X-Quota-Limit", MAX_DAILY_REQUESTS.toString())
    .header("X-Quota-Used", updatedUsage.requests.toString())
    .header("X-Quota-Remaining", Math.max(0, MAX_DAILY_REQUESTS - updatedUsage.requests).toString())
    .header("X-Token-Limit", MAX_DAILY_TOKENS.toString())
    .header("X-Token-Used", updatedUsage.tokens.toString())
    .header("X-Token-Remaining", Math.max(0, MAX_DAILY_TOKENS - updatedUsage.tokens).toString());
}

function validateAskBody(request: FastifyRequest, reply: FastifyReply) {
  const result = askSchema.safeParse(request.body);
  if (!result.success) {
    reply.code(400).send({
      error: "Validation failed",
      details: result.error.issues.map((e: any) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
    return;
  }
  (request as any).body = result.data;
}

/**
 * @openapi
 * /api/ask:
 *   get:
 *     tags:
 *       - Council
 *     summary: Health check for the Council endpoint
 *     description: Returns a simple message confirming the Council endpoint is listening.
 *     responses:
 *       200:
 *         description: Council endpoint is available
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Council is listening. Use POST to ask."
 */

/**
 * @openapi
 * /api/ask:
 *   post:
 *     tags:
 *       - Council
 *     summary: Ask the AI council a question
 *     description: >
 *       Submits a question to the AI council for deliberation. Members discuss the
 *       question over one or more rounds, then a master synthesiser produces a final verdict.
 *       Supports auto-routing, manual member selection, and direct (baseline) mode.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *             properties:
 *               question:
 *                 type: string
 *                 description: The question to ask the council.
 *               mode:
 *                 type: string
 *                 enum: [auto, manual, direct]
 *                 description: >
 *                   Routing mode. "auto" lets the router pick archetypes,
 *                   "manual" uses the provided members, "direct" skips deliberation.
 *               rounds:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 5
 *                 default: 1
 *                 description: Number of deliberation rounds (1-5).
 *               conversationId:
 *                 type: string
 *                 format: uuid
 *                 description: Optional existing conversation ID for multi-turn context.
 *               members:
 *                 type: array
 *                 description: Optional array of council member configurations.
 *                 items:
 *                   type: object
 *               upload_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Optional file upload IDs to include as context.
 *               kb_id:
 *                 type: string
 *                 description: Optional knowledge-base ID for RAG context retrieval.
 *               maxTokens:
 *                 type: number
 *                 description: Optional maximum tokens for each LLM response.
 *               userConfig:
 *                 type: object
 *                 description: >
 *                   Optional user-level council configuration overriding default members
 *                   and master.
 *     responses:
 *       200:
 *         description: Council verdict with opinions and metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 conversationId:
 *                   type: string
 *                   format: uuid
 *                 verdict:
 *                   type: string
 *                   description: The synthesised final answer.
 *                 opinions:
 *                   type: array
 *                   items:
 *                     type: object
 *                   description: Individual member opinions.
 *                 latency:
 *                   type: number
 *                   description: Total request duration in milliseconds.
 *                 cacheHit:
 *                   type: boolean
 *                 router:
 *                   type: object
 *                   description: Router metadata (present when mode is auto).
 *                 citations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       source:
 *                         type: string
 *                       score:
 *                         type: number
 *                 artifact_id:
 *                   type: string
 *                   description: ID of a detected artifact, if any.
 *                 metrics:
 *                   type: object
 *                   properties:
 *                     totalTokens:
 *                       type: number
 *                     totalCost:
 *                       type: number
 *                     hallucinationCount:
 *                       type: number
 *       400:
 *         description: Invalid request or council configuration error
 *       404:
 *         description: Conversation not found
 *       429:
 *         description: Quota exceeded
 */

/**
 * @openapi
 * /api/ask/stream:
 *   post:
 *     tags:
 *       - Council
 *     summary: Stream a council deliberation via Server-Sent Events
 *     description: >
 *       Submits a question to the AI council and returns the response as an SSE stream.
 *       Events are emitted for each stage of deliberation: status updates, member token
 *       chunks, completed opinions, peer reviews, scoring, validator results, metrics,
 *       and a final done event containing the synthesised verdict.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *             properties:
 *               question:
 *                 type: string
 *                 description: The question to ask the council.
 *               mode:
 *                 type: string
 *                 enum: [auto, manual, direct]
 *                 description: >
 *                   Routing mode. "auto" lets the router pick archetypes,
 *                   "manual" uses the provided members, "direct" skips deliberation.
 *               rounds:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 5
 *                 default: 1
 *                 description: Number of deliberation rounds (1-5).
 *               conversationId:
 *                 type: string
 *                 format: uuid
 *                 description: Optional existing conversation ID for multi-turn context.
 *               members:
 *                 type: array
 *                 description: Optional array of council member configurations.
 *                 items:
 *                   type: object
 *               upload_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Optional file upload IDs to include as context.
 *               kb_id:
 *                 type: string
 *                 description: Optional knowledge-base ID for RAG context retrieval.
 *               maxTokens:
 *                 type: number
 *                 description: Optional maximum tokens for each LLM response.
 *               userConfig:
 *                 type: object
 *                 description: >
 *                   Optional user-level council configuration overriding default members
 *                   and master.
 *     responses:
 *       200:
 *         description: SSE event stream of council deliberation
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: >
 *                 Newline-delimited SSE events. Each event has a JSON `data` field with
 *                 a `type` property. Event types: status, member_chunk, opinion,
 *                 peer_review, scored, validator_result, metrics, done, error.
 *               example: |
 *                 data: {"type":"status","message":"Deliberating..."}
 *                 data: {"type":"member_chunk","name":"analyst","chunk":"The key issue..."}
 *                 data: {"type":"opinion","name":"analyst","opinion":"..."}
 *                 data: {"type":"done","verdict":"...","opinions":[...],"conversationId":"..."}
 *       400:
 *         description: Invalid request or council configuration error
 *       404:
 *         description: Conversation not found (sent as SSE error event after headers)
 *       429:
 *         description: Quota exceeded
 */

const askPlugin: FastifyPluginAsync = async (fastify) => {

  // GET / - Health check
  fastify.get("/", async (request, reply) => {
    return { message: "Council is listening. Use POST to ask." };
  });

  // POST / - Ask the council (non-streaming)
  fastify.post("/", { preHandler: [fastifyOptionalAuth, fastifyCheckQuota, validateAskBody] }, async (request, reply) => {
    const startTime = Date.now();

    const { question, conversationId, summon, maxTokens, rounds = 1, context, mode, userConfig } = request.body as any;
    const upload_ids: string[] | undefined = (request.body as any).upload_ids;
    const kb_id: string | undefined = (request.body as any).kb_id;

    let effectiveSummon: QueryType | "default" = summon || "default";
    let effectiveMembers = (request.body as any).members;
    let routerDecision: ReturnType<typeof classifyQuery> | null = null;
    let effectiveRounds = rounds;

    if (mode === "auto") {
      const { archetypes, result } = getAutoArchetypes(question);
      routerDecision = result;
      effectiveMembers = undefined; // Force use of router archetypes
      effectiveSummon = result.fallback ? "default" : result.type;
      logger.info({
        question: question.slice(0, 50),
        routerType: result.type,
        routerConfidence: result.confidence,
        routerArchetypes: archetypes,
        routerFallback: result.fallback,
        strict: true
      }, "Auto-router: strict mode - ignoring user members/summon");
    } else if (mode === "direct") {
      logger.info({ question: question.slice(0, 50) }, "Baseline Mode: Skipping council deliberation");
      effectiveMembers = []; // Empty members list
      effectiveRounds = 0; // Skip rounds
    }

    let resolvedMembers;
    let master;
    try {
      if (userConfig) {
        const composition = prepareCouncilMembers(undefined, userConfig);
        resolvedMembers = composition.members;
        master = composition.master;
      } else {
        resolvedMembers = (effectiveMembers || getDefaultMembers()).map((m: any) => {
          if (!m.apiKey) m.apiKey = resolveApiKey(m);
          return m;
        });
        const inputMaster = (request.body as any).master || getDefaultMaster();
        if (!inputMaster.apiKey) inputMaster.apiKey = resolveApiKey(inputMaster);
        master = inputMaster;
      }
    } catch (err) {
      return handleCouncilError(err);
    }

    const userId = request.userId;

    let effectiveConversationId = conversationId;
    let messages: Message[] = [];

    if (effectiveConversationId) {
      const convo = await findConversationById(effectiveConversationId, userId ?? undefined);
      if (!convo) {
        throw new AppError(404, "Conversation not found or does not belong to you");
      }
      messages = await getRecentHistory(effectiveConversationId);
    }

    const councilMembers = await prepareCouncilWithArchetypes(resolvedMembers, effectiveSummon as any, userId);

    let memoryContext = "";
    if (effectiveConversationId) {
      const relevantChats = await retrieveRelevantContext(effectiveConversationId, question, 3);
      memoryContext = formatContextForInjection(relevantChats);
    }

    // Load file attachments and RAG context
    const fileContext = await loadFileContext(upload_ids || [], userId || 0);
    let ragContext = "";
    let ragCitations: { source: string; score: number }[] = [];
    if (kb_id && userId) {
      const rag = await loadRAGContext(userId, question, kb_id);
      ragContext = rag.context;
      ragCitations = rag.citations;
    }

    // Code-aware chat: inject repo context if repo_id is attached
    const repo_id: string | undefined = (request.body as any).repo_id;
    let codeContext = "";
    if (repo_id && userId) {
      try {
        const [repoRecord] = await db
          .select()
          .from(codeRepositories)
          .where(
            and(
              eq(codeRepositories.id, repo_id),
              eq(codeRepositories.userId, String(userId)),
              eq(codeRepositories.indexed, true)
            )
          )
          .limit(1);
        if (repoRecord) {
          const codeResults = await searchRepo(repo_id, question, 5);
          if (codeResults.length > 0) {
            codeContext = codeResults
              .map((r) => `[CODE CONTEXT]\nFile: ${r.path}\n\`\`\`${r.language}\n${r.content.slice(0, 1500)}\n\`\`\`\n[/CODE CONTEXT]`)
              .join("\n\n");
          }
        }
      } catch (err) {
        logger.warn({ err, repo_id }, "Failed to load code context");
      }
    }

    const questionWithContext = buildEnrichedQuestion(question, fileContext, ragContext, memoryContext, context);
    const enrichedQuestion = codeContext
      ? `${codeContext}\n\n${questionWithContext}`
      : questionWithContext;
    const currentMessages = [...messages, { role: "user" as const, content: enrichedQuestion }];

    // Start trace for observability
    const traceCtx = userId
      ? startTrace(userId, "chat", { conversationId: effectiveConversationId || undefined })
      : null;

    const cached = await getCachedResponse(question, councilMembers, master, messages);

    let verdict = "";
    let finalOpinions: any[] = [];
    let tokensUsed = 0;
    let isCacheHit = false;

    if (cached) {
      verdict = cached.verdict;
      finalOpinions = cached.opinions as any;
      isCacheHit = true;
      logger.info({ question: question.slice(0, 50) }, "Serving from semantic cache");
      if (traceCtx) addStep(traceCtx, { name: "cache_hit", type: "retrieval", input: question.slice(0, 500), output: "served from cache", latencyMs: 0 });
    } else {
      logger.info({ question: question.slice(0, 80), memberCount: councilMembers.length, summon: effectiveSummon, rounds: effectiveRounds }, "Council ask started");

      const councilStart = Date.now();
      const councilResponse = await askCouncil(councilMembers, master, currentMessages, maxTokens, effectiveRounds);
      verdict = councilResponse.verdict;
      finalOpinions = councilResponse.opinions;
      tokensUsed = councilResponse.metrics?.totalTokens ?? 0;

      if (traceCtx) {
        for (const op of finalOpinions) {
          addStep(traceCtx, { name: op.name || "agent", type: "llm_call", input: question.slice(0, 500), output: (op.opinion || "").slice(0, 500), tokens: 0, latencyMs: 0 });
        }
        addStep(traceCtx, { name: "synthesis", type: "synthesis", input: question.slice(0, 500), output: verdict.slice(0, 500), tokens: tokensUsed, latencyMs: Date.now() - councilStart });
      }

      await setCachedResponse(question, councilMembers, master, messages, verdict, finalOpinions);
    }

    // End trace
    if (traceCtx) {
      traceCtx.conversationId = effectiveConversationId || undefined;
      endTrace(traceCtx).catch((err) => logger.warn({ err }, "Failed to save trace"));
    }

    if (userId) {
      if (!effectiveConversationId) {
        const newConvo = await createConversation({
          userId,
          title: question.slice(0, 50) + (question.length > 50 ? "..." : "")
        });
        effectiveConversationId = newConvo.id;
      }

      await createChat({
        userId,
        conversationId: effectiveConversationId,
        question,
        verdict,
        opinions: finalOpinions,
        durationMs: Date.now() - startTime,
        tokensUsed,
        cacheHit: isCacheHit,
      });

      await updateDailyUsage({ userId: userId!, tokensUsed, isCacheHit });
    }

    // Detect and save artifacts from the verdict
    let artifactId: string | undefined;
    if (verdict && userId) {
      const detected = detectArtifact(verdict);
      if (detected) {
        artifactId = await saveArtifact(userId, effectiveConversationId || null, detected);
      }
    }

    return {
      success: true,
      conversationId: effectiveConversationId,
      verdict,
      opinions: finalOpinions,
      latency: Date.now() - startTime,
      cacheHit: isCacheHit,
      router: routerDecision ? formatRouterMetadata(routerDecision) : undefined,
      citations: ragCitations.length > 0 ? ragCitations : undefined,
      artifact_id: artifactId,
      metrics: (tokensUsed > 0 || isCacheHit) ? { totalTokens: tokensUsed, totalCost: 0, hallucinationCount: 0 } : undefined
    };
  });

  // POST /stream - SSE streaming endpoint
  fastify.post("/stream", { preHandler: [fastifyOptionalAuth, fastifyCheckQuota, validateAskBody] }, async (request, reply) => {
    const startTime = Date.now();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    try {
      const { question, conversationId, summon, maxTokens, rounds = 1, context, mode } = request.body as any;
      const upload_ids: string[] | undefined = (request.body as any).upload_ids;
      const kb_id: string | undefined = (request.body as any).kb_id;

      let effectiveSummon: QueryType | "default" = summon || "default";
      let effectiveMembers = (request.body as any).members;
      let routerDecision: ReturnType<typeof classifyQuery> | null = null;
      let effectiveRounds = rounds;

      if (mode === "auto") {
        const { archetypes, result } = getAutoArchetypes(question);
        routerDecision = result;
        effectiveMembers = undefined; // Force use of router archetypes
        effectiveSummon = result.fallback ? "default" : result.type;
        logger.info({
          question: question.slice(0, 50),
          routerType: result.type,
          routerConfidence: result.confidence,
          routerArchetypes: archetypes,
          routerFallback: result.fallback,
          strict: true
        }, "Stream auto-router: strict mode - ignoring user members/summon");
      } else if (mode === "direct") {
        logger.info({ question: question.slice(0, 50) }, "Stream Baseline Mode: Skipping council deliberation");
        effectiveMembers = []; // Empty members list
        effectiveRounds = 0; // Skip rounds
      }

      const resolvedMembers = (effectiveMembers || getDefaultMembers()).map((m: any) => {
        if (!m.apiKey) m.apiKey = resolveApiKey(m);
        return m;
      });

      const inputMaster = (request.body as any).master || getDefaultMaster();
      if (!inputMaster.apiKey) inputMaster.apiKey = resolveApiKey(inputMaster);
      const master = inputMaster;

      const userId = request.userId;

      let effectiveConversationId = conversationId;
      let messages: Message[] = [];

      if (effectiveConversationId) {
        const convo = await findConversationById(effectiveConversationId, userId ?? undefined);
        if (!convo) {
          reply.raw.write(`data: ${JSON.stringify({ type: "error", message: "Conversation not found" })}\n\n`);
          reply.raw.end();
          return;
        }
        messages = await getRecentHistory(effectiveConversationId);
      }

      if (userId && !effectiveConversationId) {
        const newConvo = await createConversation({
          userId,
          title: question.slice(0, 50) + (question.length > 50 ? "..." : "")
        });
        effectiveConversationId = newConvo.id;
      }

      const councilMembers = await prepareCouncilWithArchetypes(resolvedMembers, effectiveSummon, userId);

      let memoryContext = "";
      if (effectiveConversationId) {
        const relevantChats = await retrieveRelevantContext(effectiveConversationId, question, 3);
        memoryContext = formatContextForInjection(relevantChats);
      }

      // Load file attachments and RAG context
      const fileContext = await loadFileContext(upload_ids || [], userId || 0);
      let ragContext = "";
      let ragCitations: { source: string; score: number }[] = [];
      if (kb_id && userId) {
        const rag = await loadRAGContext(userId, question, kb_id);
        ragContext = rag.context;
        ragCitations = rag.citations;
      }

      const questionWithContext = buildEnrichedQuestion(question, fileContext, ragContext, memoryContext, context);
      const currentMessages = [...messages, { role: "user" as const, content: questionWithContext }];

      const controller = new AbortController();
      request.raw.on("close", () => {
        logger.info("SSE client disconnected, aborting ask stream...");
        controller.abort();
      });
      request.raw.on("error", (err) => {
        logger.error({ err }, "SSE connection error");
        controller.abort();
      });
      reply.raw.on("close", () => {
        controller.abort();
      });

      let isCacheHit = false;
      let finalVerdict = "";
      let finalOpinions: any[] = [];
      let tokensUsed = 0;

      const cached = await getCachedResponse(question, councilMembers, master, messages);
      if (cached) {
        isCacheHit = true;
        finalVerdict = cached.verdict;
        finalOpinions = cached.opinions as any;
        reply.raw.write(`data: ${JSON.stringify({
          type: "done",
          cached: true,
          verdict: cached.verdict,
          opinions: cached.opinions,
          conversationId: effectiveConversationId ?? null,
          router: routerDecision ? formatRouterMetadata(routerDecision) : undefined,
        })}\n\n`);
        reply.raw.end();
      } else {
        logger.info({ question: question.slice(0, 80), memberCount: councilMembers.length, summon: effectiveSummon, rounds: effectiveRounds }, "Council SSE stream started");

        const emitEvent = (type: string, data: any) => {
          if (!controller.signal.aborted) {
            const payload = type === "done"
              ? { ...data, conversationId: effectiveConversationId ?? null }
              : data;
            reply.raw.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
          }
        };

        finalVerdict = await streamCouncil(
          councilMembers,
          master,
          currentMessages,
          (event, data) => {
            if (event === "opinion") finalOpinions.push(data);
            if (event === "done") tokensUsed = data.tokensUsed || 0;
            emitEvent(event, data);
          },
          maxTokens,
          effectiveRounds,
          controller.signal
        );

        reply.raw.end();
        await setCachedResponse(question, councilMembers, master, messages, finalVerdict, finalOpinions);

        if (effectiveConversationId && userId && finalVerdict) {
          await createChat({
            userId,
            conversationId: effectiveConversationId,
            question,
            verdict: finalVerdict,
            opinions: finalOpinions,
            durationMs: Date.now() - startTime,
            tokensUsed,
            cacheHit: isCacheHit
          });
        }
        if (userId) {
          await updateDailyUsage({ userId, tokensUsed, isCacheHit });
        }

        // Detect and save artifacts from stream verdict
        if (finalVerdict && userId) {
          const detected = detectArtifact(finalVerdict);
          if (detected) {
            await saveArtifact(userId, effectiveConversationId || null, detected);
          }
        }
      }

    } catch (e: any) {
      reply.raw.write(`data: ${JSON.stringify({ type: "error", message: e.message })}\n\n`);
      reply.raw.end();
    }
  });
};

export default askPlugin;

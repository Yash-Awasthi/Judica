import { Router, Response, NextFunction } from "express";
import { askCouncil } from "../lib/council.js";
import { Message } from "../lib/providers.js";
import logger from "../lib/logger.js";
import { optionalAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { checkQuota } from "../middleware/quota.js";
import { validate, askSchema } from "../middleware/validate.js";
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
import prisma from "../lib/db.js";

function handleCouncilError(err: unknown): never {
  if (err instanceof CouncilServiceError) {
    throw new AppError(400, err.message);
  }
  throw err;
}

const router = Router();

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
router.get("/", (req, res) => {
  res.json({ message: "Council is listening. Use POST to ask." });
});

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
router.post("/", optionalAuth, checkQuota, validate(askSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  try {
    const { question, conversationId, summon, maxTokens, rounds = 1, context, mode, userConfig } = req.body;
    const upload_ids: string[] | undefined = req.body.upload_ids;
    const kb_id: string | undefined = req.body.kb_id;

    let effectiveSummon: QueryType | "default" = summon || "default";
    let effectiveMembers = req.body.members;
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
        const inputMaster = req.body.master || getDefaultMaster();
        if (!inputMaster.apiKey) inputMaster.apiKey = resolveApiKey(inputMaster);
        master = inputMaster;
      }
    } catch (err) {
      return handleCouncilError(err);
    }

    const userId = req.userId;

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
    const repo_id: string | undefined = req.body.repo_id;
    let codeContext = "";
    if (repo_id && userId) {
      try {
        const repoRecord = await prisma.codeRepository.findFirst({
          where: { id: repo_id, userId: String(userId), indexed: true },
        });
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

    res.json({
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
    });

  } catch (e: any) {
    next(e);
  }
});

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
router.post("/stream", optionalAuth, checkQuota, validate(askSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const { question, conversationId, summon, maxTokens, rounds = 1, context, mode } = req.body;
    const upload_ids: string[] | undefined = req.body.upload_ids;
    const kb_id: string | undefined = req.body.kb_id;

    let effectiveSummon: QueryType | "default" = summon || "default";
    let effectiveMembers = req.body.members;
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

    const inputMaster = req.body.master || getDefaultMaster();
    if (!inputMaster.apiKey) inputMaster.apiKey = resolveApiKey(inputMaster);
    const master = inputMaster;

    const userId = req.userId;

    let effectiveConversationId = conversationId;
    let messages: Message[] = [];

    if (effectiveConversationId) {
      const convo = await findConversationById(effectiveConversationId, userId ?? undefined);
      if (!convo) {
        res.write(`data: ${JSON.stringify({ type: "error", message: "Conversation not found" })}\n\n`);
        return res.end();
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
    req.on("close", () => {
      logger.info("SSE client disconnected, aborting ask stream...");
      controller.abort();
    });
    req.on("error", (err) => {
      logger.error({ err }, "SSE connection error");
      controller.abort();
    });
    res.on("close", () => {
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
      res.write(`data: ${JSON.stringify({
        type: "done",
        cached: true,
        verdict: cached.verdict,
        opinions: cached.opinions,
        conversationId: effectiveConversationId ?? null,
        router: routerDecision ? formatRouterMetadata(routerDecision) : undefined,
      })}\n\n`);
      res.end();
    } else {
      logger.info({ question: question.slice(0, 80), memberCount: councilMembers.length, summon: effectiveSummon, rounds: effectiveRounds }, "Council SSE stream started");

      const emitEvent = (type: string, data: any) => {
        if (!controller.signal.aborted) {
          const payload = type === "done"
            ? { ...data, conversationId: effectiveConversationId ?? null }
            : data;
          res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
          const flush = (res as any).flush;
          if (flush) flush();
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

      res.end();
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
    if (!res.headersSent) {
      next(e);
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", message: e.message })}\n\n`);
      res.end();
    }
  }
});

export default router;

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

function handleCouncilError(err: unknown): never {
  if (err instanceof CouncilServiceError) {
    throw new AppError(400, err.message);
  }
  throw err;
}

const router = Router();

// ── GET /api/ask (Basic Test) ────────────────────────────────────────────────
router.get("/", (req, res) => {
  res.json({ message: "Council is listening. Use POST to ask." });
});

// ── POST /api/ask (Main Execution) ───────────────────────────────────────────
router.post("/", optionalAuth, checkQuota, validate(askSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  try {
    const { question, conversationId, summon, maxTokens, context, mode, userConfig } = req.body;
    let roundsUsed = req.body.rounds || 1;

    // ── Router: Auto-select council composition if mode === "auto" ───────────
    // STRICT MODE: When auto mode is active, ignore ALL user input (members/summon)
    // and use ONLY router-selected archetypes
    let effectiveSummon: QueryType | "default" = summon || "default";
    let effectiveMembers = req.body.members;
    let routerDecision: ReturnType<typeof classifyQuery> | null = null;

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
      // BASELINE MODE: Deliberately bypass council and use single master agent
      logger.info({ question: question.slice(0, 50) }, "Baseline Mode: Skipping council deliberation");
      effectiveMembers = []; // Empty members list
      roundsUsed = 0; // Skip rounds
    }

    // Resolve council members and master from service layer
    let resolvedMembers;
    let master;
    try {
      // Use new user-controlled composition if userConfig provided
      if (userConfig) {
        const composition = prepareCouncilMembers(undefined, userConfig);
        resolvedMembers = composition.members;
        master = composition.master;
      } else {
        // Legacy path: resolve from explicit members or defaults
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

    // 1. Sync or Create Conversation
    if (effectiveConversationId) {
      const convo = await findConversationById(effectiveConversationId, userId ?? undefined);
      if (!convo) {
        throw new AppError(404, "Conversation not found or does not belong to you");
      }
      messages = await getRecentHistory(effectiveConversationId);
    }

    const councilMembers = await prepareCouncilWithArchetypes(resolvedMembers, effectiveSummon as any, userId);

    // Retrieve relevant past context for persistent memory
    let memoryContext = "";
    if (effectiveConversationId) {
      const relevantChats = await retrieveRelevantContext(effectiveConversationId, question, 3);
      memoryContext = formatContextForInjection(relevantChats);
    }

    const questionWithContext = context 
      ? `GROUND TRUTH CONTEXT:\n${context}\n\n---\n\n${memoryContext}QUESTION: ${question}`
      : memoryContext 
        ? `${memoryContext}QUESTION: ${question}`
        : question;
    const currentMessages = [...messages, { role: "user" as const, content: questionWithContext }];

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
    } else {
      logger.info({ question: question.slice(0, 80), memberCount: councilMembers.length, summon: effectiveSummon, rounds: roundsUsed }, "Council ask started");

      const councilResponse = await askCouncil(councilMembers, master, currentMessages, maxTokens, roundsUsed);
      verdict = councilResponse.verdict;
      finalOpinions = councilResponse.opinions;
      tokensUsed = councilResponse.metrics?.totalTokens ?? 0;

      await setCachedResponse(question, councilMembers, master, messages, verdict, finalOpinions);
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

    res.json({
      success: true,
      conversationId: effectiveConversationId,
      verdict,
      opinions: finalOpinions,
      latency: Date.now() - startTime,
      cacheHit: isCacheHit,
      router: routerDecision ? formatRouterMetadata(routerDecision) : undefined,
      metrics: (tokensUsed > 0 || isCacheHit) ? { totalTokens: tokensUsed, totalCost: 0, hallucinationCount: 0 } : undefined
    });

  } catch (e: any) {
    next(e);
  }
});

// ── POST /api/ask/stream (SSE) ────────────────────────────────────────────────
router.post("/stream", optionalAuth, checkQuota, validate(askSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const { question, conversationId, summon, maxTokens, rounds = 1, context, mode } = req.body;

    // ── Router: Auto-select council composition if mode === "auto" ───────────
    // STRICT MODE: When auto mode is active, ignore ALL user input (members/summon)
    let effectiveSummon: QueryType | "default" = summon || "default";
    let effectiveMembers = req.body.members;
    let routerDecision: ReturnType<typeof classifyQuery> | null = null;

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
    }

    // Map empty API keys to server-side fallbacks
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

    // FIX: Pre-create the conversation before streaming starts so we have the
    // conversationId available to include in the SSE "done" event.
    // Without this, the frontend never learns the new conversationId from a stream.
    if (userId && !effectiveConversationId) {
      const newConvo = await createConversation({
        userId,
        title: question.slice(0, 50) + (question.length > 50 ? "..." : "")
      });
      effectiveConversationId = newConvo.id;
    }

    const councilMembers = await prepareCouncilWithArchetypes(resolvedMembers, effectiveSummon, userId);

    // Retrieve relevant past context for persistent memory
    let memoryContext = "";
    if (effectiveConversationId) {
      const relevantChats = await retrieveRelevantContext(effectiveConversationId, question, 3);
      memoryContext = formatContextForInjection(relevantChats);
    }

    const questionWithContext = context 
      ? `GROUND TRUTH CONTEXT:\n${context}\n\n---\n\n${memoryContext}QUESTION: ${question}`
      : memoryContext 
        ? `${memoryContext}QUESTION: ${question}`
        : question;
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
      // FIX: include conversationId and router metadata so the frontend can update its state
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
      logger.info({ question: question.slice(0, 80), memberCount: councilMembers.length, summon: effectiveSummon, rounds }, "Council SSE stream started");

      const emitEvent = (type: string, data: any) => {
        if (!controller.signal.aborted) {
          // FIX: for the "done" event, inject conversationId so the frontend
          // can update activeConvoId and reload the conversation list.
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
        rounds,
        controller.signal
      );

      res.end();
      await setCachedResponse(question, councilMembers, master, messages, finalVerdict, finalOpinions);
      
      // Update conversation context after synthesis (runs once after full response)
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

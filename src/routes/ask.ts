import { Router, Response, NextFunction } from "express";
import { askCouncil } from "../lib/council.js";
import { Message } from "../lib/providers.js";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import { optionalAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { checkQuota } from "../middleware/quota.js";
import { validate, askSchema } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";
import { getCachedResponse, setCachedResponse } from "../lib/cache.js";
import { prepareCouncilMembers, streamCouncil } from "../lib/council.js";
import { getRecentHistory } from "../lib/history.js";
import { env } from "../config/env.js";

/** Build default members from server-side env API keys */
function getDefaultMembers(count = 3) {
  const providers: any[] = [];
  if (env.OPENAI_API_KEY) {
    providers.push({ type: "openai-compat", apiKey: env.OPENAI_API_KEY, model: "gpt-4o", name: "OpenAI" });
  }
  if (env.GOOGLE_API_KEY) {
    providers.push({ type: "google", apiKey: env.GOOGLE_API_KEY, model: "gemini-2.0-flash", name: "Gemini" });
  }
  if (env.ANTHROPIC_API_KEY) {
    providers.push({ type: "anthropic", apiKey: env.ANTHROPIC_API_KEY, model: "claude-sonnet-4-20250514", name: "Claude" });
  }
  if (providers.length === 0) {
    throw new AppError(400, "No AI provider API keys configured. Set OPENAI_API_KEY, GOOGLE_API_KEY, or ANTHROPIC_API_KEY in your environment.");
  }
  while (providers.length < count) {
    providers.push({ ...providers[providers.length % providers.length] });
  }
  return providers.slice(0, count);
}

function getDefaultMaster() {
  if (env.OPENAI_API_KEY) return { type: "openai-compat" as const, apiKey: env.OPENAI_API_KEY, model: "gpt-4o", name: "Master" };
  if (env.GOOGLE_API_KEY) return { type: "google" as const, apiKey: env.GOOGLE_API_KEY, model: "gemini-2.0-flash", name: "Master" };
  if (env.ANTHROPIC_API_KEY) return { type: "anthropic" as const, apiKey: env.ANTHROPIC_API_KEY, model: "claude-sonnet-4-20250514", name: "Master" };
  throw new AppError(400, "No AI provider API keys configured.");
}

/** Resolve API key for a member that has no key set, using baseUrl and model name heuristics */
function resolveApiKey(m: any): string {
  const base = (m.baseUrl || "").toLowerCase();
  const model = (m.model || "").toLowerCase();

  // 1. Check baseUrl first (most reliable signal)
  if (base.includes("siliconflow"))   return env.XIAOMI_MIMO_API_KEY || env.OPENAI_API_KEY || "";
  if (base.includes("openrouter"))    return env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || "";
  if (base.includes("groq.com"))      return env.GROQ_API_KEY || env.OPENAI_API_KEY || "";
  if (base.includes("mistral.ai"))    return env.MISTRAL_API_KEY || env.OPENAI_API_KEY || "";
  if (base.includes("cerebras.ai"))   return env.CEREBRAS_API_KEY || env.OPENAI_API_KEY || "";
  if (base.includes("nvidia.com"))    return env.NVIDIA_API_KEY || env.OPENAI_API_KEY || "";

  // 2. Check model name patterns
  if (model.includes("/"))            return env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || "";  // OpenRouter uses org/model format
  if (model.includes("xiaomi") || model.includes("mimo")) return env.XIAOMI_MIMO_API_KEY || env.OPENAI_API_KEY || "";
  if (model.includes("mistral"))      return env.MISTRAL_API_KEY || env.OPENAI_API_KEY || "";
  if (model.includes("qwen-3-235b") || model.includes("gpt-oss") || model.includes("llama3.1-8b"))  return env.CEREBRAS_API_KEY || env.OPENAI_API_KEY || "";

  // 3. Check provider type
  if (m.type === "google")            return env.GOOGLE_API_KEY || "";
  if (m.type === "anthropic")         return env.ANTHROPIC_API_KEY || "";

  // 4. Default to OpenAI
  return env.OPENAI_API_KEY || "";
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
    const { question, conversationId, summon, maxTokens, rounds = 1, context } = req.body;
    // Map empty API keys to server-side fallbacks
    const resolvedMembers = (req.body.members || getDefaultMembers()).map((m: any) => {
      if (!m.apiKey) m.apiKey = resolveApiKey(m);
      return m;
    });
    
    // Process master empty key similarly
    const inputMaster = req.body.master || getDefaultMaster();
    if (!inputMaster.apiKey) {
      inputMaster.apiKey = env.OPENAI_API_KEY;
    }
    const master = inputMaster;

    const userId = req.userId;

    let effectiveConversationId = conversationId;
    let messages: Message[] = [];

    // 1. Sync or Create Conversation
    if (effectiveConversationId) {
      const convo = await prisma.conversation.findFirst({
        where: { id: effectiveConversationId, userId: userId ?? null }
      });
      if (!convo) {
        throw new AppError(404, "Conversation not found or does not belong to you");
      }
      messages = await getRecentHistory(effectiveConversationId);
    }

    const councilMembers = await prepareCouncilMembers(resolvedMembers, summon, userId);

    const questionWithContext = context ? `GROUND TRUTH CONTEXT:\n${context}\n\n---\n\nQUESTION: ${question}` : question;
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
      logger.info({ question: question.slice(0, 80), memberCount: councilMembers.length, summon, rounds }, "Council ask started");

      const councilResponse = await askCouncil(councilMembers, master, currentMessages, maxTokens, rounds);
      verdict = councilResponse.verdict;
      finalOpinions = councilResponse.opinions;
      tokensUsed = councilResponse.tokensUsed ?? 0;

      await setCachedResponse(question, councilMembers, master, messages, verdict, finalOpinions);
    }

    if (userId) {
      if (!effectiveConversationId) {
        const newConvo = await prisma.conversation.create({
          data: {
            userId,
            title: question.slice(0, 50) + (question.length > 50 ? "..." : "")
          }
        });
        effectiveConversationId = newConvo.id;
      }

      await prisma.chat.create({
        data: {
          userId,
          conversationId: effectiveConversationId,
          question,
          verdict,
          opinions: finalOpinions,
          durationMs: Date.now() - startTime,
          tokensUsed,
          cacheHit: isCacheHit,
        }
      });

      if (!isCacheHit && tokensUsed > 0) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        prisma.dailyUsage.upsert({
           where: { userId_date: { userId, date: today } },
           update: { tokens: { increment: tokensUsed } },
           create: { userId, date: today, tokens: tokensUsed, requests: 1 }
        }).catch((err: any) => logger.error({ err, userId, tokensUsed }, "Failed to update daily tokens in ask"));
      }
    }

    res.json({
      success: true,
      conversationId: effectiveConversationId,
      verdict,
      opinions: finalOpinions,
      latency: Date.now() - startTime,
      // FIX: cacheHit was missing from the non-stream response
      cacheHit: isCacheHit,
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
    const { question, conversationId, summon, maxTokens, rounds = 1, context } = req.body;
    // Map empty API keys to server-side fallbacks
    const resolvedMembers = (req.body.members || getDefaultMembers()).map((m: any) => {
      if (!m.apiKey) m.apiKey = resolveApiKey(m);
      return m;
    });
    
    const inputMaster = req.body.master || getDefaultMaster();
    if (!inputMaster.apiKey) {
      inputMaster.apiKey = env.OPENAI_API_KEY;
    }
    const master = inputMaster;

    const userId = req.userId;

    let effectiveConversationId = conversationId;
    let messages: Message[] = [];

    if (effectiveConversationId) {
      const convo = await prisma.conversation.findFirst({
        where: { id: effectiveConversationId, userId: userId ?? null }
      });
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
      const newConvo = await prisma.conversation.create({
        data: { userId, title: question.slice(0, 50) + (question.length > 50 ? "..." : "") }
      });
      effectiveConversationId = newConvo.id;
    }

    const councilMembers = await prepareCouncilMembers(resolvedMembers, summon, userId);
    const questionWithContext = context ? `GROUND TRUTH CONTEXT:\n${context}\n\n---\n\nQUESTION: ${question}` : question;
    const currentMessages = [...messages, { role: "user" as const, content: questionWithContext }];

    const controller = new AbortController();
    req.on("close", () => {
      logger.info("SSE client disconnected, aborting ask stream...");
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
      // FIX: include conversationId so the frontend can update its state
      res.write(`data: ${JSON.stringify({
        type: "done",
        cached: true,
        verdict: cached.verdict,
        opinions: cached.opinions,
        conversationId: effectiveConversationId ?? null,
      })}\n\n`);
      res.end();
    } else {
      logger.info({ question: question.slice(0, 80), memberCount: councilMembers.length, summon, rounds }, "Council SSE stream started");

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
    }

    if (userId && !controller.signal.aborted) {
      // Conversation was pre-created above; just save the chat record.
      if (effectiveConversationId) {
        await prisma.chat.create({
          data: {
            userId,
            conversationId: effectiveConversationId,
            question,
            verdict: finalVerdict,
            opinions: finalOpinions,
            durationMs: Date.now() - startTime,
            tokensUsed,
            cacheHit: isCacheHit
          }
        });
      }
      if (!isCacheHit && tokensUsed > 0) {
         const today = new Date();
         today.setUTCHours(0, 0, 0, 0);
         prisma.dailyUsage.upsert({
           where: { userId_date: { userId, date: today } },
           update: { tokens: { increment: tokensUsed } },
           create: { userId, date: today, tokens: tokensUsed, requests: 1 }
         }).catch((err: any) => logger.error({ err }, "Failed to update daily tokens in SSE ask"));
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

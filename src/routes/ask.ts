import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { askCouncil } from "../lib/council.js";
import { Message, Provider } from "../lib/providers.js";
import logger from "../lib/logger.js";
import { fastifyOptionalAuth } from "../middleware/fastifyAuth.js";
import { fastifyCheckQuota } from "../middleware/quota.js";
import { askSchema } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";
import redis from "../lib/redis.js";
import { getCachedResponse, setCachedResponse } from "../lib/cache.js";
import { prepareCouncilMembers as prepareCouncilWithArchetypes, streamCouncil, type CouncilMemberInput } from "../lib/council.js";
import { z } from "zod";
import {
  createConversation,
  findConversationById,
  createChat,
  getRecentHistory,
  retrieveRelevantContext,
  formatContextForInjection
} from "../services/conversation.service.js";
import { updateDailyUsage } from "../services/usage.service.js";
import { classifyQuery, formatRouterMetadata, getAutoArchetypes } from "../lib/router.js";
import {
  getDefaultMembers,
  getDefaultMaster,
  resolveApiKey,
  CouncilServiceError,
  prepareCouncilMembers,
  type ApiKeyResolutionInput
} from "../services/council.service.js";
import { loadFileContext, loadRAGContext, buildEnrichedQuestion } from "../services/messageBuilder.service.js";
import { detectArtifact, saveArtifact } from "../services/artifacts.service.js";
import {
  runSocraticPrelude,
  runRedBlueDebate,
  runHypothesisRefinement,
  runConfidenceCalibration,
  type ReasoningMode,
} from "../lib/reasoningModes.js";
import { startTrace, addStep, endTrace } from "../observability/tracer.js";
import { searchRepo } from "../services/repoSearch.service.js";
import { db } from "../lib/drizzle.js";
import { codeRepositories } from "../db/schema/repos.js";
import { and, eq } from "drizzle-orm";
import { anonymousRequests } from "../lib/prometheusMetrics.js";

type AskBody = z.infer<typeof askSchema>;

// P0-01: Anonymous rate limiting — 5 requests per minute per IP, direct mode only
// P0-43: Anonymous requests are now tracked in Prometheus metrics
const ANON_RATE_LIMIT = 5;
const ANON_RATE_WINDOW_SECS = 60;

async function fastifyAnonGuard(request: FastifyRequest, reply: FastifyReply) {
  // If user is authenticated (set by fastifyOptionalAuth before this), allow through
  if (request.userId) return;

  const body = request.body as AskBody | undefined;
  const mode = body?.mode || "direct";

  // Anonymous users are restricted to "direct" mode only
  if (body && body.mode !== "direct") {
    anonymousRequests.inc({ mode, status: "rejected_mode" });
    reply.code(401).send({ error: "Authentication required for council/auto mode. Anonymous access is limited to direct mode." });
    return;
  }

  // IP-scoped rate limit via Redis
  const ip = request.ip || "unknown";
  const key = `anon_rate:${ip}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, ANON_RATE_WINDOW_SECS);
  }

  if (current > ANON_RATE_LIMIT) {
    const ttl = await redis.ttl(key);
    anonymousRequests.inc({ mode, status: "rate_limited" });
    reply.header("Retry-After", String(ttl > 0 ? ttl : ANON_RATE_WINDOW_SECS));
    reply.code(429).send({ error: "Anonymous rate limit exceeded. Please authenticate or wait." });
    return;
  }

  // P0-43: Track successful anonymous request
  anonymousRequests.inc({ mode, status: "allowed" });
}

function handleCouncilError(err: unknown): never {
  if (err instanceof CouncilServiceError) {
    throw new AppError(400, err.message);
  }
  throw err;
}

// P0-44: Removed inline fastifyCheckQuota — now imported from middleware/quota.ts

// P3-19: Fastify preHandler expects async functions — make validateAskBody async.
async function validateAskBody(request: FastifyRequest, reply: FastifyReply) {
  const result = askSchema.safeParse(request.body);
  if (!result.success) {
    reply.code(400).send({
      error: "Validation failed",
      details: result.error.issues.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
    return;
  }
  (request as FastifyRequest<{ Body: AskBody }>).body = result.data;
}

const askPlugin: FastifyPluginAsync = async (fastify) => {

  // GET / - Health check
  fastify.get("/", async (_request, _reply) => {
    return { message: "Council is listening. Use POST to ask." };
  });

  // POST / - Ask the council (non-streaming)
  fastify.post("/", { preHandler: [fastifyOptionalAuth, fastifyAnonGuard, fastifyCheckQuota, validateAskBody] }, async (request, _reply) => {
    const startTime = Date.now();

    const { question, conversationId, summon, maxTokens, rounds = 1, context, mode, userConfig } = request.body as AskBody;
    const upload_ids: string[] | undefined = (request.body as AskBody).upload_ids;
    const kb_id: string | undefined = (request.body as AskBody).kb_id;
    const deliberation_mode: ReasoningMode = (request.body as AskBody).deliberation_mode ?? "standard";

    let effectiveSummon: string = summon || "default";
    let effectiveMembers = (request.body as AskBody).members;
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
      // P3-18: Use undefined instead of [] — empty array is truthy and
      // would bypass the `effectiveMembers || getDefaultMembers()` fallback.
      effectiveMembers = undefined;
      effectiveRounds = 0; // Skip rounds
    }

    let resolvedMembers: CouncilMemberInput[];
    let master: Provider;
    try {
      if (userConfig) {
        const composition = prepareCouncilMembers(undefined, userConfig);
        resolvedMembers = composition.members as CouncilMemberInput[];
        master = composition.master as Provider;
      } else {
        resolvedMembers = (effectiveMembers || getDefaultMembers()).map((m) => {
          if (!m.apiKey) m.apiKey = resolveApiKey(m as ApiKeyResolutionInput);
          return m as CouncilMemberInput;
        });
        const inputMaster = (request.body as AskBody).master || getDefaultMaster();
        if (!inputMaster.apiKey) inputMaster.apiKey = resolveApiKey(inputMaster as ApiKeyResolutionInput);
        master = inputMaster as Provider;
      }
    } catch (err) {
      return handleCouncilError(err);
    }

    const userId = request.userId;

    let effectiveConversationId = conversationId;
    let messages: Message[] = [];

    if (effectiveConversationId) {
      // P8-64: Verify requesting user owns the conversation — prevents IDOR
      const convo = await findConversationById(effectiveConversationId, userId ?? undefined);
      if (!convo) {
        throw new AppError(404, "Conversation not found or does not belong to you");
      }
      // P8-64: Double-check userId match for authenticated users
      if (userId && convo.userId !== userId) {
        throw new AppError(403, "Access denied: conversation belongs to another user");
      }
      messages = await getRecentHistory(effectiveConversationId);
    }

    const councilMembers = await prepareCouncilWithArchetypes(resolvedMembers, effectiveSummon, userId);

    let memoryContext = "";
    if (effectiveConversationId) {
      const relevantChats = await retrieveRelevantContext(effectiveConversationId, question, 3);
      memoryContext = formatContextForInjection(relevantChats);
    }

    // P3-20: Reject anonymous users for file loading instead of falling back to user 0.
    // userId 0 could access another user's data. Skip file loading for unauthenticated users.
    const fileContext = userId ? await loadFileContext(upload_ids || [], userId) : "";
    let ragContext = "";
    let ragCitations: { source: string; score: number }[] = [];
    if (kb_id && userId) {
      const rag = await loadRAGContext(userId, question, kb_id);
      ragContext = rag.context;
      ragCitations = rag.citations;
    }

    // Code-aware chat: inject repo context if repo_id is attached
    const repo_id: string | undefined = (request.body as AskBody).repo_id;
    let codeContext = "";
    if (repo_id && userId) {
      try {
        const [repoRecord] = await db
          .select()
          .from(codeRepositories)
          .where(
            and(
              eq(codeRepositories.id, repo_id),
              eq(codeRepositories.userId, userId!),
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
    const currentMessages = [...messages, { role: "user" as const, content: enrichedQuestion }] as Message[];

    // Start trace for observability
    const traceCtx = userId
      ? startTrace(userId, "chat", { conversationId: effectiveConversationId || undefined })
      : null;

    // P3-21: Pass userId to scope cache per tenant
    // P8-66: Quota is already decremented by fastifyCheckQuota preHandler —
    // cache hits DO count against quota (request was counted before reaching this code).
    const cached = await getCachedResponse(question, councilMembers, master, messages, userId);

    let verdict;
    let finalOpinions: { name: string; opinion: string; [key: string]: unknown }[];
    let tokensUsed = 0;
    let isCacheHit = false;

    if (cached) {
      verdict = cached.verdict;
      finalOpinions = cached.opinions;
      isCacheHit = true;
      logger.info({ question: question.slice(0, 50) }, "Serving from semantic cache");
      if (traceCtx) addStep(traceCtx, { name: "cache_hit", type: "retrieval", input: question.slice(0, 500), output: "served from cache", latencyMs: 0 });
    } else {
      logger.info({ question: question.slice(0, 80), memberCount: councilMembers.length, summon: effectiveSummon, rounds: effectiveRounds, deliberation_mode }, "Council ask started");

      const councilStart = Date.now();

      if (deliberation_mode === "socratic") {
        const { augmentedContext, qa } = await runSocraticPrelude(question, councilMembers);
        const augmentedMessages = [
          ...messages,
          { role: "user" as const, content: augmentedContext + (typeof enrichedQuestion === "string" ? enrichedQuestion : question) },
        ];
        const councilResponse = await askCouncil(councilMembers, master, augmentedMessages, maxTokens, effectiveRounds);
        verdict = councilResponse.verdict;
        finalOpinions = [{ name: "Socratic Q&A", opinion: qa.map(({ q, a }) => `Q: ${q}\nA: ${a}`).join("\n\n") }, ...councilResponse.opinions];
        tokensUsed = councilResponse.metrics?.totalTokens ?? 0;
      } else if (deliberation_mode === "red_blue") {
        const result = await runRedBlueDebate(question, councilMembers);
        verdict = result.judgeVerdict;
        // P8-65: Track tokens for all deliberation paths
        tokensUsed = (result as { totalTokens?: number }).totalTokens ?? 0;
        finalOpinions = [
          { name: "Red Team (FOR)", opinion: result.redArguments },
          { name: "Blue Team (AGAINST)", opinion: result.blueArguments },
          { name: "Judge", opinion: result.judgeVerdict },
        ];
      } else if (deliberation_mode === "hypothesis") {
        const result = await runHypothesisRefinement(question, councilMembers);
        verdict = result.finalSynthesis;
        // P8-65: Track tokens for all deliberation paths
        tokensUsed = (result as { totalTokens?: number }).totalTokens ?? 0;
        finalOpinions = result.rounds.flatMap((r) =>
          r.hypotheses.map((h) => ({ name: `${h.agent} [${r.phase} R${r.round}]`, opinion: h.text }))
        );
      } else if (deliberation_mode === "confidence") {
        const result = await runConfidenceCalibration(question, councilMembers);
        verdict = result.weightedSynthesis;
        // P8-65: Track tokens for all deliberation paths
        tokensUsed = (result as { totalTokens?: number }).totalTokens ?? 0;
        finalOpinions = result.opinions.map((o) => ({
          name: o.agent,
          opinion: o.opinion,
          confidence: o.confidence,
          reasoning: o.reasoning,
        }));
      } else {
        const councilResponse = await askCouncil(councilMembers, master, currentMessages, maxTokens, effectiveRounds);
        verdict = councilResponse.verdict;
        finalOpinions = councilResponse.opinions;
        tokensUsed = councilResponse.metrics?.totalTokens ?? 0;
      }

      if (traceCtx) {
        for (const op of finalOpinions) {
          addStep(traceCtx, { name: op.name || "agent", type: "llm_call", input: question.slice(0, 500), output: (op.opinion || "").slice(0, 500), tokens: 0, latencyMs: 0 });
        }
        addStep(traceCtx, { name: "synthesis", type: "synthesis", input: question.slice(0, 500), output: verdict.slice(0, 500), tokens: tokensUsed, latencyMs: Date.now() - councilStart });
      }

      await setCachedResponse(question, councilMembers, master, messages, verdict, finalOpinions, userId);
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
        opinions: finalOpinions as unknown as Record<string, unknown>,
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
  fastify.post("/stream", { preHandler: [fastifyOptionalAuth, fastifyAnonGuard, fastifyCheckQuota, validateAskBody] }, async (request, reply) => {
    const startTime = Date.now();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    try {
      const { question, conversationId, summon, maxTokens, rounds = 1, context, mode } = request.body as AskBody;
      const upload_ids: string[] | undefined = (request.body as AskBody).upload_ids;
      const kb_id: string | undefined = (request.body as AskBody).kb_id;
      const deliberation_mode: ReasoningMode = (request.body as AskBody).deliberation_mode ?? "standard";

      let effectiveSummon: string = summon || "default";
      let effectiveMembers = (request.body as AskBody).members;
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
        // P3-18: Use undefined instead of [] — empty array is truthy
        effectiveMembers = undefined;
        effectiveRounds = 0; // Skip rounds
      }

      const resolvedMembers: CouncilMemberInput[] = (effectiveMembers || getDefaultMembers()).map((m) => {
        if (!m.apiKey) m.apiKey = resolveApiKey(m as ApiKeyResolutionInput);
        return m as CouncilMemberInput;
      });

      const inputMaster = (request.body as AskBody).master || getDefaultMaster();
      if (!inputMaster.apiKey) inputMaster.apiKey = resolveApiKey(inputMaster as ApiKeyResolutionInput);
      const master = inputMaster as Provider;

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

      // P3-20: Use userId check instead of 0 to prevent anonymous access to user 0's files
      const fileContext = userId ? await loadFileContext(upload_ids || [], userId) : "";
      let ragContext = "";
      if (kb_id && userId) {
        const rag = await loadRAGContext(userId, question, kb_id);
        ragContext = rag.context;
      }

      const questionWithContext = buildEnrichedQuestion(question, fileContext, ragContext, memoryContext, context);
      const currentMessages = [...messages, { role: "user" as const, content: questionWithContext }] as Message[];

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
      let finalOpinions: { name: string; opinion: string; [key: string]: unknown }[] = [];
      let tokensUsed = 0;

      const cached = await getCachedResponse(question, councilMembers, master, messages, userId);
      if (cached) {
        isCacheHit = true;
        finalVerdict = cached.verdict;
        finalOpinions = cached.opinions;

        // P8-63: Detect and save artifacts from cached verdict (was previously discarded)
        let cachedArtifactId: string | undefined;
        if (cached.verdict && userId) {
          const detected = detectArtifact(cached.verdict);
          if (detected) {
            cachedArtifactId = await saveArtifact(userId, effectiveConversationId || null, detected);
          }
        }

        reply.raw.write(`data: ${JSON.stringify({
          type: "done",
          cached: true,
          verdict: cached.verdict,
          opinions: cached.opinions,
          conversationId: effectiveConversationId ?? null,
          router: routerDecision ? formatRouterMetadata(routerDecision) : undefined,
          artifact_id: cachedArtifactId,
        })}\n\n`);
        reply.raw.end();
      } else {
        logger.info({ question: question.slice(0, 80), memberCount: councilMembers.length, summon: effectiveSummon, rounds: effectiveRounds, deliberation_mode }, "Council SSE stream started");

        const emitEvent = (type: string, data: Record<string, unknown>) => {
          if (!controller.signal.aborted) {
            const payload = type === "done"
              ? { ...data, conversationId: effectiveConversationId ?? null }
              : data;
            reply.raw.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
          }
        };

        if (deliberation_mode !== "standard") {
          // Emit a phase event so the frontend can show a spinner
          emitEvent("mode_start", { mode: deliberation_mode });

          if (deliberation_mode === "socratic") {
            const { augmentedContext, qa } = await runSocraticPrelude(question, councilMembers);
            emitEvent("mode_phase", { phase: "socratic_prelude", qa });
            const augmentedMessages = [
              ...messages,
              { role: "user" as const, content: augmentedContext + questionWithContext },
            ];
            finalVerdict = await streamCouncil(
              councilMembers, master, augmentedMessages,
              (event, data) => {
                if (event === "opinion") finalOpinions.push(data as { name: string; opinion: string });
                if (event === "done") tokensUsed = (data as { tokensUsed?: number }).tokensUsed || 0;
                emitEvent(event, data);
              },
              maxTokens, effectiveRounds, controller.signal
            );
          } else if (deliberation_mode === "red_blue") {
            const result = await runRedBlueDebate(question, councilMembers);
            emitEvent("mode_phase", { phase: "red_blue_complete", redArguments: result.redArguments, blueArguments: result.blueArguments });
            finalVerdict = result.judgeVerdict;
            finalOpinions = [
              { name: "Red Team (FOR)", opinion: result.redArguments },
              { name: "Blue Team (AGAINST)", opinion: result.blueArguments },
              { name: "Judge", opinion: result.judgeVerdict },
            ];
            emitEvent("done", { verdict: finalVerdict, opinions: finalOpinions, router: routerDecision ? formatRouterMetadata(routerDecision) : undefined });
          } else if (deliberation_mode === "hypothesis") {
            const result = await runHypothesisRefinement(question, councilMembers);
            for (const round of result.rounds) {
              emitEvent("mode_phase", { phase: "hypothesis_round", round });
            }
            finalVerdict = result.finalSynthesis;
            finalOpinions = result.rounds.flatMap((r) =>
              r.hypotheses.map((h) => ({ name: `${h.agent} [${r.phase} R${r.round}]`, opinion: h.text }))
            );
            emitEvent("done", { verdict: finalVerdict, opinions: finalOpinions, router: routerDecision ? formatRouterMetadata(routerDecision) : undefined });
          } else if (deliberation_mode === "confidence") {
            const result = await runConfidenceCalibration(question, councilMembers);
            emitEvent("mode_phase", { phase: "calibrated_opinions", opinions: result.opinions });
            finalVerdict = result.weightedSynthesis;
            finalOpinions = result.opinions.map((o) => ({
              name: o.agent, opinion: o.opinion, confidence: o.confidence, reasoning: o.reasoning,
            }));
            emitEvent("done", { verdict: finalVerdict, opinions: finalOpinions, router: routerDecision ? formatRouterMetadata(routerDecision) : undefined });
          }

          reply.raw.end();
        } else {
          finalVerdict = await streamCouncil(
            councilMembers,
            master,
            currentMessages,
            (event, data) => {
              if (event === "opinion") finalOpinions.push(data as { name: string; opinion: string });
              if (event === "done") tokensUsed = (data as { tokensUsed?: number }).tokensUsed || 0;
              emitEvent(event, data);
            },
            maxTokens,
            effectiveRounds,
            controller.signal
          );

          reply.raw.end();
        }

        await setCachedResponse(question, councilMembers, master, messages, finalVerdict, finalOpinions, userId);

        if (effectiveConversationId && userId && finalVerdict) {
          await createChat({
            userId,
            conversationId: effectiveConversationId,
            question,
            verdict: finalVerdict,
            opinions: finalOpinions as unknown as Record<string, unknown>,
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

    } catch (e: unknown) {
      // P8-62: Send properly formatted SSE error event then close — prevents client from hanging
      const message = e instanceof Error ? e.message : "Internal error";
      logger.error({ err: e }, "SSE stream error");
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: "error", message })}\n\n`);
        reply.raw.end();
      }
    }
  });
};

export default askPlugin;

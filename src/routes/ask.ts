import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { askCouncil } from "../lib/council.js";
import type { Message, Provider } from "../lib/providers.js";
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
import { loadFileContext, loadRAGContext, buildEnrichedQuestion, type FileContext } from "../services/messageBuilder.service.js";
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
import { rooms, roomParticipants } from "../db/schema/rooms.js";
import { and, eq } from "drizzle-orm";
import { anonymousRequests } from "../lib/prometheusMetrics.js";
import { calculateCost } from "../lib/cost.js";
import { hooks } from "../lib/hooks/hookRegistry.js";
import { checkOutput, BUILTIN_OUTPUT_RULES } from "../lib/guardrails/index.js";
import { buildUserScanners, runScannerPipeline } from "../lib/scanners/contentScanner.js";
import { runPromptFilter } from "../lib/promptFilter.js";
import { compressPrompt } from "../lib/tokenConservation.js";
import { applySpecialisationMode, autoDetectDomain, type SpecialisationDomain } from "../lib/specialisationMode.js";
import { wrapEpistemicSystemPrompt } from "../lib/epistemicTags.js";
import { computeWeather, extractWeatherMetrics } from "../lib/conversationWeather.js";
import { socraticRewrite, isSocraticSynthesisEnabled } from "../lib/socraticSynthesis.js";
import { checkSpendingLimit, recordSpend } from "../lib/spendingLimits.js";
import { selectRelevantSkills, buildSkillContextBlock } from "../lib/skillSelection.js";
import { runSOPWorkflow, SOP_TEMPLATES } from "../lib/sopWorkflow.js";
import { moderateContent } from "../lib/moderation.js";
import { applyVerbosity, adjustMaxTokensForVerbosity, type VerbosityLevel } from "../lib/verbosity.js";
import { retrieveCrossConversationMemory, formatCrossMemoryContext } from "../lib/crossConversationMemory.js";
import { goalDocuments } from "../db/schema/goalDocuments.js";
import { userSettings } from "../db/schema/users.js";
import { generateSessionName } from "../lib/secondaryFlows/sessionNaming.js";
import { updateConversationTitle } from "../services/conversation.service.js";
import { emitToConversation } from "../lib/socket.js";

type AskBody = z.infer<typeof askSchema>;

// Anonymous rate limiting — 5 requests per minute per IP, direct mode only
// Anonymous requests are now tracked in Prometheus metrics
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

  // Track successful anonymous request
  anonymousRequests.inc({ mode, status: "allowed" });
}

function handleCouncilError(err: unknown): never {
  if (err instanceof CouncilServiceError) {
    throw new AppError(400, err.message);
  }
  throw err;
}

// Removed inline fastifyCheckQuota — now imported from middleware/quota.ts

// Fastify preHandler expects async functions — make validateAskBody async.
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
  fastify.post("/", {
    schema: {
      summary: 'Ask the AI council a question',
      tags: ['Ask'],
      body: {
        type: 'object',
        required: ['question'],
        properties: {
          question: { type: 'string', minLength: 1, maxLength: 100000, description: 'The question to ask' },
          conversationId: { type: 'string', description: 'Continue an existing conversation' },
          summon: { type: 'string', description: 'Council composition preset' },
          maxTokens: { type: 'number', description: 'Max tokens for responses' },
          rounds: { type: 'number', minimum: 1, maximum: 10, description: 'Deliberation rounds' },
          context: { type: 'string', description: 'Additional context to inject' },
          mode: { type: 'string', enum: ['direct', 'council', 'auto'], description: 'Processing mode' },
          upload_ids: { type: 'array', items: { type: 'string' }, description: 'File upload IDs to include' },
          kb_id: { type: 'string', description: 'Knowledge base ID for RAG' },
          repo_id: { type: 'string', description: 'Code repository ID for code-aware chat' },
          deliberation_mode: { type: 'string', enum: ['standard', 'socratic', 'red_blue', 'hypothesis', 'confidence'], description: 'Reasoning mode' },
          members: { type: 'array', items: { type: 'object' }, description: 'Custom council members' },
          master: { type: 'object', description: 'Master synthesizer config' },
          userConfig: { type: 'object', description: 'User-defined council composition' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            conversationId: { type: 'string', nullable: true },
            verdict: { type: 'string', description: 'Synthesized answer from the council' },
            opinions: { type: 'array', items: { type: 'object' }, description: 'Individual agent opinions' },
            latency: { type: 'number', description: 'Response latency in ms' },
            cacheHit: { type: 'boolean' },
            router: { type: 'object', nullable: true, description: 'Auto-router metadata' },
            citations: { type: 'array', nullable: true, items: { type: 'object' } },
            artifact_id: { type: 'string', nullable: true },
            metrics: { type: 'object', nullable: true, properties: { totalTokens: { type: 'number' }, totalCost: { type: 'number' }, hallucinationCount: { type: 'number' } } },
          },
        },
      },
    },
    preHandler: [fastifyOptionalAuth, fastifyAnonGuard, fastifyCheckQuota, validateAskBody],
  }, async (request, _reply) => {
    const startTime = Date.now();

    const { question, conversationId, summon, maxTokens, rounds = 1, context, mode, userConfig } = request.body as AskBody;
    // Cap rounds to safe range to prevent excessive deliberation cycles
    const safeRounds = Math.min(Math.max(1, Number.isFinite(rounds) ? rounds : 1), 10);
    let upload_ids: string[] | undefined = (request.body as AskBody).upload_ids;
    // Cap upload_ids to prevent unbounded file loading
    if (upload_ids && upload_ids.length > 50) upload_ids.length = 50;
    const kb_id: string | undefined = (request.body as AskBody).kb_id;
    const deliberation_mode: ReasoningMode = (request.body as AskBody).deliberation_mode ?? "standard";
    // Phase 1.17 — God Mode: raw parallel view, skip synthesis (smol-ai/GodMode)
    const god_mode: boolean = !!(request.body as AskBody).god_mode;
    // Phase 1.20 — SOP template selection (MetaGPT pattern)
    const sop_template: string | undefined = (request.body as any).sop_template;
    // Phase 1.24 — Response verbosity control (Open WebUI per-chat override)
    const verbosity: VerbosityLevel | undefined = (request.body as any).verbosity;

    // Broadcast user message to room members immediately (before AI processes)
    if (conversationId) {
      emitToConversation(conversationId, "user:message", {
        question,
        userId: request.userId,
        username: (request as any).username,
        timestamp: Date.now(),
      });
    }

    let effectiveSummon: string = summon || "default";
    let effectiveMembers = (request.body as AskBody).members;
    let routerDecision: ReturnType<typeof classifyQuery> | null = null;
    let effectiveRounds = safeRounds;

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
      // Use undefined instead of [] — empty array is truthy and
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

    // Phase 1.16 — Spending limit check (Onyx EE pattern)
    if (userId) {
      const spendCheck = await checkSpendingLimit(userId);
      if (!spendCheck.allowed) {
        return reply.code(402).send({ error: "spending_limit_exceeded", detail: spendCheck.reason });
      }
    }

    // Phase 1.1 — Content scanners (LLM Guard scanner pattern, off by default)
    // Load user's content filter settings and run scanner pipeline on input
    let contentScanners = [];
    let adversarialRewrite = false;
    let tokenConservationMode = false;
    let uSettings: Record<string, unknown> = {};
    if (userId) {
      const [settingsRow] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
      uSettings = (settingsRow?.settings as Record<string, unknown>) ?? {};
      contentScanners = buildUserScanners({
        blockProfanity: !!uSettings.blockProfanity,
        blockAdultContent: !!uSettings.blockAdultContent,
      });
      adversarialRewrite = !!uSettings.adversarialRewrite;
      tokenConservationMode = !!uSettings.tokenConservationMode;
      // Phase 1.10 — epistemic tagging: apply to master prompt
      if (uSettings.epistemicStatusTags && master) {
        master = { ...master, systemPrompt: wrapEpistemicSystemPrompt(master.systemPrompt ?? "") };
      }
    }    if (contentScanners.length > 0) {
      const scanResult = runScannerPipeline(question, contentScanners);
      if (!scanResult.isValid && scanResult.maxRiskScore >= 1.0) {
        const blocked = scanResult.results.find(r => !r.isValid);
        reply.code(400).send({ error: "Content policy violation", detail: blocked?.detail });
        return;
      }
      // Replace question with sanitized version (redacted profanity etc.)
      if (scanResult.sanitized !== question) {
        (request.body as AskBody).question = scanResult.sanitized;
      }
    }

    // Phase 1.21 — Automated Moderation (LibreChat pattern)
    {
      const modResult = await moderateContent(question);
      if (modResult.blocked) {
        return reply.code(400).send({
          error: "content_policy_violation",
          detail: `Content flagged by moderation (${modResult.topCategory}: ${(modResult.topScore * 100).toFixed(0)}%)`,
        });
      }
    }

    // Phase 1.4 — Adversarial prompt filter (Rebuff two-stage pattern, off by default)
    // Stage 1 runs on every request (zero cost); Stage 2 (LLM rewrite) only when opt-in
    {
      const filterResult = await runPromptFilter(question, {
        blockThreshold: 0.9,
        enableRewrite: adversarialRewrite,
        rewriteProvider: adversarialRewrite ? master ?? councilMembers[0] : undefined,
      });

      if (!filterResult.passed) {
        reply.code(400).send({
          error: "Prompt injection detected",
          riskScore: filterResult.riskScore,
          patterns: filterResult.patterns,
        });
        return;
      }
      if (filterResult.processedInput !== question) {
        (request.body as AskBody).question = filterResult.processedInput;
      }
    }

    // Phase 1.5 — Token conservation mode (LLMLingua, MIT, Microsoft)
    // Silently reduces token spend. Runs only when user enables tokenConservationMode.
    if (tokenConservationMode) {
      const currentQ = (request.body as AskBody).question;
      const compression = await compressPrompt(currentQ, { targetRatio: 0.6 });
      if (compression.method !== "none") {
        (request.body as AskBody).question = compression.compressed;
        logger.info({ method: compression.method, ratio: compression.compressionRatio }, "Token conservation applied");
      }
    }
    let messages: Message[] = [];

    if (effectiveConversationId) {
      // Verify requesting user owns the conversation OR is a room participant
      const convo = await findConversationById(effectiveConversationId, userId ?? undefined);
      if (!convo) {
        throw new AppError(404, "Conversation not found or does not belong to you");
      }
      if (userId && convo.userId && convo.userId !== userId) {
        // Not the owner — check if it's a room conversation this user has joined
        const [roomRow] = await db
          .select({ id: rooms.id })
          .from(rooms)
          .innerJoin(roomParticipants, and(
            eq(roomParticipants.roomId, rooms.id),
            eq(roomParticipants.userId, userId),
          ))
          .where(and(eq(rooms.conversationId, effectiveConversationId), eq(rooms.isActive, true)))
          .limit(1);
        if (!roomRow) {
          throw new AppError(403, "Access denied: conversation belongs to another user");
        }
      }
      messages = await getRecentHistory(effectiveConversationId);
    }

    const councilMembers = await prepareCouncilWithArchetypes(resolvedMembers, effectiveSummon, userId);

    // Phase 1.2 — per-member toggle (LibreChat pause/resume pattern)
    // disabled_members lists provider names to skip this round.
    // Spec: member finishes current response then stops; on re-enable it receives
    // all missed user messages + round consensus for catch-up (handled client-side via history).
    const { disabled_members } = request.body as AskBody;
    const activeCouncilMembers = disabled_members?.length
      ? councilMembers.filter(m => !disabled_members.includes(m.name))
      : councilMembers;
    // Guard: if all members are disabled, fall back to full council
    let effectiveCouncilMembers = activeCouncilMembers.length > 0 ? activeCouncilMembers : councilMembers;

    // Phase 1.6 — Specialisation mode (CrewAI role-based specialisation + AutoGen domain-adaptive pattern)
    // Reads specialisationDomain from user settings ("auto" = keyword-detect from question)
    {
      const rawDomain = (userId
        ? (await db.select({ settings: userSettings.settings }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
            .then(r => (r[0]?.settings as Record<string, unknown>)?.specialisationDomain as SpecialisationDomain))
        : undefined) ?? "auto";
      const domain: SpecialisationDomain = rawDomain === "auto"
        ? autoDetectDomain((request.body as AskBody).question)
        : rawDomain;
      if (domain !== "auto") {
        effectiveCouncilMembers = applySpecialisationMode(effectiveCouncilMembers, domain);
      }
    }

    // Phase 1.24 — Apply verbosity control (Open WebUI per-chat override)
    if (verbosity && master) {
      master = { ...master, systemPrompt: applyVerbosity(master.systemPrompt ?? "", verbosity) };
    }
    const effectiveMaxTokens = verbosity ? adjustMaxTokensForVerbosity(maxTokens, verbosity) : maxTokens;

    // Phase 2.8 — Goal document context injection (Cursor .cursorrules / CLAUDE.md pattern)
    // Active goal document is silently prepended to master system prompt
    if (userId && master) {
      const [goalDoc] = await db
        .select({ content: goalDocuments.content, title: goalDocuments.title })
        .from(goalDocuments)
        .where(and(eq(goalDocuments.userId, userId), eq(goalDocuments.isActive, true)))
        .limit(1);
      if (goalDoc) {
        const goalPrefix = `[USER GOAL CONTEXT — "${goalDoc.title}"]\n${goalDoc.content}\n[/USER GOAL CONTEXT]\n\n`;
        master = { ...master, systemPrompt: goalPrefix + (master.systemPrompt ?? "") };
      }
    }
    if (effectiveConversationId) {
      const relevantChats = await retrieveRelevantContext(effectiveConversationId, question, 3);
      memoryContext = formatContextForInjection(relevantChats);
    }

    // Reject anonymous users for file loading instead of falling back to user 0.
    // userId 0 could access another user's data. Skip file loading for unauthenticated users.
    const fileContext = userId ? await loadFileContext(upload_ids || [], userId) : { text_documents: [], image_blocks: [] } as FileContext;
    let ragContext = "";
    let ragCitations: { source: string; score: number }[] = [];
    if (kb_id && userId) {
      const dateFrom = (request.body as AskBody & { dateFrom?: string }).dateFrom;
      const dateTo = (request.body as AskBody & { dateTo?: string }).dateTo;
      const rag = await loadRAGContext(userId, question, kb_id, undefined, { from: dateFrom, to: dateTo });
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
              eq(codeRepositories.userId, userId),
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

    // Phase 1.19 — Intelligent Skill Selection (AnythingLLM pattern)
    // Auto-select relevant tools from user's skill library and inject as context
    let skillContextBlock = "";
    if (userId) {
      const relevantSkills = await selectRelevantSkills(userId, question);
      skillContextBlock = buildSkillContextBlock(relevantSkills);
    }

    // Phase 2.7 — Cross-Conversation Memory Retrieval (mem0/Zep pattern)
    // Retrieve relevant memories from previous conversations via keyword Jaccard
    let crossMemoryBlock = "";
    if (userId) {
      const crossMemories = await retrieveCrossConversationMemory(userId, question);
      crossMemoryBlock = formatCrossMemoryContext(crossMemories);
    }

    const finalEnrichedQuestion = [enrichedQuestion, skillContextBlock, crossMemoryBlock]
      .filter(Boolean)
      .join("\n");

    const currentMessages = [...messages, { role: "user" as const, content: finalEnrichedQuestion }] as Message[];

    // Hook: pre:query — before retrieval/search
    await hooks.run('pre:query', { stage: 'pre:query', userId: userId ?? undefined, query: question });

    // Hook: post:retrieval — after documents retrieved (RAG citations available)
    if (ragCitations.length > 0) {
      await hooks.run('post:retrieval', { stage: 'post:retrieval', documents: ragCitations, query: question });
    }

    // Start trace for observability
    const traceCtx = userId
      ? startTrace(userId, "chat", { conversationId: effectiveConversationId || undefined })
      : null;

    // Pass userId to scope cache per tenant
    // Quota is already decremented by fastifyCheckQuota preHandler —
    // cache hits DO count against quota (request was counted before reaching this code).
    const cached = await getCachedResponse(question, effectiveCouncilMembers, master, messages, userId);

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
      logger.info({ question: question.slice(0, 80), memberCount: effectiveCouncilMembers.length, summon: effectiveSummon, rounds: effectiveRounds, deliberation_mode }, "Council ask started");

      const councilStart = Date.now();

      // Phase 1.20 — SOP workflow (MetaGPT pattern) takes priority if sop_template provided
      if (sop_template && SOP_TEMPLATES[sop_template]) {
        const sopResult = await runSOPWorkflow(question, effectiveCouncilMembers, SOP_TEMPLATES[sop_template], effectiveMaxTokens);
        verdict = sopResult.finalSynthesis;
        tokensUsed = sopResult.totalTokens;
        finalOpinions = sopResult.steps.map(s => ({ name: s.step, opinion: s.output }));
      } else if (deliberation_mode === "socratic") {
        const { augmentedContext, qa } = await runSocraticPrelude(question, effectiveCouncilMembers);
        const augmentedMessages = [
          ...messages,
          { role: "user" as const, content: augmentedContext + (typeof enrichedQuestion === "string" ? enrichedQuestion : question) },
        ];
        const councilResponse = await askCouncil(effectiveCouncilMembers, master, augmentedMessages, effectiveMaxTokens, effectiveRounds);
        verdict = councilResponse.verdict;
        finalOpinions = [{ name: "Socratic Q&A", opinion: qa.map(({ q, a }) => `Q: ${q}\nA: ${a}`).join("\n\n") }, ...councilResponse.opinions];
        tokensUsed = councilResponse.metrics?.totalTokens ?? 0;
      } else if (deliberation_mode === "red_blue") {
        const result = await runRedBlueDebate(question, effectiveCouncilMembers);
        verdict = result.judgeVerdict;
        // Track tokens for all deliberation paths
        tokensUsed = (result as { totalTokens?: number }).totalTokens ?? 0;
        finalOpinions = [
          { name: "Red Team (FOR)", opinion: result.redArguments },
          { name: "Blue Team (AGAINST)", opinion: result.blueArguments },
          { name: "Judge", opinion: result.judgeVerdict },
        ];
      } else if (deliberation_mode === "hypothesis") {
        const result = await runHypothesisRefinement(question, effectiveCouncilMembers);
        verdict = result.finalSynthesis;
        // Track tokens for all deliberation paths
        tokensUsed = (result as { totalTokens?: number }).totalTokens ?? 0;
        finalOpinions = result.rounds.flatMap((r) =>
          r.hypotheses.map((h) => ({ name: `${h.agent} [${r.phase} R${r.round}]`, opinion: h.text }))
        );
      } else if (deliberation_mode === "confidence") {
        const result = await runConfidenceCalibration(question, effectiveCouncilMembers);
        verdict = result.weightedSynthesis;
        // Track tokens for all deliberation paths
        tokensUsed = (result as { totalTokens?: number }).totalTokens ?? 0;
        finalOpinions = result.opinions.map((o) => ({
          name: o.agent,
          opinion: o.opinion,
          confidence: o.confidence,
          reasoning: o.reasoning,
        }));
      } else {
        // Hook: pre:llm — before LLM call
        await hooks.run('pre:llm', { stage: 'pre:llm', query: question, documents: ragCitations.length > 0 ? ragCitations : undefined });
        const councilResponse = await askCouncil(effectiveCouncilMembers, master, currentMessages, effectiveMaxTokens, effectiveRounds);
        // Phase 1.17 — God Mode: skip synthesis, surface raw parallel opinions directly
        if (god_mode) {
          finalOpinions = councilResponse.opinions;
          verdict = finalOpinions.map(o => `**${o.name}:**\n${o.opinion}`).join("\n\n---\n\n");
        } else {
          verdict = councilResponse.verdict;
          finalOpinions = councilResponse.opinions;
        }
        tokensUsed = councilResponse.metrics?.totalTokens ?? 0;
        // Hook: post:llm — after LLM response
        await hooks.run('post:llm', { stage: 'post:llm', response: verdict });
      }

      if (traceCtx) {
        for (const op of finalOpinions) {
          addStep(traceCtx, { name: op.name || "agent", type: "llm_call", input: question.slice(0, 500), output: (op.opinion || "").slice(0, 500), tokens: 0, latencyMs: 0 });
        }
        addStep(traceCtx, { name: "synthesis", type: "synthesis", input: question.slice(0, 500), output: verdict.slice(0, 500), tokens: tokensUsed, latencyMs: Date.now() - councilStart });
      }

      await setCachedResponse(question, effectiveCouncilMembers, master, messages, verdict, finalOpinions, userId);
    }

    // End trace
    if (traceCtx) {
      traceCtx.conversationId = effectiveConversationId || undefined;
      try { endTrace(traceCtx); } catch (err) { logger.warn({ err }, "Failed to save trace"); }
    }

    // Phase 1.16 — Record spend after successful council call
    if (userId && tokensUsed > 0) {
      recordSpend(userId, tokensUsed).catch(() => {}); // fire-and-forget, non-blocking
    }

    // Output guardrails — check and possibly redact/block verdict
    if (verdict) {
      const guardrailResult = checkOutput(verdict, BUILTIN_OUTPUT_RULES);
      if (!guardrailResult.passed) {
        logger.warn({ reason: guardrailResult.blockedReason }, "Output guardrail blocked verdict");
        verdict = `[Response blocked by content policy: ${guardrailResult.blockedReason}]`;
      } else if (guardrailResult.processedText !== verdict) {
        verdict = guardrailResult.processedText;
      }
      // Phase 1.1 — run output through user's content scanners too
      if (contentScanners.length > 0) {
        const outScan = runScannerPipeline(verdict, contentScanners);
        if (outScan.sanitized !== verdict) verdict = outScan.sanitized;
      }
    }

    // Citation formatting — append sources to verdict if RAG citations exist
    if (ragCitations.length > 0 && verdict) {
      const sourcesBlock = ragCitations
        .map((c, i) => `[${i + 1}] ${c.source}`)
        .join("\n");
      verdict = `${verdict}\n\n**Sources:**\n${sourcesBlock}`;
    }

    // Phase 1.14 — Socratic synthesis rewrite (Khanmigo pattern)
    // Rewrites verdict as guided questions when user wants to discover the answer themselves
    if (verdict && effectiveCouncilMembers.length > 0 && isSocraticSynthesisEnabled(deliberation_mode, uSettings)) {
      verdict = await socraticRewrite(verdict, question, effectiveCouncilMembers[0]);
    }

    const isNewConversation = !conversationId && !!userId;

    if (userId) {
      if (!effectiveConversationId) {
        const newConvo = await createConversation({
          userId,
          title: question.slice(0, 50) + (question.length > 50 ? "..." : "")
        });
        effectiveConversationId = newConvo.id;
      }

      // Estimate input/output token split (council aggregates total; estimate 60% in / 40% out)
      const inputTokensEst = isCacheHit ? 0 : Math.round(tokensUsed * 0.6);
      const outputTokensEst = isCacheHit ? 0 : tokensUsed - inputTokensEst;
      // Use master provider/model for cost estimation; fall back to generic estimate
      const costUsd = calculateCost(
        master.provider || "openai",
        master.model || "gpt-4o",
        inputTokensEst,
        outputTokensEst,
      );
      const costUsdMicro = Math.round(costUsd * 1_000_000);

      await createChat({
        userId,
        conversationId: effectiveConversationId,
        question,
        verdict,
        opinions: finalOpinions as unknown as Record<string, unknown>,
        durationMs: Date.now() - startTime,
        tokensUsed,
        inputTokens: inputTokensEst,
        outputTokens: outputTokensEst,
        costUsdMicro,
        cacheHit: isCacheHit,
      });

      await updateDailyUsage({ userId, tokensUsed, isCacheHit });

      // Broadcast AI response to all users in the conversation room
      if (effectiveConversationId) {
        emitToConversation(effectiveConversationId, "ai:response", {
          verdict,
          opinions: finalOpinions,
          conversationId: effectiveConversationId,
          timestamp: Date.now(),
        });
      }

      // Session auto-naming: fire-and-forget on the first message of a new conversation
      if (isNewConversation && effectiveConversationId) {
        const namingMessages = [
          { role: "user" as const, content: question },
          { role: "assistant" as const, content: verdict },
        ];
        const convIdForNaming = effectiveConversationId;
        const userIdForNaming = userId;
        generateSessionName(namingMessages)
          .then((name) => updateConversationTitle(convIdForNaming, userIdForNaming, name))
          .catch(() => {});
      }
    }

    // Detect and save artifacts from the verdict
    let artifactId: string | undefined;
    if (verdict && userId) {
      const detected = detectArtifact(verdict);
      if (detected) {
        artifactId = await saveArtifact(userId, effectiveConversationId || null, detected);
      }
    }

    // Phase 1.11 — Conversation Weather (Argilla data quality indicator pattern)
    const weatherMetrics = extractWeatherMetrics(
      finalOpinions.map(o => ({ opinion: o.opinion ?? "", confidence: o.confidence })),
      finalOpinions.length > 1 ? undefined : undefined,
    );
    const weather = computeWeather(weatherMetrics);

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
      metrics: (tokensUsed > 0 || isCacheHit) ? { totalTokens: tokensUsed, totalCost: 0, hallucinationCount: 0 } : undefined,
      weather,
      god_mode: god_mode || undefined,
    };
  });

  // POST /stream - SSE streaming endpoint
  fastify.post("/stream", {
    schema: {
      summary: 'Ask the AI council with SSE streaming response',
      tags: ['Ask'],
      body: {
        type: 'object',
        required: ['question'],
        properties: {
          question: { type: 'string', minLength: 1, maxLength: 100000 },
          conversationId: { type: 'string' },
          summon: { type: 'string' },
          maxTokens: { type: 'number' },
          rounds: { type: 'number', minimum: 1, maximum: 10 },
          context: { type: 'string' },
          mode: { type: 'string', enum: ['direct', 'council', 'auto'] },
          upload_ids: { type: 'array', items: { type: 'string' } },
          kb_id: { type: 'string' },
          deliberation_mode: { type: 'string', enum: ['standard', 'socratic', 'red_blue', 'hypothesis', 'confidence'] },
          members: { type: 'array', items: { type: 'object' } },
          master: { type: 'object' },
        },
      },
      response: {
        200: { type: 'string', description: 'Server-Sent Events stream (text/event-stream)' },
      },
    },
    preHandler: [fastifyOptionalAuth, fastifyAnonGuard, fastifyCheckQuota, validateAskBody],
  }, async (request, reply) => {
    const startTime = Date.now();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    try {
      const { question, conversationId, summon, maxTokens, rounds = 1, context, mode } = request.body as AskBody;
      const upload_ids: string[] | undefined = (request.body as AskBody).upload_ids;
      // Cap upload_ids in stream handler too
      if (upload_ids && upload_ids.length > 50) upload_ids.length = 50;
      const kb_id: string | undefined = (request.body as AskBody).kb_id;
      const deliberation_mode: ReasoningMode = (request.body as AskBody).deliberation_mode ?? "standard";

      // Broadcast user message to room members immediately (before AI processes)
      if (conversationId) {
        emitToConversation(conversationId, "user:message", {
          question,
          userId: request.userId,
          username: (request as any).username,
          timestamp: Date.now(),
        });
      }

      let effectiveSummon: string = summon || "default";
      let effectiveMembers = (request.body as AskBody).members;
      let routerDecision: ReturnType<typeof classifyQuery> | null = null;
      // Cap rounds in stream handler too
      let effectiveRounds = Math.min(Math.max(1, Number.isFinite(rounds) ? rounds : 1), 10);

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
        // Use undefined instead of [] — empty array is truthy
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
        if (userId && convo.userId && convo.userId !== userId) {
          // Not the owner — check if it's a room conversation this user has joined
          const [roomRow] = await db
            .select({ id: rooms.id })
            .from(rooms)
            .innerJoin(roomParticipants, and(
              eq(roomParticipants.roomId, rooms.id),
              eq(roomParticipants.userId, userId),
            ))
            .where(and(eq(rooms.conversationId, effectiveConversationId), eq(rooms.isActive, true)))
            .limit(1);
          if (!roomRow) {
            reply.raw.write(`data: ${JSON.stringify({ type: "error", message: "Access denied: conversation belongs to another user" })}\n\n`);
            reply.raw.end();
            return;
          }
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

      // Use userId check instead of 0 to prevent anonymous access to user 0's files
      const fileContext = userId ? await loadFileContext(upload_ids || [], userId) : { text_documents: [], image_blocks: [] } as FileContext;
      let ragContext = "";
      if (kb_id && userId) {
        const dateFrom = (request.body as AskBody & { dateFrom?: string }).dateFrom;
        const dateTo = (request.body as AskBody & { dateTo?: string }).dateTo;
        const rag = await loadRAGContext(userId, question, kb_id, undefined, { from: dateFrom, to: dateTo });
        ragContext = rag.context;
      }

      const questionWithContext = buildEnrichedQuestion(question, fileContext, ragContext, memoryContext, context);
      const currentMessages = [...messages, { role: "user" as const, content: questionWithContext }] as Message[];

      // Hook: pre:query — before retrieval/search
      await hooks.run('pre:query', { stage: 'pre:query', userId: userId ?? undefined, query: question });

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

      const cached = await getCachedResponse(question, effectiveCouncilMembers, master, messages, userId);
      if (cached) {
        isCacheHit = true;
        finalVerdict = cached.verdict;
        finalOpinions = cached.opinions;

        // Detect and save artifacts from cached verdict (was previously discarded)
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
        logger.info({ question: question.slice(0, 80), memberCount: effectiveCouncilMembers.length, summon: effectiveSummon, rounds: effectiveRounds, deliberation_mode }, "Council SSE stream started");

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
            const { augmentedContext, qa } = await runSocraticPrelude(question, effectiveCouncilMembers);
            emitEvent("mode_phase", { phase: "socratic_prelude", qa });
            const augmentedMessages = [
              ...messages,
              { role: "user" as const, content: augmentedContext + questionWithContext },
            ];
            finalVerdict = await streamCouncil(
              effectiveCouncilMembers, master, augmentedMessages,
              (event, data) => {
                if (event === "opinion") finalOpinions.push(data as { name: string; opinion: string });
                if (event === "done") tokensUsed = (data as { tokensUsed?: number }).tokensUsed || 0;
                emitEvent(event, data);
              },
              maxTokens, effectiveRounds, controller.signal
            );
          } else if (deliberation_mode === "red_blue") {
            const result = await runRedBlueDebate(question, effectiveCouncilMembers);
            emitEvent("mode_phase", { phase: "red_blue_complete", redArguments: result.redArguments, blueArguments: result.blueArguments });
            finalVerdict = result.judgeVerdict;
            finalOpinions = [
              { name: "Red Team (FOR)", opinion: result.redArguments },
              { name: "Blue Team (AGAINST)", opinion: result.blueArguments },
              { name: "Judge", opinion: result.judgeVerdict },
            ];
            emitEvent("done", { verdict: finalVerdict, opinions: finalOpinions, router: routerDecision ? formatRouterMetadata(routerDecision) : undefined });
          } else if (deliberation_mode === "hypothesis") {
            const result = await runHypothesisRefinement(question, effectiveCouncilMembers);
            for (const round of result.rounds) {
              emitEvent("mode_phase", { phase: "hypothesis_round", round });
            }
            finalVerdict = result.finalSynthesis;
            finalOpinions = result.rounds.flatMap((r) =>
              r.hypotheses.map((h) => ({ name: `${h.agent} [${r.phase} R${r.round}]`, opinion: h.text }))
            );
            emitEvent("done", { verdict: finalVerdict, opinions: finalOpinions, router: routerDecision ? formatRouterMetadata(routerDecision) : undefined });
          } else if (deliberation_mode === "confidence") {
            const result = await runConfidenceCalibration(question, effectiveCouncilMembers);
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
            effectiveCouncilMembers,
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

        await setCachedResponse(question, effectiveCouncilMembers, master, messages, finalVerdict, finalOpinions, userId);

        // Output guardrails on stream verdict
        if (finalVerdict) {
          const guardrailResult = checkOutput(finalVerdict, BUILTIN_OUTPUT_RULES);
          if (!guardrailResult.passed) {
            logger.warn({ reason: guardrailResult.blockedReason }, "Stream output guardrail blocked verdict");
            finalVerdict = `[Response blocked by content policy: ${guardrailResult.blockedReason}]`;
          } else if (guardrailResult.processedText !== finalVerdict) {
            finalVerdict = guardrailResult.processedText;
          }
        }

        if (effectiveConversationId && userId && finalVerdict) {
          // Estimate input/output token split for cost tracking
          const streamInputTokensEst = isCacheHit ? 0 : Math.round(tokensUsed * 0.6);
          const streamOutputTokensEst = isCacheHit ? 0 : tokensUsed - streamInputTokensEst;
          const streamCostUsd = calculateCost(
            master.provider || "openai",
            master.model || "gpt-4o",
            streamInputTokensEst,
            streamOutputTokensEst,
          );
          const streamCostUsdMicro = Math.round(streamCostUsd * 1_000_000);

          await createChat({
            userId,
            conversationId: effectiveConversationId,
            question,
            verdict: finalVerdict,
            opinions: finalOpinions as unknown as Record<string, unknown>,
            durationMs: Date.now() - startTime,
            tokensUsed,
            inputTokens: streamInputTokensEst,
            outputTokens: streamOutputTokensEst,
            costUsdMicro: streamCostUsdMicro,
            cacheHit: isCacheHit
          });

          // Broadcast completed AI response to all users in the conversation room
          if (effectiveConversationId) {
            emitToConversation(effectiveConversationId, "ai:response", {
              verdict: finalVerdict,
              opinions: finalOpinions,
              conversationId: effectiveConversationId,
              timestamp: Date.now(),
            });
          }

          // Session auto-naming: fire-and-forget on the first message of a new conversation
          if (!conversationId) {
            const namingMessages = [
              { role: "user" as const, content: question },
              { role: "assistant" as const, content: finalVerdict },
            ];
            const convIdForNaming = effectiveConversationId;
            const userIdForNaming = userId;
            generateSessionName(namingMessages)
              .then((name) => updateConversationTitle(convIdForNaming, userIdForNaming, name))
              .catch(() => {});
          }
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
      // Send properly formatted SSE error event then close — prevents client from hanging
      const message = e instanceof Error ? e.message : "Internal error";
      logger.error({ err: e }, "SSE stream error");
      if (!reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
        reply.raw.end();
      }
    }
  });
};

export default askPlugin;

/**
 * Voice Extended — Phase 6.1 / 6.3 / 6.4
 *
 * 6.1: Voice Conversation Loop
 * 6.3: Council Call Mode — immersive sequential call with real peer debate + SSE streaming
 * 6.4: Live AI Toggle — mute/unmute individual council members mid-call
 *
 * Routes:
 * - GET  /voice/providers
 * - POST /voice/converse
 * - POST /voice/council-call              — start a call session (returns sessionId)
 * - GET  /voice/council-call/stream       — SSE stream for a session (?sessionId=...)
 * - GET  /voice/council-call/sessions/:id — session state (members, muted, transcript)
 * - POST /voice/council-call/sessions/:id/mute    — mute a member (?member=Name)
 * - POST /voice/council-call/sessions/:id/unmute  — unmute a member (?member=Name)
 *
 * Inspired by:
 * - NotebookLM Audio Overview (Google) — multi-voice AI audio discussions.
 * - LiveKit components (Apache 2.0) — participant mute/unmute controls.
 * - Vapi (VapiAI) — voice AI with turn-taking and interruption handling.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── TTS helper ───────────────────────────────────────────────────────────────

type TtsProvider = "openai" | "siliconflow" | "elevenlabs" | "none";

function getActiveTtsProvider(): TtsProvider {
  if (env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (env.OPENAI_API_KEY)     return "openai";
  if ((env as any).XIAOMI_MIMO_API_KEY) return "siliconflow";
  return "none";
}

async function tts(text: string, voice = "nova"): Promise<Buffer | null> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "tts-1", input: text.slice(0, 4096), voice }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = (systemPrompt?: string) => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
  ...(systemPrompt ? { systemPrompt } : {}),
});

async function llm(messages: Array<{ role: string; content: string }>, systemPrompt?: string): Promise<string> {
  const resp = await askProvider(llmProvider(systemPrompt), messages);
  return typeof resp === "string" ? resp : ((resp as any)?.content ?? "");
}

// ─── Voice persona map ────────────────────────────────────────────────────────

const VOICE_MAP: Record<string, string> = {
  Analyst:    "onyx",
  Contrarian: "fable",
  Empath:     "nova",
  Strategist: "alloy",
  Researcher: "echo",
  Critic:     "shimmer",
  default:    "alloy",
};

const ARCHETYPE_PROMPTS: Record<string, string> = {
  Analyst:    "You are the Analyst — data-driven, precise, cite evidence when you can. Keep responses to 2-3 sentences.",
  Contrarian: "You are the Contrarian — challenge assumptions, point out what's being ignored. Keep responses to 2-3 sentences.",
  Empath:     "You are the Empath — focus on human impact, values, and feelings. Keep responses to 2-3 sentences.",
  Strategist: "You are the Strategist — big picture, trade-offs, long-term consequences. Keep responses to 2-3 sentences.",
  Researcher: "You are the Researcher — thorough, reference prior work, ask clarifying questions. Keep responses to 2-3 sentences.",
  Critic:     "You are the Critic — find flaws, risks, and edge cases. Keep responses to 2-3 sentences.",
};

// ─── Session state (6.4) ──────────────────────────────────────────────────────

interface CouncilTurn {
  member: string;
  phase: "opening" | "debate" | "synthesis";
  text: string;
  voice: string;
  audio?: string | null; // base64 or null
  timestamp: number;
}

interface CouncilSession {
  id: string;
  question: string;
  members: string[];
  mutedMembers: Set<string>;
  returnAudio: boolean;
  status: "pending" | "running" | "complete" | "error";
  transcript: CouncilTurn[];
  createdAt: number;
  /** SSE subscribers waiting for new turns */
  subscribers: Array<(event: string) => void>;
}

// In-memory session store (replace with Redis for multi-replica)
const councilSessions = new Map<string, CouncilSession>();

// Cleanup stale sessions older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, session] of councilSessions) {
    if (session.createdAt < cutoff) councilSessions.delete(id);
  }
}, 10 * 60 * 1000);

// ─── Council run logic ────────────────────────────────────────────────────────

function pushTurn(session: CouncilSession, turn: CouncilTurn) {
  session.transcript.push(turn);
  const data = JSON.stringify({ type: "turn", turn });
  for (const sub of session.subscribers) {
    try { sub(`data: ${data}\n\n`); } catch { /* subscriber gone */ }
  }
}

function pushStatus(session: CouncilSession, status: string, extra?: Record<string, unknown>) {
  const data = JSON.stringify({ type: "status", status, ...extra });
  for (const sub of session.subscribers) {
    try { sub(`data: ${data}\n\n`); } catch { /* subscriber gone */ }
  }
}

/**
 * Run a full council call session asynchronously.
 * Phases:
 *   1. Opening — each active member states their position sequentially.
 *   2. Debate  — each active member responds to the previous member's key point.
 *   3. Synthesis — a neutral moderator synthesizes consensus and notes disagreements.
 */
async function runCouncilCall(session: CouncilSession): Promise<void> {
  session.status = "running";

  const { question, members } = session;
  const activeMembersFn = () => members.filter(m => !session.mutedMembers.has(m));

  // ── Phase 1: Opening statements ───────────────────────────────────────────
  pushStatus(session, "phase_start", { phase: "opening" });

  const openingTexts: Record<string, string> = {};

  for (const member of activeMembersFn()) {
    const systemPrompt = ARCHETYPE_PROMPTS[member]
      ?? `You are ${member} on an AI council. Give your position in 2-3 sentences.`;

    const text = await llm(
      [{ role: "user", content: question }],
      systemPrompt,
    );

    openingTexts[member] = text;
    const voice = VOICE_MAP[member] ?? VOICE_MAP.default;
    const audio = session.returnAudio ? (await tts(text, voice))?.toString("base64") ?? null : undefined;

    pushTurn(session, { member, phase: "opening", text, voice, audio, timestamp: Date.now() });
  }

  // ── Phase 2: Debate — each member responds to the previous ───────────────
  const activeAtDebate = activeMembersFn();
  if (activeAtDebate.length >= 2) {
    pushStatus(session, "phase_start", { phase: "debate" });

    for (let i = 0; i < activeAtDebate.length; i++) {
      const member = activeAtDebate[i];
      const prevMember = activeAtDebate[(i - 1 + activeAtDebate.length) % activeAtDebate.length];
      const prevText = openingTexts[prevMember] ?? "";

      const systemPrompt = ARCHETYPE_PROMPTS[member]
        ?? `You are ${member} on an AI council.`;

      const text = await llm(
        [
          {
            role: "user",
            content: `The original question was: "${question}"\n\n${prevMember} said: "${prevText}"\n\nRespond to ${prevMember}'s point from your perspective.`,
          },
        ],
        systemPrompt,
      );

      const voice = VOICE_MAP[member] ?? VOICE_MAP.default;
      const audio = session.returnAudio ? (await tts(text, voice))?.toString("base64") ?? null : undefined;

      pushTurn(session, { member, phase: "debate", text, voice, audio, timestamp: Date.now() });
    }
  }

  // ── Phase 3: Synthesis ────────────────────────────────────────────────────
  const activeAtSynth = activeMembersFn();
  if (activeAtSynth.length > 0) {
    pushStatus(session, "phase_start", { phase: "synthesis" });

    const transcript = session.transcript
      .map(t => `${t.member} (${t.phase}): ${t.text}`)
      .join("\n");

    const synthesisText = await llm(
      [
        {
          role: "user",
          content: `Question: "${question}"\n\nCouncil discussion:\n${transcript}\n\nSummarize the consensus, highlight the key disagreement, and give the council's overall verdict in 3-4 sentences.`,
        },
      ],
      "You are a neutral Council Moderator. Synthesize the discussion into a balanced verdict.",
    );

    const voice = "shimmer";
    const audio = session.returnAudio ? (await tts(synthesisText, voice))?.toString("base64") ?? null : undefined;

    pushTurn(session, {
      member: "Moderator",
      phase: "synthesis",
      text: synthesisText,
      voice,
      audio,
      timestamp: Date.now(),
    });
  }

  session.status = "complete";
  pushStatus(session, "complete", { sessionId: session.id });

  // Close all SSE subscribers
  const done = `data: ${JSON.stringify({ type: "done", sessionId: session.id })}\n\n`;
  for (const sub of session.subscribers) {
    try { sub(done); } catch { /* gone */ }
  }
  session.subscribers = [];
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const converseSchema = z.object({
  text:         z.string().min(1).max(4000),
  voice:        z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).default("nova"),
  returnAudio:  z.boolean().default(false),
  systemPrompt: z.string().max(2000).optional(),
});

const councilCallSchema = z.object({
  question:    z.string().min(1).max(2000),
  members:     z.array(z.string().max(100)).min(1).max(6).optional(),
  returnAudio: z.boolean().default(false),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function voiceExtendedPlugin(app: FastifyInstance) {

  /**
   * GET /voice/providers
   */
  app.get("/voice/providers", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return reply.send({
      success: true,
      stt: {
        provider: env.OPENAI_API_KEY ? "whisper-1" : "none",
        available: !!env.OPENAI_API_KEY,
        endpoint: "POST /api/voice/transcribe",
      },
      tts: {
        provider: getActiveTtsProvider(),
        available: getActiveTtsProvider() !== "none",
        voices: Object.keys(VOICE_MAP).filter(k => k !== "default"),
        endpoint: "POST /api/voice/synthesize",
      },
      features: {
        converse:    "POST /api/voice/converse",
        councilCall: "POST /api/voice/council-call",
        councilStream: "GET /api/voice/council-call/stream?sessionId=<id>",
        muteToggle:  "POST /api/voice/council-call/sessions/:id/mute|unmute",
      },
    });
  });

  /**
   * POST /voice/converse
   */
  app.post("/voice/converse", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = converseSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { text, voice, returnAudio, systemPrompt } = parsed.data;

    const responseText = await llm(
      [{ role: "user", content: text }],
      systemPrompt ?? "You are a helpful AI assistant. Answer concisely — this will be spoken aloud. Avoid markdown formatting.",
    );

    if (!returnAudio) {
      return reply.send({ success: true, input: text, response: responseText });
    }

    const audioBuffer = await tts(responseText, voice);
    return reply.send({
      success: true,
      input: text,
      response: responseText,
      audio: audioBuffer?.toString("base64") ?? null,
      ttsProvider: audioBuffer ? getActiveTtsProvider() : "none",
      voice,
    });
  });

  /**
   * POST /voice/council-call (6.3)
   * Creates a council session, starts the async call, returns sessionId.
   * Use GET /voice/council-call/stream?sessionId=<id> for live SSE events.
   */
  app.post("/voice/council-call", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = councilCallSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { question, members, returnAudio } = parsed.data;
    const councilMembers = members?.length
      ? members
      : ["Analyst", "Contrarian", "Empath", "Strategist"];

    const sessionId = randomUUID();
    const session: CouncilSession = {
      id: sessionId,
      question,
      members: councilMembers,
      mutedMembers: new Set(),
      returnAudio,
      status: "pending",
      transcript: [],
      createdAt: Date.now(),
      subscribers: [],
    };
    councilSessions.set(sessionId, session);

    // Run call asynchronously so the response returns immediately with the sessionId
    runCouncilCall(session).catch(err => {
      session.status = "error";
      const errMsg = err instanceof Error ? err.message : String(err);
      pushStatus(session, "error", { error: errMsg });
    });

    return reply.send({
      success: true,
      sessionId,
      question,
      members: councilMembers,
      streamUrl: `GET /api/voice/council-call/stream?sessionId=${sessionId}`,
      note: "Connect to streamUrl for live SSE events. Use mute/unmute endpoints mid-call.",
    });
  });

  /**
   * GET /voice/council-call/stream (6.3)
   * SSE stream — sends events as each council member speaks.
   * Event types: status, turn, done
   */
  app.get("/voice/council-call/stream", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.query as { sessionId?: string };
    if (!sessionId) return reply.status(400).send({ error: "sessionId query param required" });

    const session = councilSessions.get(sessionId);
    if (!session) return reply.status(404).send({ error: "Session not found" });

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders();

    // Replay already-emitted turns for late joiners
    for (const turn of session.transcript) {
      reply.raw.write(`data: ${JSON.stringify({ type: "turn", turn })}\n\n`);
    }

    if (session.status === "complete") {
      reply.raw.write(`data: ${JSON.stringify({ type: "done", sessionId })}\n\n`);
      reply.raw.end();
      return reply;
    }

    if (session.status === "error") {
      reply.raw.write(`data: ${JSON.stringify({ type: "error", sessionId })}\n\n`);
      reply.raw.end();
      return reply;
    }

    // Subscribe for future events
    const send = (chunk: string) => { reply.raw.write(chunk); };
    session.subscribers.push(send);

    req.raw.on("close", () => {
      session.subscribers = session.subscribers.filter(s => s !== send);
    });

    return reply;
  });

  /**
   * GET /voice/council-call/sessions/:sessionId
   * Returns session state: members, muted set, transcript, status.
   */
  app.get("/voice/council-call/sessions/:sessionId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.params as { sessionId: string };
    const session = councilSessions.get(sessionId);
    if (!session) return reply.status(404).send({ error: "Session not found" });

    return reply.send({
      success: true,
      sessionId: session.id,
      question: session.question,
      status: session.status,
      members: session.members,
      mutedMembers: [...session.mutedMembers],
      turnCount: session.transcript.length,
      transcript: session.transcript.map(t => ({ member: t.member, phase: t.phase, text: t.text, timestamp: t.timestamp })),
    });
  });

  /**
   * POST /voice/council-call/sessions/:sessionId/mute (6.4)
   * Mute a council member. Body: { member: string }
   * The muted member will be skipped in subsequent phases.
   */
  app.post("/voice/council-call/sessions/:sessionId/mute", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.params as { sessionId: string };
    const { member } = req.body as { member?: string };
    if (!member || typeof member !== "string") {
      return reply.status(400).send({ error: "member is required" });
    }

    const session = councilSessions.get(sessionId);
    if (!session) return reply.status(404).send({ error: "Session not found" });
    if (!session.members.includes(member)) {
      return reply.status(400).send({ error: `"${member}" is not a member of this session` });
    }

    session.mutedMembers.add(member);

    // Broadcast mute event to all SSE subscribers
    const data = JSON.stringify({ type: "mute", member, mutedMembers: [...session.mutedMembers] });
    for (const sub of session.subscribers) {
      try { sub(`data: ${data}\n\n`); } catch { /* gone */ }
    }

    return reply.send({
      success: true,
      member,
      mutedMembers: [...session.mutedMembers],
      note: `${member} is muted. They will be excluded from remaining phases.`,
    });
  });

  /**
   * POST /voice/council-call/sessions/:sessionId/unmute (6.4)
   * Unmute a council member. Body: { member: string }
   */
  app.post("/voice/council-call/sessions/:sessionId/unmute", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.params as { sessionId: string };
    const { member } = req.body as { member?: string };
    if (!member || typeof member !== "string") {
      return reply.status(400).send({ error: "member is required" });
    }

    const session = councilSessions.get(sessionId);
    if (!session) return reply.status(404).send({ error: "Session not found" });
    if (!session.members.includes(member)) {
      return reply.status(400).send({ error: `"${member}" is not a member of this session` });
    }

    session.mutedMembers.delete(member);

    const data = JSON.stringify({ type: "unmute", member, mutedMembers: [...session.mutedMembers] });
    for (const sub of session.subscribers) {
      try { sub(`data: ${data}\n\n`); } catch { /* gone */ }
    }

    return reply.send({
      success: true,
      member,
      mutedMembers: [...session.mutedMembers],
      note: `${member} is unmuted. They will participate in remaining phases.`,
    });
  });
}

/**
 * Voice Extended — Phase 6.1: Voice Conversation Loop + Council Call Mode
 *
 * Extends existing voice.ts (STT/TTS) with:
 * - GET /voice/providers — list available STT/TTS providers
 * - POST /voice/converse — text in → LLM → optionally TTS out (full conversation loop)
 * - POST /voice/council-call — multi-voice council call (each member speaks in sequence)
 *
 * Inspired by:
 * - LiveKit (livekit/livekit, Apache 2.0, 12k stars) — real-time audio infrastructure.
 * - Vapi (VapiAI) — voice AI with turn-taking and interruption handling.
 * - NotebookLM Audio Overview (Google) — multi-voice AI discussions.
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── TTS helper (matches voice.ts logic) ─────────────────────────────────────

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

// ─── Schema ───────────────────────────────────────────────────────────────────

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

// ─── Voice persona voice map ──────────────────────────────────────────────────

const VOICE_MAP: Record<string, string> = {
  Analyst:    "onyx",
  Contrarian: "fable",
  Empath:     "nova",
  Strategist: "alloy",
  Researcher: "echo",
  Critic:     "shimmer",
  default:    "alloy",
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function voiceExtendedPlugin(app: FastifyInstance) {

  /**
   * GET /voice/providers
   * Returns available STT/TTS providers based on configured API keys.
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
        converse: "POST /api/voice/converse",
        councilCall: "POST /api/voice/council-call",
      },
    });
  });

  /**
   * POST /voice/converse
   * Text in → LLM response → optionally synthesize to base64 audio.
   * Full conversation loop without a frontend audio pipeline.
   */
  app.post("/voice/converse", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = converseSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { text, voice, returnAudio, systemPrompt } = parsed.data;

    const provider = llmProvider(
      systemPrompt ?? "You are a helpful AI assistant. Answer concisely — this will be spoken aloud. Avoid markdown formatting.",
    );

    const llmResponse = await askProvider(provider, [{ role: "user", content: text }]);
    const responseText = typeof llmResponse === "string" ? llmResponse : (llmResponse as any)?.content ?? "";

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
   * POST /voice/council-call
   * Multi-voice council response — each member speaks in sequence.
   * Inspired by NotebookLM Audio Overview.
   * Returns array of {member, text, audio?} for sequential client-side playback.
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

    const responses = await Promise.all(
      councilMembers.map(async (member) => {
        const memberSystemPrompt = `You are the ${member} on an AI council. Respond to the question from your distinct perspective in 2-3 sentences maximum. Be direct, opinionated, and in character. Begin your response with "${member}: "`;

        const llmResp = await askProvider(
          llmProvider(memberSystemPrompt),
          [{ role: "user", content: question }],
        );
        const text = typeof llmResp === "string" ? llmResp : (llmResp as any)?.content ?? "";
        const voice = VOICE_MAP[member] ?? VOICE_MAP.default;

        if (!returnAudio) return { member, text, voice };

        const audioBuffer = await tts(text, voice);
        return {
          member,
          text,
          voice,
          audio: audioBuffer?.toString("base64") ?? null,
        };
      }),
    );

    return reply.send({
      success: true,
      question,
      responses,
      ttsProvider: getActiveTtsProvider(),
    });
  });
}

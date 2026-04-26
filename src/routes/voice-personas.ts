/**
 * Voice Personas — Phase 6.2: Distinct Voice Per Council Member
 *
 * Inspired by:
 * - Coqui TTS (coqui-ai/TTS, MPL 2.0, 36k stars) — multi-speaker voice synthesis
 *   with voice cloning and fine-grained control.
 * - OpenVoice (myshell-ai/OpenVoice, MIT, 30k stars) — instant voice cloning
 *   with style, accent, and emotion control.
 *
 * Manages voice persona assignments per council archetype:
 * - Default voice per archetype (pitch, speed, tone description)
 * - User-customisable voice assignments
 * - Voice preview (synthesise a sample line in each voice)
 * - ElevenLabs voice ID mapping for multi-voice council calls
 */

import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── Default voice personas ───────────────────────────────────────────────────

interface VoicePersona {
  archetype: string;
  openaiVoice: string;
  elevenLabsVoiceId?: string;
  description: string;
  speed: number;       // 0.25–4.0, default 1.0
  personality: string; // for TTS style prompt
}

const DEFAULT_VOICE_PERSONAS: VoicePersona[] = [
  { archetype: "Analyst",     openaiVoice: "onyx",   description: "Deep, measured, authoritative",  speed: 0.95, personality: "methodical and precise" },
  { archetype: "Contrarian",  openaiVoice: "fable",  description: "Sharp, challenging, direct",      speed: 1.05, personality: "sharp and challenging" },
  { archetype: "Empath",      openaiVoice: "nova",   description: "Warm, thoughtful, expressive",    speed: 0.95, personality: "warm and empathetic" },
  { archetype: "Strategist",  openaiVoice: "alloy",  description: "Confident, clear, decisive",      speed: 1.0,  personality: "confident and strategic" },
  { archetype: "Researcher",  openaiVoice: "echo",   description: "Curious, exploratory, detailed",  speed: 0.9,  personality: "curious and thorough" },
  { archetype: "Critic",      openaiVoice: "shimmer",description: "Precise, analytical, thoughtful", speed: 0.95, personality: "precise and analytical" },
];

// Per-user overrides: userId → Map<archetype, VoicePersona>
const userVoiceOverrides = new Map<number, Map<string, VoicePersona>>();

function getVoicePersona(userId: number, archetype: string): VoicePersona {
  const userOverrides = userVoiceOverrides.get(userId);
  if (userOverrides?.has(archetype)) return userOverrides.get(archetype)!;
  return (
    DEFAULT_VOICE_PERSONAS.find(p => p.archetype.toLowerCase() === archetype.toLowerCase()) ??
    { archetype, openaiVoice: "alloy", description: "Default voice", speed: 1.0, personality: "neutral" }
  );
}

// ─── TTS helper ───────────────────────────────────────────────────────────────

async function synthesizeWithPersona(
  text: string,
  persona: VoicePersona,
): Promise<Buffer | null> {
  // ElevenLabs if configured + voice ID set
  if (env.ELEVENLABS_API_KEY && persona.elevenLabsVoiceId) {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${persona.elevenLabsVoiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text.slice(0, 5000),
          model_id: "eleven_monolingual_v1",
          voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: persona.speed },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (resp.ok) return Buffer.from(await resp.arrayBuffer());
  }

  // OpenAI TTS fallback
  if (env.OPENAI_API_KEY) {
    const resp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text.slice(0, 4096),
        voice: persona.openaiVoice,
        speed: Math.min(Math.max(persona.speed, 0.25), 4.0),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (resp.ok) return Buffer.from(await resp.arrayBuffer());
  }

  return null;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const openaiVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

const updateVoiceSchema = z.object({
  archetype:          z.string().min(1).max(100),
  openaiVoice:        z.enum(openaiVoices).optional(),
  elevenLabsVoiceId:  z.string().max(100).optional(),
  description:        z.string().max(200).optional(),
  speed:              z.number().min(0.25).max(4.0).optional(),
  personality:        z.string().max(200).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function voicePersonasPlugin(app: FastifyInstance) {

  /**
   * GET /voice/personas
   * List all voice personas (defaults + user overrides).
   */
  app.get("/voice/personas", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const archetypes = DEFAULT_VOICE_PERSONAS.map(p => p.archetype);
    const personas = archetypes.map(a => getVoicePersona(userId, a));

    return reply.send({
      success: true,
      personas,
      availableVoices: openaiVoices,
      elevenLabsConfigured: !!env.ELEVENLABS_API_KEY,
    });
  });

  /**
   * PATCH /voice/personas/:archetype
   * Override voice persona for a specific archetype.
   */
  app.patch("/voice/personas/:archetype", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { archetype } = req.params as { archetype: string };
    const parsed = updateVoiceSchema.safeParse({ archetype, ...req.body as object });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const currentPersona = getVoicePersona(userId, archetype);
    const updatedPersona: VoicePersona = {
      ...currentPersona,
      ...Object.fromEntries(
        Object.entries(parsed.data).filter(([, v]) => v !== undefined),
      ),
    };

    if (!userVoiceOverrides.has(userId)) userVoiceOverrides.set(userId, new Map());
    userVoiceOverrides.get(userId)!.set(archetype, updatedPersona);

    return reply.send({ success: true, persona: updatedPersona });
  });

  /**
   * DELETE /voice/personas/:archetype
   * Reset archetype voice to default.
   */
  app.delete("/voice/personas/:archetype", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { archetype } = req.params as { archetype: string };
    userVoiceOverrides.get(userId)?.delete(archetype);

    return reply.send({ success: true, persona: getVoicePersona(userId, archetype) });
  });

  /**
   * POST /voice/personas/:archetype/preview
   * Synthesise a sample line in this archetype's voice.
   */
  app.post("/voice/personas/:archetype/preview", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { archetype } = req.params as { archetype: string };
    const persona = getVoicePersona(userId, archetype);

    const sampleLines: Record<string, string> = {
      Analyst:    "Based on the available data, the optimal approach is clear. Let me walk you through the analysis.",
      Contrarian: "I fundamentally disagree. Have you considered the opposite perspective?",
      Empath:     "I understand your concern. Let me share what I think would be most helpful for you.",
      Strategist: "Here's the plan. Three steps, clear milestones, measurable outcomes.",
      Researcher: "Fascinating question. I found seventeen relevant papers — let me summarise the key findings.",
      Critic:     "The logic holds in part, but there are three significant flaws worth addressing.",
    };

    const sampleText = sampleLines[archetype] ?? `Hello, I am the ${archetype}. This is my voice.`;

    const audioBuffer = await synthesizeWithPersona(sampleText, persona);

    if (!audioBuffer) {
      return reply.status(503).send({
        error: "TTS not configured — set OPENAI_API_KEY or ELEVENLABS_API_KEY",
        persona,
        sampleText,
      });
    }

    return reply.send({
      success: true,
      archetype,
      persona,
      sampleText,
      audio: audioBuffer.toString("base64"),
    });
  });

  /**
   * POST /voice/personas/council-preview
   * Synthesise a short sample from each council member using their assigned voice.
   */
  app.post("/voice/personas/council-preview", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { question = "What is the most important thing to consider here?" } = req.body as { question?: string };

    const previews = await Promise.allSettled(
      DEFAULT_VOICE_PERSONAS.slice(0, 4).map(async (defaultP) => {
        const persona = getVoicePersona(userId, defaultP.archetype);
        const text = `${persona.archetype}: My perspective on this is...`;
        const audio = await synthesizeWithPersona(text, persona);
        return {
          archetype: persona.archetype,
          voice: persona.openaiVoice,
          description: persona.description,
          audio: audio?.toString("base64") ?? null,
        };
      }),
    );

    const results = previews.map(r =>
      r.status === "fulfilled" ? r.value : { error: "TTS failed" },
    );

    return reply.send({ success: true, question, previews: results });
  });
}

// ─── Exported for voice-extended.ts and council-call ─────────────────────────

export { getVoicePersona, synthesizeWithPersona };

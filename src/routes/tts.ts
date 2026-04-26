import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import logger from "../lib/logger.js";

/**
 * Free/self-hosted TTS providers (default — no API key needed):
 *   1. Piper TTS  — https://github.com/rhasspy/piper  (MIT) — fast neural TTS, runs offline
 *      Set PIPER_TTS_URL=http://localhost:5000 to enable
 *   2. edge-tts   — https://github.com/rany2/edge-tts  — Microsoft Edge TTS, no key needed
 *      Set EDGE_TTS_URL=http://localhost:5001 to enable (run: npx edge-tts-server)
 *
 * Paid opt-in (only used when free options are unavailable or explicitly chosen):
 *   3. SiliconFlow / Xiaomi MiMo TTS (XIAOMI_MIMO_API_KEY)
 *   4. OpenAI TTS-1 (OPENAI_API_KEY)
 *   5. Fallback proxy (chatanywhere)
 *
 * Ref:
 *   Piper TTS — https://github.com/rhasspy/piper (MIT, many voices, offline)
 *   edge-tts  — https://github.com/rany2/edge-tts (MIT, free Microsoft Edge TTS)
 */

const ttsSchema = z.object({
  input: z.string().min(1).max(4000)
});

/** Call Piper TTS local API */
async function piperTts(text: string, voice?: string): Promise<ArrayBuffer> {
  const piperUrl = (env as unknown as Record<string, string>).PIPER_TTS_URL;
  if (!piperUrl) throw new Error("PIPER_TTS_URL not set");
  const res = await fetch(`${piperUrl}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: voice ?? "en_US-lessac-medium" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Piper TTS failed: ${res.status}`);
  return res.arrayBuffer();
}

/** Call edge-tts local proxy */
async function edgeTts(text: string, voice?: string): Promise<ArrayBuffer> {
  const edgeUrl = (env as unknown as Record<string, string>).EDGE_TTS_URL;
  if (!edgeUrl) throw new Error("EDGE_TTS_URL not set");
  const res = await fetch(`${edgeUrl}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: voice ?? "en-US-AriaNeural" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`edge-tts failed: ${res.status}`);
  return res.arrayBuffer();
}

const ttsPlugin: FastifyPluginAsync = async (fastify) => {
  /** GET /tts/providers — list available TTS providers and their tier */
  fastify.get("/providers", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    return reply.send({
      providers: [
        { id: "piper",     label: "Piper TTS (local)",       tier: "free",  configured: Boolean((env as unknown as Record<string, string>).PIPER_TTS_URL), url: "https://github.com/rhasspy/piper" },
        { id: "edge-tts",  label: "edge-tts (Microsoft Edge)", tier: "free", configured: Boolean((env as unknown as Record<string, string>).EDGE_TTS_URL), url: "https://github.com/rany2/edge-tts" },
        { id: "siliconflow", label: "SiliconFlow / MiMo TTS", tier: "paid",  configured: Boolean((env as unknown as Record<string, string>).XIAOMI_MIMO_API_KEY), warning: "Uses SiliconFlow credits" },
        { id: "openai",    label: "OpenAI TTS-1",             tier: "paid",  configured: Boolean(env.OPENAI_API_KEY), warning: "Uses OpenAI credits" },
      ],
      note: "Free providers are tried first. Set PIPER_TTS_URL or EDGE_TTS_URL to enable local TTS with no API cost.",
    });
  });

  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const body = request.body as { text?: string; input?: string; voice?: string; speed?: number };
    const rawInput = body.text || body.input;
    if (!rawInput) {
      reply.code(400);
      return { error: "Missing text/input" };
    }

    const parsed = ttsSchema.safeParse({ input: rawInput });
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload length" };
    }

    const voice = body.voice;
    let audioBuffer: ArrayBuffer | undefined;

    // ── 1. Piper TTS (free, local) ──────────────────────────────────────────
    try {
      audioBuffer = await piperTts(parsed.data.input, voice);
      reply.header("Content-Type", "audio/wav");
      return reply.send(Buffer.from(audioBuffer));
    } catch (e1) {
      if ((env as unknown as Record<string, string>).PIPER_TTS_URL) {
        logger.warn({ err: (e1 as Error).message }, "Piper TTS failed, trying next provider");
      }
    }

    // ── 2. edge-tts (free, no key) ──────────────────────────────────────────
    try {
      audioBuffer = await edgeTts(parsed.data.input, voice);
      reply.header("Content-Type", "audio/mpeg");
      return reply.send(Buffer.from(audioBuffer));
    } catch (e2) {
      if ((env as unknown as Record<string, string>).EDGE_TTS_URL) {
        logger.warn({ err: (e2 as Error).message }, "edge-tts failed, trying paid providers");
      }
    }

    // ── 3. Paid providers (require API key) ──────────────────────────────────
    const API_KEY = (env as unknown as Record<string, string>).XIAOMI_MIMO_API_KEY || env.OPENAI_API_KEY;
    if (!API_KEY) {
      reply.code(503);
      return {
        error: "TTS not configured. Set PIPER_TTS_URL (free) or an API key for paid TTS.",
        freeOption: "https://github.com/rhasspy/piper",
      };
    }

    const attemptTTS = async (url: string, payload: Record<string, unknown>) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.arrayBuffer();
    };

    try {
      audioBuffer = await attemptTTS("https://api.siliconflow.cn/v1/audio/speech", {
        model: "xiaomi/MiMo-TTS-v2", input: parsed.data.input, voice: "random"
      });
    } catch (e3: unknown) {
      logger.warn({ err: (e3 as Error).message }, "TTS Attempt 1 (xiaomi/MiMo-TTS-v2) failed");
      try {
        audioBuffer = await attemptTTS("https://api.siliconflow.cn/v1/audio/speech", {
          model: "FunAudioLLM/CosyVoice2-0.5B", input: parsed.data.input, voice: "alex"
        });
      } catch (e4: unknown) {
        logger.warn({ err: (e4 as Error).message }, "TTS Attempt 2 (CosyVoice) failed");
        audioBuffer = await attemptTTS("https://api.chatanywhere.tech/v1/audio/speech", {
          model: "tts-1", input: parsed.data.input, voice: "alloy"
        });
      }
    }

    reply.header("Content-Type", "audio/mpeg");
    return reply.send(Buffer.from(audioBuffer!));
  });
};

export default ttsPlugin;

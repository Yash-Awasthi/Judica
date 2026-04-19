import { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";

const voicePlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

    // POST /api/voice/transcribe — Whisper STT
  fastify.post("/transcribe", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const file = await request.file();
    if (!file) throw new AppError(400, "Audio file required", "NO_AUDIO");

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new AppError(503, "Speech-to-text not configured (OPENAI_API_KEY missing)", "STT_UNAVAILABLE");

    const audioBuffer = await file.toBuffer();
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(audioBuffer)], { type: file.mimetype }), file.filename || "audio.webm");
    formData.append("model", "whisper-1");
    formData.append("language", "en");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error({ status: response.status, body: text }, "Whisper API error");
      throw new AppError(502, "Transcription failed", "STT_FAILED");
    }

    const data = await response.json() as any;
    return { text: data.text };
  });

    // POST /api/voice/synthesize — TTS
  fastify.post("/synthesize", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { text, voice } = request.body as { text?: string; voice?: string };
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      throw new AppError(400, "Text is required", "NO_TEXT");
    }
    if (text.length > 4096) {
      throw new AppError(400, "Text too long (max 4096 chars)", "TEXT_TOO_LONG");
    }

    const apiKey = env.OPENAI_API_KEY || env.XIAOMI_MIMO_API_KEY;
    if (!apiKey) throw new AppError(503, "TTS not configured", "TTS_UNAVAILABLE");

    // Try OpenAI TTS first, then siliconflow fallback
    const attempts = [
      {
        url: "https://api.openai.com/v1/audio/speech",
        body: { model: "tts-1", input: text.trim(), voice: voice || "nova" },
        key: env.OPENAI_API_KEY,
      },
      {
        url: "https://api.siliconflow.cn/v1/audio/speech",
        body: { model: "xiaomi/MiMo-TTS-v2", input: text.trim(), voice: voice || "random" },
        key: env.XIAOMI_MIMO_API_KEY || apiKey,
      },
    ].filter((a) => a.key);

    for (const attempt of attempts) {
      try {
        const response = await fetch(attempt.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${attempt.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(attempt.body),
        });

        if (!response.ok) continue;

        const buffer = await response.arrayBuffer();
        return reply
          .header("Content-Type", "audio/mpeg")
          .send(Buffer.from(buffer));
      } catch (err) {
        logger.warn({ url: attempt.url, err }, "TTS attempt failed");
      }
    }

    throw new AppError(502, "All TTS providers failed", "TTS_FAILED");
  });
};

export default voicePlugin;

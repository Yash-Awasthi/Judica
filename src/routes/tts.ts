import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import logger from "../lib/logger.js";

const ttsSchema = z.object({
  input: z.string().min(1).max(4000)
});

const ttsPlugin: FastifyPluginAsync = async (fastify) => {
    fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const body = request.body as { text?: string; voice?: string; speed?: number };
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

    const API_KEY = env.XIAOMI_MIMO_API_KEY || env.OPENAI_API_KEY;

    const attemptTTS = async (url: string, payload: Record<string, unknown>) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.arrayBuffer();
    };

    let audioBuffer: ArrayBuffer;

    try {
      audioBuffer = await attemptTTS("https://api.siliconflow.cn/v1/audio/speech", {
        model: "xiaomi/MiMo-TTS-v2",
        input: parsed.data.input,
        voice: "random"
      });
    } catch (e1: unknown) {
      logger.warn({ err: e1.message }, "TTS Attempt 1 (xiaomi/MiMo-TTS-v2) failed");
      try {
        audioBuffer = await attemptTTS("https://api.siliconflow.cn/v1/audio/speech", {
          model: "FunAudioLLM/CosyVoice2-0.5B",
          input: parsed.data.input,
          voice: "alex"
        });
      } catch (e2: unknown) {
        logger.warn({ err: e2.message }, "TTS Attempt 2 (CosyVoice) failed");
        audioBuffer = await attemptTTS("https://api.chatanywhere.tech/v1/audio/speech", {
          model: "tts-1",
          input: parsed.data.input,
          voice: "alloy"
        });
      }
    }

    reply.header("Content-Type", "audio/mpeg");
    return reply.send(Buffer.from(audioBuffer));
  });
};

export default ttsPlugin;

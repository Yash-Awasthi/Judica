import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { fastifyOptionalAuth } from "../middleware/fastifyAuth.js";
import logger from "../lib/logger.js";

const ttsSchema = z.object({
  input: z.string().min(1).max(4000)
});

const ttsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /api/tts:
   *   post:
   *     tags:
   *       - Council
   *     summary: Convert text to speech audio
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               text:
   *                 type: string
   *                 description: Text to synthesize (alias for input)
   *               input:
   *                 type: string
   *                 description: Text to synthesize (1-4000 chars)
   *     responses:
   *       200:
   *         description: Audio file
   *         content:
   *           audio/mpeg:
   *             schema:
   *               type: string
   *               format: binary
   *       400:
   *         description: Missing or invalid text input
   */
  fastify.post("/", { preHandler: fastifyOptionalAuth }, async (request, reply) => {
    const body = request.body as any;
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

    const attemptTTS = async (url: string, payload: any) => {
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
    } catch (e1: any) {
      logger.warn({ err: e1.message }, "TTS Attempt 1 (xiaomi/MiMo-TTS-v2) failed");
      try {
        audioBuffer = await attemptTTS("https://api.siliconflow.cn/v1/audio/speech", {
          model: "FunAudioLLM/CosyVoice2-0.5B",
          input: parsed.data.input,
          voice: "alex"
        });
      } catch (e2: any) {
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

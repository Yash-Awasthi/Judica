import { Router, Response } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { AuthRequest } from "../types/index.js";
import logger from "../lib/logger.js";

const router = Router();

/**
 * @openapi
 * /api/voice/transcribe:
 *   post:
 *     tags:
 *       - Council
 *     summary: Transcribe audio to text using Whisper STT
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - audio
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *                 description: Audio file to transcribe
 *     responses:
 *       200:
 *         description: Transcription result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 text:
 *                   type: string
 *       400:
 *         description: Audio file required
 *       502:
 *         description: Transcription failed
 *       503:
 *         description: STT not configured
 */
// POST /api/voice/transcribe — Whisper STT
router.post("/transcribe", optionalAuth, upload.single("audio"), async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new AppError(400, "Audio file required", "NO_AUDIO");

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new AppError(503, "Speech-to-text not configured (OPENAI_API_KEY missing)", "STT_UNAVAILABLE");

  const formData = new FormData();
  const { readFileSync } = await import("fs");
  const audioBuffer = readFileSync(req.file.path);
  formData.append("file", new Blob([audioBuffer], { type: req.file.mimetype }), req.file.originalname || "audio.webm");
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
  res.json({ text: data.text });
});

/**
 * @openapi
 * /api/voice/synthesize:
 *   post:
 *     tags:
 *       - Council
 *     summary: Synthesize text to speech audio
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 maxLength: 4096
 *                 description: Text to synthesize
 *               voice:
 *                 type: string
 *                 description: Voice identifier
 *     responses:
 *       200:
 *         description: Audio file
 *         content:
 *           audio/mpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Text is required or too long
 *       502:
 *         description: All TTS providers failed
 *       503:
 *         description: TTS not configured
 */
// POST /api/voice/synthesize — TTS
router.post("/synthesize", optionalAuth, async (req: AuthRequest, res: Response) => {
  const { text, voice } = req.body;
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
      res.setHeader("Content-Type", "audio/mpeg");
      res.send(Buffer.from(buffer));
      return;
    } catch (err) {
      logger.warn({ url: attempt.url, err }, "TTS attempt failed");
    }
  }

  throw new AppError(502, "All TTS providers failed", "TTS_FAILED");
});

export default router;

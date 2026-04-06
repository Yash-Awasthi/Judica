import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";

const router = Router();

const ttsSchema = z.object({
  input: z.string().min(1).max(4000)
});

router.post("/", async (req, res, next) => {
  try {
    const rawInput = req.body.text || req.body.input;
    if (!rawInput) return res.status(400).json({ error: "Missing text/input" });
    
    const parsed = ttsSchema.safeParse({ input: rawInput });
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload length" });
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
      console.warn("TTS Attempt 1 (xiaomi/MiMo-TTS-v2) failed:", e1.message);
      try {
        audioBuffer = await attemptTTS("https://api.siliconflow.cn/v1/audio/speech", {
          model: "FunAudioLLM/CosyVoice2-0.5B",
          input: parsed.data.input,
          voice: "alex"
        });
      } catch (e2: any) {
        console.warn("TTS Attempt 2 (CosyVoice) failed:", e2.message);
        audioBuffer = await attemptTTS("https://api.chatanywhere.tech/v1/audio/speech", {
          model: "tts-1",
          input: parsed.data.input,
          voice: "alloy"
        });
      }
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    next(err);
  }
});

export default router;

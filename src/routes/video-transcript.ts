/**
 * Video Transcript Ingestion routes — Phase 2.17
 *
 * Paste a URL, get transcript, add to knowledge base.
 * Works with YouTube, podcasts, any yt-dlp-supported URL.
 */

import type { FastifyInstance } from "fastify";
import { extractTranscript } from "../lib/videoTranscript.js";
import { z } from "zod";

const ingestSchema = z.object({
  url:   z.string().url(),
  kb_id: z.string().optional(), // knowledge base to add transcript to
  title: z.string().optional(),
});

export async function videoTranscriptPlugin(app: FastifyInstance) {
  // POST /video/transcript — extract transcript from URL
  app.post("/video/transcript", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  } as any, async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { url } = parsed.data;
    const result = await extractTranscript(url);

    return {
      success:    true,
      source:     result.source,
      title:      result.title,
      transcript: result.transcript,
      wordCount:  result.transcript.split(/\s+/).length,
      language:   result.language,
      duration:   result.durationSecs,
    };
  });

  // GET /video/transcript/sources — available extraction backends
  // @ts-ignore — @fastify/rate-limit augments config type at runtime
  app.get("/video/transcript/sources", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (_req, reply) => {
    const ytDlpAvailable = await import("child_process")
      .then(({ execSync }) => { execSync("which yt-dlp"); return true; })
      .catch(() => false);

    return {
      success: true,
      sources: {
        "youtube-api":  !!process.env.YOUTUBE_API_KEY,
        "yt-dlp-subs":  ytDlpAvailable,
        "whisper":      !!process.env.WHISPER_API_URL,
      },
      instructions: {
        "youtube-api": "Set YOUTUBE_API_KEY env var",
        "yt-dlp-subs": "Install yt-dlp: pip install yt-dlp",
        "whisper":     "Set WHISPER_API_URL to a faster-whisper-server endpoint",
      },
    };
  });
}

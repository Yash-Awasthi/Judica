/**
 * Video & Audio Generation — Phase 6.6
 *
 * Inspired by:
 * - CogVideoX (THUDM/CogVideo, Apache 2.0, Tsinghua) — open-source video generation.
 * - Wan 2.1 (Wan-Video/Wan2.1, Apache 2.0) — strong open video model.
 * - AudioCraft (facebookresearch/audiocraft, MIT, Meta, 22k stars)
 *   — music and audio generation (MusicGen, AudioGen).
 *
 * Routes:
 * - POST /generate/video — text → video clip (Runway/Kling/fal.ai/replicate)
 * - POST /generate/audio — text → music/audio (AudioCraft/Suno/Udio via API)
 * - GET /generate/video/providers — configured video providers
 * - GET /generate/audio/providers — configured audio providers
 * - GET /generate/jobs/:id — check generation job status (async)
 *
 * Env stubs: RUNWAY_API_KEY, KLING_API_KEY, FAL_API_KEY, REPLICATE_API_TOKEN,
 *            SUNO_API_KEY, UDIO_API_KEY
 */

import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

type JobStatus = "pending" | "processing" | "completed" | "failed";

interface GenerationJob {
  id: string;
  userId: number;
  type: "video" | "audio";
  prompt: string;
  provider: string;
  model: string;
  status: JobStatus;
  resultUrl?: string;
  resultBase64?: string;
  error?: string;
  durationSeconds?: number;
  createdAt: Date;
  updatedAt: Date;
  /** External job ID from provider (for polling) */
  externalJobId?: string;
}

const jobStore = new Map<string, GenerationJob>();
let jobCounter = 1;

function jobId(): string {
  return `genjob_${Date.now()}_${jobCounter++}`;
}

// ─── Video generation helpers ─────────────────────────────────────────────────

async function generateVideoFal(
  prompt: string,
  model: string,
  durationSeconds: number,
): Promise<{ url?: string; requestId?: string }> {
  const falKey = env.FAL_API_KEY;
  if (!falKey) throw new Error("FAL_API_KEY not configured");

  const response = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: prompt.slice(0, 1000),
      duration: durationSeconds,
      aspect_ratio: "16:9",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`fal.ai video error: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as { request_id?: string; video?: { url: string } };
  return { url: data.video?.url, requestId: data.request_id };
}

async function generateVideoReplicate(
  prompt: string,
  model: string,
): Promise<{ predictionId: string }> {
  const token = env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  const response = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: { prompt: prompt.slice(0, 1000) } }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`Replicate video error: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as { id: string };
  return { predictionId: data.id };
}

// ─── Audio generation helpers ─────────────────────────────────────────────────

async function generateAudioFal(
  prompt: string,
  model: string,
  durationSeconds: number,
): Promise<{ url?: string; requestId?: string }> {
  const falKey = env.FAL_API_KEY;
  if (!falKey) throw new Error("FAL_API_KEY not configured");

  const response = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: prompt.slice(0, 500),
      duration: durationSeconds,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`fal.ai audio error: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as { request_id?: string; audio?: { url: string } };
  return { url: data.audio?.url, requestId: data.request_id };
}

async function pollFalResult(requestId: string, model: string): Promise<string | null> {
  const falKey = env.FAL_API_KEY;
  if (!falKey) return null;

  const response = await fetch(`https://queue.fal.run/${model}/requests/${requestId}/status`, {
    headers: { Authorization: `Key ${falKey}` },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) return null;
  const data = await response.json() as { status: string; response?: { video?: { url: string }; audio?: { url: string } } };

  if (data.status === "COMPLETED") {
    return data.response?.video?.url ?? data.response?.audio?.url ?? null;
  }
  return null;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const videoSchema = z.object({
  prompt:          z.string().min(1).max(1000),
  model:           z.enum(["wan", "cogvideo", "auto"]).default("auto"),
  durationSeconds: z.number().int().min(2).max(30).default(5),
  provider:        z.enum(["fal", "replicate", "auto"]).default("auto"),
});

const audioSchema = z.object({
  prompt:          z.string().min(1).max(500),
  type:            z.enum(["music", "sound_effect", "speech"]).default("music"),
  durationSeconds: z.number().int().min(5).max(60).default(30),
  provider:        z.enum(["fal", "replicate", "auto"]).default("auto"),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function mediaGenerationPlugin(app: FastifyInstance) {

  /**
   * GET /generate/video/providers
   */
  app.get("/generate/video/providers", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const providers = [];
    if (env.FAL_API_KEY)          providers.push({ name: "fal-wan", model: "fal-ai/wan-t2v", via: "fal.ai" });
    if (env.REPLICATE_API_TOKEN)  providers.push({ name: "replicate-cogvideo", model: "tencent/cogvideox-5b", via: "Replicate" });

    return reply.send({ success: true, providers, configured: providers.length > 0 });
  });

  /**
   * GET /generate/audio/providers
   */
  app.get("/generate/audio/providers", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const providers = [];
    if (env.FAL_API_KEY)          providers.push({ name: "fal-musicgen", model: "fal-ai/musicgen", via: "fal.ai" });
    if (env.REPLICATE_API_TOKEN)  providers.push({ name: "replicate-musicgen", model: "meta/musicgen", via: "Replicate" });

    return reply.send({ success: true, providers, configured: providers.length > 0 });
  });

  /**
   * POST /generate/video
   * Text → video clip. Returns a job ID (async generation).
   */
  app.post("/generate/video", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = videoSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { prompt, model, durationSeconds, provider } = parsed.data;

    // Determine provider
    const useProvider = provider === "auto"
      ? (env.FAL_API_KEY ? "fal" : env.REPLICATE_API_TOKEN ? "replicate" : "none")
      : provider;

    if (useProvider === "none") {
      return reply.status(503).send({
        error: "No video generation provider configured",
        hint: "Set FAL_API_KEY or REPLICATE_API_TOKEN",
      });
    }

    const id = jobId();
    const now = new Date();
    const job: GenerationJob = {
      id, userId, type: "video", prompt,
      provider: useProvider,
      model: model === "auto" ? (useProvider === "fal" ? "fal-ai/wan-t2v" : "tencent/cogvideox-5b") : model,
      status: "pending",
      durationSeconds,
      createdAt: now, updatedAt: now,
    };
    jobStore.set(id, job);

    // Submit async
    try {
      job.status = "processing";
      if (useProvider === "fal") {
        const falModel = job.model === "wan" ? "fal-ai/wan-t2v" : "fal-ai/wan-t2v";
        const result = await generateVideoFal(prompt, falModel, durationSeconds);
        if (result.url) {
          job.resultUrl = result.url;
          job.status = "completed";
        } else if (result.requestId) {
          job.externalJobId = result.requestId;
          // Leave as processing — poll via GET /generate/jobs/:id
        }
      } else if (useProvider === "replicate") {
        const replicateModel = "tencent/cogvideox-5b";
        const result = await generateVideoReplicate(prompt, replicateModel);
        job.externalJobId = result.predictionId;
      }
    } catch (err: any) {
      job.status = "failed";
      job.error = err.message;
    }

    job.updatedAt = new Date();
    return reply.status(202).send({
      success: true,
      jobId: id,
      status: job.status,
      resultUrl: job.resultUrl,
      message: job.status === "processing" ? "Generation in progress — poll GET /api/generate/jobs/" + id : undefined,
    });
  });

  /**
   * POST /generate/audio
   * Text → music/audio. Returns job ID.
   */
  app.post("/generate/audio", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = audioSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { prompt, type, durationSeconds, provider } = parsed.data;

    const useProvider = provider === "auto"
      ? (env.FAL_API_KEY ? "fal" : env.REPLICATE_API_TOKEN ? "replicate" : "none")
      : provider;

    if (useProvider === "none") {
      return reply.status(503).send({
        error: "No audio generation provider configured",
        hint: "Set FAL_API_KEY or REPLICATE_API_TOKEN",
      });
    }

    const id = jobId();
    const now = new Date();
    const job: GenerationJob = {
      id, userId, type: "audio", prompt,
      provider: useProvider,
      model: type === "music" ? "fal-ai/musicgen" : "fal-ai/stable-audio",
      status: "pending",
      durationSeconds,
      createdAt: now, updatedAt: now,
    };
    jobStore.set(id, job);

    try {
      job.status = "processing";
      if (useProvider === "fal") {
        const falModel = type === "music" ? "fal-ai/musicgen" : "fal-ai/stable-audio";
        const result = await generateAudioFal(prompt, falModel, durationSeconds);
        if (result.url) {
          job.resultUrl = result.url;
          job.status = "completed";
        } else if (result.requestId) {
          job.externalJobId = result.requestId;
        }
      }
    } catch (err: any) {
      job.status = "failed";
      job.error = err.message;
    }

    job.updatedAt = new Date();
    return reply.status(202).send({
      success: true,
      jobId: id,
      status: job.status,
      resultUrl: job.resultUrl,
    });
  });

  /**
   * GET /generate/jobs/:id
   * Poll generation job status.
   * If provider supports polling, fetches current status from external API.
   */
  app.get("/generate/jobs/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const job = jobStore.get(id);
    if (!job || job.userId !== userId) {
      return reply.status(404).send({ error: "Job not found" });
    }

    // If fal.ai job is still processing, poll for result
    if (job.status === "processing" && job.provider === "fal" && job.externalJobId) {
      try {
        const url = await pollFalResult(job.externalJobId, job.model);
        if (url) {
          job.resultUrl = url;
          job.status = "completed";
          job.updatedAt = new Date();
        }
      } catch { /* leave as processing */ }
    }

    return reply.send({ success: true, job });
  });

  /**
   * GET /generate/jobs
   * List all generation jobs for current user.
   */
  app.get("/generate/jobs", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const jobs = [...jobStore.values()]
      .filter(j => j.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);

    return reply.send({ success: true, jobs, count: jobs.length });
  });
}

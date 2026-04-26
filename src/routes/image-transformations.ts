/**
 * Phase 6.7 — Image-to-Image & Image-to-Video
 *
 * Free alternatives (default — no API key needed):
 *   img2img  → Stable Diffusion WebUI (AUTOMATIC1111) local API at SD_WEBUI_URL
 *              or ComfyUI at COMFYUI_API_URL
 *   img2video → CogVideoX local API at COGVIDEO_API_URL
 *               or LTX-Video at LTX_VIDEO_API_URL
 *
 * Paid (opt-in, requires env key):
 *   img2img  → DALL-E 2 edits (OPENAI_API_KEY), fal.ai (FAL_API_KEY)
 *   img2video → Runway ML (RUNWAY_API_KEY), Kling (KLING_API_KEY)
 *
 * Ref:
 *   Free img2img: https://github.com/AUTOMATIC1111/stable-diffusion-webui (AGPL)
 *                 https://github.com/comfyanonymous/ComfyUI (GPL)
 *   Free img2video: https://github.com/THUDM/CogVideo (Apache 2.0)
 *                   https://github.com/Lightricks/LTX-Video (Apache 2.0)
 *   Paid: https://platform.openai.com/docs/api-reference/images
 *         https://docs.runway.ml/api
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "image-transformations" });

// ─── Schema ───────────────────────────────────────────────────────────────────

const img2imgSchema = z.object({
  /** Base64-encoded source image (PNG or JPEG) */
  imageBase64:  z.string().min(1).max(20_000_000),
  prompt:       z.string().min(1).max(2000),
  negativePrompt: z.string().max(500).optional(),
  strength:     z.number().min(0.01).max(1).default(0.75),
  steps:        z.number().int().min(1).max(100).default(30),
  /** "auto" picks best available free provider first, then paid */
  provider:     z.enum(["auto", "sd-webui", "comfyui", "dall-e", "fal"]).default("auto"),
  model:        z.string().max(200).optional(),
  size:         z.enum(["512x512", "768x768", "1024x1024"]).default("512x512"),
});

const img2videoSchema = z.object({
  imageBase64:  z.string().min(1).max(20_000_000),
  prompt:       z.string().max(1000).optional(),
  durationSecs: z.number().min(1).max(30).default(4),
  fps:          z.number().int().min(8).max(30).default(16),
  /** "auto" picks best available free provider first, then paid */
  provider:     z.enum(["auto", "cogvideo", "ltx-video", "runway", "kling"]).default("auto"),
});

// ─── Free provider helpers ────────────────────────────────────────────────────

async function img2imgSdWebui(opts: {
  imageBase64: string;
  prompt: string;
  negativePrompt?: string;
  strength: number;
  steps: number;
}): Promise<string> {
  const sdUrl = (env as Record<string, string>).SD_WEBUI_URL ?? "http://localhost:7860";
  const res = await fetch(`${sdUrl}/sdapi/v1/img2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      init_images:   [opts.imageBase64],
      prompt:        opts.prompt,
      negative_prompt: opts.negativePrompt ?? "",
      denoising_strength: opts.strength,
      steps:         opts.steps,
      sampler_name:  "DPM++ 2M Karras",
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`SD WebUI img2img failed: ${res.status}`);
  const data = await res.json() as { images: string[] };
  const img = data.images?.[0];
  if (!img) throw new Error("SD WebUI returned no image");
  return img; // base64 PNG
}

async function img2videoCogVideo(opts: {
  imageBase64: string;
  prompt: string;
  durationSecs: number;
  fps: number;
}): Promise<string> {
  const cogUrl = (env as Record<string, string>).COGVIDEO_API_URL ?? "http://localhost:8080";
  const res = await fetch(`${cogUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image:    opts.imageBase64,
      prompt:   opts.prompt,
      duration: opts.durationSecs,
      fps:      opts.fps,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`CogVideoX img2video failed: ${res.status}`);
  const data = await res.json() as { video_base64?: string; video_url?: string };
  return data.video_base64 ?? data.video_url ?? "";
}

// ─── Paid provider helpers ────────────────────────────────────────────────────

async function img2imgDallE(opts: {
  imageBase64: string;
  prompt: string;
  size: string;
}): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required for DALL-E img2img");
  // DALL-E 2 edits endpoint
  const formData = new FormData();
  const bytes = Buffer.from(opts.imageBase64, "base64");
  formData.append("image", new Blob([bytes], { type: "image/png" }), "image.png");
  formData.append("prompt", opts.prompt);
  formData.append("n", "1");
  formData.append("size", opts.size);
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: formData,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DALL-E edit failed: ${err}`);
  }
  const data = await res.json() as { data: Array<{ b64_json?: string; url?: string }> };
  return data.data[0]?.b64_json ?? data.data[0]?.url ?? "";
}

async function img2videoRunway(opts: {
  imageBase64: string;
  prompt: string;
  durationSecs: number;
}): Promise<string> {
  const runwayKey = (env as Record<string, string>).RUNWAY_API_KEY;
  if (!runwayKey) throw new Error("RUNWAY_API_KEY required for Runway img2video");
  const res = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runwayKey}`,
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify({
      promptImage: `data:image/png;base64,${opts.imageBase64}`,
      promptText:  opts.prompt,
      model:       "gen3a_turbo",
      duration:    opts.durationSecs <= 5 ? 5 : 10,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Runway img2video failed: ${err}`);
  }
  const data = await res.json() as { id: string };
  return data.id; // task ID — caller polls /image-transformations/video-status/:taskId
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const imageTransformationsPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /image-transformations/providers
   * List available providers and which are configured (free vs paid).
   */
  fastify.get("/providers", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    const sdUrl   = (env as Record<string, string>).SD_WEBUI_URL;
    const cogUrl  = (env as Record<string, string>).COGVIDEO_API_URL;
    const ltxUrl  = (env as Record<string, string>).LTX_VIDEO_API_URL;
    const runwayKey = (env as Record<string, string>).RUNWAY_API_KEY;

    return reply.send({
      img2img: [
        { id: "sd-webui",  label: "Stable Diffusion WebUI",  tier: "free",  configured: Boolean(sdUrl), defaultUrl: "http://localhost:7860" },
        { id: "comfyui",   label: "ComfyUI",                 tier: "free",  configured: Boolean((env as Record<string, string>).COMFYUI_API_URL) },
        { id: "dall-e",    label: "DALL-E 2 (OpenAI)",       tier: "paid",  configured: Boolean(env.OPENAI_API_KEY), warning: "Uses OpenAI credits (paid)" },
        { id: "fal",       label: "fal.ai (FLUX)",           tier: "paid",  configured: Boolean((env as Record<string, string>).FAL_API_KEY), warning: "Uses fal.ai credits (paid)" },
      ],
      img2video: [
        { id: "cogvideo",  label: "CogVideoX (local)",       tier: "free",  configured: Boolean(cogUrl), defaultUrl: "http://localhost:8080" },
        { id: "ltx-video", label: "LTX-Video (local)",       tier: "free",  configured: Boolean(ltxUrl), defaultUrl: "http://localhost:8081" },
        { id: "runway",    label: "Runway ML",               tier: "paid",  configured: Boolean(runwayKey), warning: "Uses Runway credits (paid)" },
        { id: "kling",     label: "Kling",                   tier: "paid",  configured: Boolean((env as Record<string, string>).KLING_API_KEY), warning: "Uses Kling credits (paid)" },
      ],
      freeAlternativeMap: {
        note: "Free providers are the default. Set SD_WEBUI_URL or COGVIDEO_API_URL to point to your local instance.",
        sdWebui: "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
        comfyui: "https://github.com/comfyanonymous/ComfyUI",
        cogvideo: "https://github.com/THUDM/CogVideo",
        ltxVideo: "https://github.com/Lightricks/LTX-Video",
      },
    });
  });

  /**
   * POST /image-transformations/img2img
   * Transform an existing image using a text prompt (image-to-image).
   * Free default: Stable Diffusion WebUI local API.
   * Paid opt-in: DALL-E edits, fal.ai.
   */
  fastify.post("/img2img", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = img2imgSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { imageBase64, prompt, negativePrompt, strength, steps, provider, size } = parsed.data;

    const sdUrl  = (env as Record<string, string>).SD_WEBUI_URL;
    const falKey = (env as Record<string, string>).FAL_API_KEY;

    // Resolve "auto": prefer free providers first
    let resolvedProvider = provider;
    if (resolvedProvider === "auto") {
      if (sdUrl)                   resolvedProvider = "sd-webui";
      else if ((env as Record<string, string>).COMFYUI_API_URL) resolvedProvider = "comfyui";
      else if (env.OPENAI_API_KEY) resolvedProvider = "dall-e";
      else if (falKey)             resolvedProvider = "fal";
      else {
        return reply.status(503).send({
          error: "No image-to-image provider configured. Set SD_WEBUI_URL for the free Stable Diffusion option or configure a paid provider API key.",
          freeOption: "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
        });
      }
    }

    try {
      let resultBase64: string;
      if (resolvedProvider === "sd-webui") {
        resultBase64 = await img2imgSdWebui({ imageBase64, prompt, negativePrompt, strength, steps });
      } else if (resolvedProvider === "dall-e") {
        resultBase64 = await img2imgDallE({ imageBase64, prompt, size });
      } else {
        return reply.status(501).send({ error: `Provider "${resolvedProvider}" not yet implemented in this deployment` });
      }
      return reply.send({ imageBase64: resultBase64, provider: resolvedProvider, format: "png" });
    } catch (err) {
      log.error({ err }, "img2img failed");
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  /**
   * POST /image-transformations/img2video
   * Animate an image into a short video clip.
   * Free default: CogVideoX or LTX-Video local API.
   * Paid opt-in: Runway ML, Kling.
   */
  fastify.post("/img2video", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = img2videoSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { imageBase64, prompt, durationSecs, fps, provider } = parsed.data;

    const cogUrl    = (env as Record<string, string>).COGVIDEO_API_URL;
    const ltxUrl    = (env as Record<string, string>).LTX_VIDEO_API_URL;
    const runwayKey = (env as Record<string, string>).RUNWAY_API_KEY;
    const klingKey  = (env as Record<string, string>).KLING_API_KEY;

    // Resolve "auto": prefer free providers first
    let resolvedProvider = provider;
    if (resolvedProvider === "auto") {
      if (cogUrl)        resolvedProvider = "cogvideo";
      else if (ltxUrl)   resolvedProvider = "ltx-video";
      else if (runwayKey) resolvedProvider = "runway";
      else if (klingKey)  resolvedProvider = "kling";
      else {
        return reply.status(503).send({
          error: "No image-to-video provider configured. Set COGVIDEO_API_URL for the free CogVideoX option.",
          freeOptions: {
            cogvideo: "https://github.com/THUDM/CogVideo",
            ltxVideo: "https://github.com/Lightricks/LTX-Video",
          },
        });
      }
    }

    try {
      let result: string;
      if (resolvedProvider === "cogvideo") {
        result = await img2videoCogVideo({ imageBase64, prompt: prompt ?? "", durationSecs, fps });
        return reply.send({ videoBase64: result, provider: resolvedProvider, type: "video" });
      } else if (resolvedProvider === "runway") {
        const taskId = await img2videoRunway({ imageBase64, prompt: prompt ?? "", durationSecs });
        return reply.send({ taskId, provider: resolvedProvider, type: "task", pollUrl: `/api/image-transformations/video-status/${taskId}` });
      } else {
        return reply.status(501).send({ error: `Provider "${resolvedProvider}" not yet implemented in this deployment` });
      }
    } catch (err) {
      log.error({ err }, "img2video failed");
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  /**
   * GET /image-transformations/video-status/:taskId
   * Poll the status of an async img2video task (Runway, Kling).
   */
  fastify.get<{ Params: { taskId: string } }>(
    "/video-status/:taskId",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const { taskId } = req.params;
      const runwayKey = (env as Record<string, string>).RUNWAY_API_KEY;
      if (!runwayKey) return reply.status(400).send({ error: "No async video provider configured" });

      const res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${runwayKey}`, "X-Runway-Version": "2024-11-06" },
      });
      if (!res.ok) return reply.status(502).send({ error: `Runway task poll failed: ${res.status}` });
      const data = await res.json();
      return reply.send(data);
    }
  );
};

export default imageTransformationsPlugin;

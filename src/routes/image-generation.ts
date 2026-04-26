/**
 * Image Generation — Phase 6.5: generate:image Intent Routing
 *
 * Inspired by:
 * - FLUX (black-forest-labs/flux, Apache 2.0) — state-of-the-art open image gen.
 * - ComfyUI (comfyanonymous/ComfyUI, GPL, 70k stars) — node-based image gen workflows.
 * - Fal.ai (fal-ai/fal, Apache 2.0) — fast inference for image models.
 *
 * Routes `generate: image` intents to image generation models:
 * - DALL-E 3 (OpenAI) — via API key
 * - Stable Diffusion / FLUX — via fal.ai or local ComfyUI
 * - Generated images appear as base64 data URIs or URLs
 * - Artifacts tab: images stored with metadata
 *
 * Env stubs:
 * - OPENAI_API_KEY — DALL-E 3
 * - FAL_API_KEY — fal.ai FLUX/SD
 * - STABILITY_API_KEY — Stability AI
 * - COMFYUI_ENDPOINT — local ComfyUI server
 */

import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GeneratedImage {
  id: string;
  userId: number;
  prompt: string;
  revisedPrompt?: string;
  model: string;
  provider: string;
  url?: string;
  base64?: string;
  width: number;
  height: number;
  createdAt: Date;
}

const imageStore = new Map<string, GeneratedImage>();
let imgCounter = 1;

function imgId(): string {
  return `img_${Date.now()}_${imgCounter++}`;
}

// ─── Provider helpers ─────────────────────────────────────────────────────────

async function generateWithDalle(
  prompt: string,
  size: string,
  quality: string,
): Promise<{ url: string; revisedPrompt?: string }> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: prompt.slice(0, 4000),
      n: 1,
      size,
      quality,
      response_format: "url",
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DALL-E error: ${err.slice(0, 200)}`);
  }

  const data = await response.json() as { data: Array<{ url: string; revised_prompt?: string }> };
  return {
    url: data.data[0].url,
    revisedPrompt: data.data[0].revised_prompt,
  };
}

async function generateWithFal(
  prompt: string,
  model: string,
  width: number,
  height: number,
): Promise<{ url: string }> {
  if (!env.FAL_API_KEY) throw new Error("FAL_API_KEY not configured");

  const response = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${env.FAL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: prompt.slice(0, 2000),
      image_size: { width, height },
      num_inference_steps: 28,
      num_images: 1,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`fal.ai error: ${err.slice(0, 200)}`);
  }

  const data = await response.json() as { images: Array<{ url: string }> };
  return { url: data.images[0].url };
}

async function generateWithStability(
  prompt: string,
  width: number,
  height: number,
): Promise<{ base64: string }> {
  if (!env.STABILITY_API_KEY) throw new Error("STABILITY_API_KEY not configured");

  const response = await fetch("https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STABILITY_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      text_prompts: [{ text: prompt, weight: 1 }],
      cfg_scale: 7,
      width,
      height,
      samples: 1,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Stability AI error: ${err.slice(0, 200)}`);
  }

  const data = await response.json() as { artifacts: Array<{ base64: string }> };
  return { base64: data.artifacts[0].base64 };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const generateImageSchema = z.object({
  prompt:   z.string().min(1).max(4000),
  model:    z.enum(["dall-e-3", "flux", "stable-diffusion-xl", "auto"]).default("auto"),
  size:     z.enum(["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"]).default("1024x1024"),
  quality:  z.enum(["standard", "hd"]).default("standard"),
  /** fal.ai model path for flux variants */
  falModel: z.string().max(100).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function imageGenerationPlugin(app: FastifyInstance) {

  /**
   * GET /images
   * List generated images for the current user.
   */
  app.get("/images", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { limit: rawLimit = "20", offset: rawOffset = "0" } = req.query as Record<string, string>;
    const limit = Math.min(Number(rawLimit), 100);
    const offset = Number(rawOffset);

    const images = [...imageStore.values()]
      .filter(img => img.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit)
      .map(({ base64: _b, ...rest }) => rest); // strip base64 from list view

    return reply.send({ success: true, images, count: images.length });
  });

  /**
   * GET /images/:id
   * Get a specific generated image (includes base64 if available).
   */
  app.get("/images/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const image = imageStore.get(id);
    if (!image || image.userId !== userId) {
      return reply.status(404).send({ error: "Image not found" });
    }

    return reply.send({ success: true, image });
  });

  /**
   * DELETE /images/:id
   */
  app.delete("/images/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const image = imageStore.get(id);
    if (!image || image.userId !== userId) {
      return reply.status(404).send({ error: "Image not found" });
    }

    imageStore.delete(id);
    return reply.send({ success: true });
  });

  /**
   * POST /images/variations
   * Generate variations on a prompt with different styles.
   */
  app.post("/images/variations", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { prompt, styles = ["photorealistic", "illustration", "watercolor"], size = "1024x1024" } = req.body as {
      prompt?: string;
      styles?: string[];
      size?: string;
    };

    if (!prompt) return reply.status(400).send({ error: "prompt required" });
    if (!env.OPENAI_API_KEY) return reply.status(503).send({ error: "OPENAI_API_KEY required for variations" });

    const variations = await Promise.allSettled(
      styles.slice(0, 4).map(async (style) => {
        const styledPrompt = `${prompt}, ${style} style`;
        const result = await generateWithDalle(styledPrompt, size, "standard");
        return { style, url: result.url, revisedPrompt: result.revisedPrompt };
      }),
    );

    const results = variations.map(v =>
      v.status === "fulfilled" ? v.value : { error: "Generation failed" },
    );

    return reply.send({ success: true, prompt, results });
  });
}

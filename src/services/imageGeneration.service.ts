/**
 * Image Generation Service — multi-provider image generation.
 *
 * Supported providers:
 *   - OpenAI DALL-E (2, 3)
 *   - Azure OpenAI DALL-E
 *   - Google Vertex AI Imagen
 *   - Stability AI (Stable Diffusion)
 *   - Replicate (via API)
 */

import { env } from "../config/env.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "image-gen" });

// Allowlists for user-controlled model names inserted into API URLs
const AZURE_OPENAI_MODEL_ALLOWLIST = new Set(["dall-e-2", "dall-e-3"]);
const VERTEX_MODEL_ALLOWLIST = new Set([
  "imagegeneration@002", "imagegeneration@005", "imagegeneration@006",
  "imagen-3.0-generate-001", "imagen-3.0-fast-generate-001",
]);
const STABILITY_MODEL_ALLOWLIST = new Set([
  "stable-diffusion-v1-6", "stable-diffusion-xl-1024-v0-9",
  "stable-diffusion-xl-1024-v1-0", "stable-image-core", "stable-image-ultra",
]);

function validateModel(model: string, allowlist: Set<string>, provider: string): string {
  if (!allowlist.has(model)) {
    throw new Error(`Unsupported ${provider} model: ${model}`);
  }
  return model;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImageProvider = "openai" | "azure" | "vertex" | "stability" | "replicate";

export interface ImageGenerationRequest {
  prompt: string;
  provider?: ImageProvider;
  model?: string;
  size?: "256x256" | "512x512" | "1024x1024" | "1024x1792" | "1792x1024";
  quality?: "standard" | "hd";
  style?: "vivid" | "natural";
  n?: number;
}

export interface GeneratedImage {
  url?: string;
  b64Json?: string;
  revisedPrompt?: string;
}

export interface ImageGenerationResponse {
  provider: ImageProvider;
  model: string;
  images: GeneratedImage[];
  usage?: { cost?: number };
}

// ─── Provider Resolution ──────────────────────────────────────────────────────

export function getAvailableImageProviders(): ImageProvider[] {
  const providers: ImageProvider[] = [];
  if (env.OPENAI_API_KEY) providers.push("openai");
  if (env.AZURE_OPENAI_IMAGE_ENDPOINT && env.AZURE_OPENAI_IMAGE_KEY) providers.push("azure");
  if (env.GOOGLE_VERTEX_PROJECT && env.GOOGLE_API_KEY) providers.push("vertex");
  if (env.STABILITY_API_KEY) providers.push("stability");
  if (env.REPLICATE_API_TOKEN) providers.push("replicate");
  return providers;
}

function resolveProvider(requested?: ImageProvider): ImageProvider {
  if (requested) {
    const available = getAvailableImageProviders();
    if (available.includes(requested)) return requested;
    log.warn({ requested, available }, "Requested image provider unavailable, falling back");
  }
  const available = getAvailableImageProviders();
  if (available.length === 0) throw new Error("No image generation providers configured");
  return available[0];
}

// ─── Generate Image ───────────────────────────────────────────────────────────

export async function generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const provider = resolveProvider(req.provider);

  log.info({ provider, prompt: req.prompt.slice(0, 80), size: req.size }, "Generating image");

  switch (provider) {
    case "openai": return generateOpenAI(req);
    case "azure": return generateAzureOpenAI(req);
    case "vertex": return generateVertex(req);
    case "stability": return generateStability(req);
    case "replicate": return generateReplicate(req);
    default: throw new Error(`Unknown image provider: ${provider}`);
  }
}

// ─── OpenAI DALL-E ────────────────────────────────────────────────────────────

async function generateOpenAI(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const model = req.model ?? "dall-e-3";
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: req.prompt,
      n: model === "dall-e-3" ? 1 : (req.n ?? 1),
      size: req.size ?? "1024x1024",
      quality: req.quality ?? "standard",
      style: req.style ?? "vivid",
      response_format: "url",
    }),
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`OpenAI image generation failed: ${resp.status} ${error}`);
  }

  const data = await resp.json() as { data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> };

  return {
    provider: "openai",
    model,
    images: data.data.map((img) => ({
      url: img.url,
      b64Json: img.b64_json,
      revisedPrompt: img.revised_prompt,
    })),
  };
}

// ─── Azure OpenAI DALL-E ──────────────────────────────────────────────────────

async function generateAzureOpenAI(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const endpoint = env.AZURE_OPENAI_IMAGE_ENDPOINT!;
  const apiKey = env.AZURE_OPENAI_IMAGE_KEY!;
  const deployment = validateModel(req.model ?? "dall-e-3", AZURE_OPENAI_MODEL_ALLOWLIST, "Azure OpenAI");

  const resp = await fetch(`${endpoint}/openai/deployments/${deployment}/images/generations?api-version=2024-02-01`, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: req.prompt,
      n: 1,
      size: req.size ?? "1024x1024",
      quality: req.quality ?? "standard",
      style: req.style ?? "vivid",
    }),
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`Azure OpenAI image generation failed: ${resp.status} ${error}`);
  }

  const data = await resp.json() as { data: Array<{ url?: string; revised_prompt?: string }> };

  return {
    provider: "azure",
    model: deployment,
    images: data.data.map((img) => ({
      url: img.url,
      revisedPrompt: img.revised_prompt,
    })),
  };
}

// ─── Google Vertex AI Imagen ──────────────────────────────────────────────────

async function generateVertex(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const project = env.GOOGLE_VERTEX_PROJECT!;
  const location = env.GOOGLE_VERTEX_LOCATION ?? "us-central1";
  const model = validateModel(req.model ?? "imagegeneration@006", VERTEX_MODEL_ALLOWLIST, "Vertex AI");

  const resp = await fetch(
    `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GOOGLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt: req.prompt }],
        parameters: {
          sampleCount: req.n ?? 1,
          aspectRatio: req.size === "1792x1024" ? "16:9" : req.size === "1024x1792" ? "9:16" : "1:1",
        },
      }),
    },
  );

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`Vertex AI image generation failed: ${resp.status} ${error}`);
  }

  const data = await resp.json() as { predictions: Array<{ bytesBase64Encoded: string; mimeType: string }> };

  return {
    provider: "vertex",
    model,
    images: (data.predictions ?? []).map((p) => ({
      b64Json: p.bytesBase64Encoded,
    })),
  };
}

// ─── Stability AI ─────────────────────────────────────────────────────────────

async function generateStability(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const model = validateModel(req.model ?? "stable-diffusion-xl-1024-v1-0", STABILITY_MODEL_ALLOWLIST, "Stability AI");

  const sizeMap: Record<string, { width: number; height: number }> = {
    "256x256": { width: 256, height: 256 },
    "512x512": { width: 512, height: 512 },
    "1024x1024": { width: 1024, height: 1024 },
    "1024x1792": { width: 1024, height: 1792 },
    "1792x1024": { width: 1792, height: 1024 },
  };
  const dimensions = sizeMap[req.size ?? "1024x1024"] ?? { width: 1024, height: 1024 };

  const resp = await fetch(`https://api.stability.ai/v1/generation/${model}/text-to-image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STABILITY_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      text_prompts: [{ text: req.prompt, weight: 1 }],
      cfg_scale: 7,
      width: dimensions.width,
      height: dimensions.height,
      steps: 30,
      samples: req.n ?? 1,
    }),
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`Stability AI image generation failed: ${resp.status} ${error}`);
  }

  const data = await resp.json() as { artifacts: Array<{ base64: string; seed: number; finishReason: string }> };

  return {
    provider: "stability",
    model,
    images: (data.artifacts ?? []).map((a) => ({
      b64Json: a.base64,
    })),
  };
}

// ─── Replicate ────────────────────────────────────────────────────────────────

async function generateReplicate(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const model = req.model ?? "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b";

  // Start prediction
  const createResp = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${env.REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: model.includes(":") ? model.split(":")[1] : model,
      input: {
        prompt: req.prompt,
        width: parseInt((req.size ?? "1024x1024").split("x")[0]),
        height: parseInt((req.size ?? "1024x1024").split("x")[1]),
        num_outputs: req.n ?? 1,
      },
    }),
  });

  if (!createResp.ok) {
    const error = await createResp.text();
    throw new Error(`Replicate create prediction failed: ${createResp.status} ${error}`);
  }

  const prediction = await createResp.json() as { id: string; status: string; output?: string[]; urls: { get: string } };

  // Poll for completion (max 60 seconds)
  let result = prediction;
  const deadline = Date.now() + 60000;
  while (result.status !== "succeeded" && result.status !== "failed" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollResp = await fetch(result.urls.get, {
      headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}` },
    });
    result = await pollResp.json() as typeof prediction;
  }

  if (result.status !== "succeeded" || !result.output) {
    throw new Error(`Replicate prediction failed: ${result.status}`);
  }

  return {
    provider: "replicate",
    model: model.split(":")[0],
    images: result.output.map((url) => ({ url })),
  };
}

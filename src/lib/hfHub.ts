/**
 * HuggingFace Hub Tool Integration — Phase 2.15
 *
 * Pull tools and agents directly from HuggingFace Hub and inject them
 * into the council's tool list. Massive free ecosystem of community-built tools.
 *
 * Inspired by:
 * - smolagents (Apache 2.0, HuggingFace, huggingface/smolagents) — agent framework
 *   with HuggingFace Hub as the source for tools and models
 *
 * Implementation:
 * - Fetch tool metadata from HF Hub Spaces/Models API (no API key required for public)
 * - Store as openapiTools entries (reuses Phase 1.15 infrastructure)
 * - Invoke via HTTP (HF Inference API or Gradio Spaces API)
 * - Supports: image classifiers, audio processors, text transformers, code evaluators
 *
 * Free tier: HF Inference API public models (rate-limited)
 * Paid upgrade: HF Inference API Pro ($9/mo) for dedicated endpoints
 */

export interface HFSpaceInfo {
  id:          string;
  name:        string;
  description: string;
  url:         string;
  sdk:         string; // "gradio" | "streamlit" | "static"
  tags:        string[];
}

export interface HFModelInfo {
  id:          string;
  pipeline_tag: string;
  description?: string;
  tags:         string[];
}

/** Fetch metadata for a HuggingFace Space. */
export async function fetchHFSpaceInfo(spaceId: string): Promise<HFSpaceInfo | null> {
  const hfToken = process.env.HUGGINGFACE_TOKEN; // optional, for private spaces
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

  const res = await fetch(`https://huggingface.co/api/spaces/${encodeURIComponent(spaceId)}`, {
    headers,
  });

  if (!res.ok) return null;
  const data = await res.json() as Record<string, unknown>;

  return {
    id:          data.id as string,
    name:        (data.id as string).split("/")[1] ?? data.id as string,
    description: (data.cardData as any)?.short_description ?? "",
    url:         `https://huggingface.co/spaces/${data.id}`,
    sdk:         (data.sdk as string) ?? "gradio",
    tags:        (data.tags as string[]) ?? [],
  };
}

/** Fetch metadata for a HuggingFace Model. */
export async function fetchHFModelInfo(modelId: string): Promise<HFModelInfo | null> {
  const hfToken = process.env.HUGGINGFACE_TOKEN;
  const headers: Record<string, string> = {};
  if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

  const res = await fetch(`https://huggingface.co/api/models/${encodeURIComponent(modelId)}`, {
    headers,
  });

  if (!res.ok) return null;
  const data = await res.json() as Record<string, unknown>;

  return {
    id:           data.id as string,
    pipeline_tag: (data.pipeline_tag as string) ?? "text-generation",
    description:  (data.cardData as any)?.short_description,
    tags:         (data.tags as string[]) ?? [],
  };
}

/** Invoke a HuggingFace Inference API model. */
export async function invokeHFInference(
  modelId: string,
  inputs: unknown,
  parameters?: Record<string, unknown>,
): Promise<unknown> {
  const hfToken = process.env.HUGGINGFACE_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

  const res = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(modelId)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ inputs, parameters }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HF Inference error ${res.status}: ${err}`);
  }

  return res.json();
}

/**
 * Search public HuggingFace models by pipeline tag.
 * Returns up to `limit` model metadata objects.
 */
export async function searchHFModels(
  pipelineTag: string,
  limit = 10,
): Promise<HFModelInfo[]> {
  const url = `https://huggingface.co/api/models?pipeline_tag=${encodeURIComponent(pipelineTag)}&limit=${limit}&sort=downloads&direction=-1`;

  const hfToken = process.env.HUGGINGFACE_TOKEN;
  const headers: Record<string, string> = {};
  if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

  const res = await fetch(url, { headers });
  if (!res.ok) return [];

  const data = await res.json() as Array<Record<string, unknown>>;
  return data.map(d => ({
    id:           d.id as string,
    pipeline_tag: (d.pipeline_tag as string) ?? pipelineTag,
    description:  (d.cardData as any)?.short_description,
    tags:         (d.tags as string[]) ?? [],
  }));
}

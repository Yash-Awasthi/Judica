/**
 * ULTRAPLINIAN — Ultra-parallel multi-model querying with composite scoring
 *
 * Inspired by G0DM0D3 / elder-plinius pattern:
 *   Fire N models in parallel, score each response, surface the winner.
 *
 * Tiers:  10 | 24 | 36 | 45 | 51 models
 * Scoring: latency (40%) + quality proxy (40%) + token efficiency (20%)
 */

import { env } from "../config/env.js";
import logger from "./logger.js";
import { askProvider } from "./providers.js";
import type { Message } from "./providers/types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface UltraPlinianSlot {
  id: string;
  provider: "openai" | "anthropic" | "google" | "groq" | "mistral" | "openrouter" | "cerebras" | "ollama";
  model: string;
  label: string;
  baseUrl?: string;
  apiKeyEnv: keyof typeof env;
  priority: number;   // 1 = highest; used for tier selection
  tier: 10 | 24 | 36 | 45 | 51;  // minimum tier this slot appears in
}

export interface UltraPlinianResponse {
  id: string;
  model: string;
  label: string;
  text: string;
  latencyMs: number;
  tokens: number;
  compositeScore: number;
  latencyScore: number;
  qualityScore: number;
  tokenScore: number;
  status: "done" | "error";
  error?: string;
}

export interface UltraPlinianResult {
  question: string;
  tier: number;
  totalMs: number;
  responses: UltraPlinianResponse[];
  winner: UltraPlinianResponse;
  scores: Record<string, number>;  // id → compositeScore
}

// ── Canonical slot pool ────────────────────────────────────────────────────
// 51 slots across all providers — sorted by priority.
// Tier N uses the first N slots by priority.

const SLOT_POOL: UltraPlinianSlot[] = [
  // ── Tier 10 core ──────────────────────────────────────────────────────────
  { id: "gpt-4o",               provider: "openai",     model: "gpt-4o",                          label: "GPT-4o",             apiKeyEnv: "OPENAI_API_KEY",     priority: 1,  tier: 10 },
  { id: "claude-3-5-sonnet",    provider: "anthropic",  model: "claude-3-5-sonnet-20241022",       label: "Claude 3.5 Sonnet",  apiKeyEnv: "ANTHROPIC_API_KEY",  priority: 2,  tier: 10 },
  { id: "gemini-2-5-flash",     provider: "google",     model: "gemini-2.5-flash-preview-05-20",   label: "Gemini 2.5 Flash",   apiKeyEnv: "GOOGLE_API_KEY",     priority: 3,  tier: 10 },
  { id: "llama-3-3-70b",        provider: "groq",       model: "llama-3.3-70b-versatile",          label: "Llama 3.3 70B",      apiKeyEnv: "GROQ_API_KEY",       priority: 4,  tier: 10, baseUrl: "https://api.groq.com/openai/v1" },
  { id: "mistral-large",        provider: "mistral",    model: "mistral-large-latest",             label: "Mistral Large",      apiKeyEnv: "MISTRAL_API_KEY",    priority: 5,  tier: 10, baseUrl: "https://api.mistral.ai/v1" },
  { id: "gpt-4o-mini",          provider: "openai",     model: "gpt-4o-mini",                      label: "GPT-4o mini",        apiKeyEnv: "OPENAI_API_KEY",     priority: 6,  tier: 10 },
  { id: "claude-3-5-haiku",     provider: "anthropic",  model: "claude-3-5-haiku-20241022",        label: "Claude 3.5 Haiku",   apiKeyEnv: "ANTHROPIC_API_KEY",  priority: 7,  tier: 10 },
  { id: "gemini-2-0-flash",     provider: "google",     model: "gemini-2.0-flash",                 label: "Gemini 2.0 Flash",   apiKeyEnv: "GOOGLE_API_KEY",     priority: 8,  tier: 10 },
  { id: "deepseek-v3",          provider: "openrouter", model: "deepseek/deepseek-chat-v3-0324",   label: "DeepSeek V3",        apiKeyEnv: "OPENROUTER_API_KEY", priority: 9,  tier: 10, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "llama-3-1-8b",         provider: "groq",       model: "llama-3.1-8b-instant",             label: "Llama 3.1 8B",       apiKeyEnv: "GROQ_API_KEY",       priority: 10, tier: 10, baseUrl: "https://api.groq.com/openai/v1" },

  // ── Tier 24 additions ─────────────────────────────────────────────────────
  { id: "claude-3-opus",        provider: "anthropic",  model: "claude-3-opus-20240229",           label: "Claude 3 Opus",      apiKeyEnv: "ANTHROPIC_API_KEY",  priority: 11, tier: 24 },
  { id: "gemini-1-5-pro",       provider: "google",     model: "gemini-1.5-pro",                   label: "Gemini 1.5 Pro",     apiKeyEnv: "GOOGLE_API_KEY",     priority: 12, tier: 24 },
  { id: "mixtral-8x7b",         provider: "groq",       model: "mixtral-8x7b-32768",               label: "Mixtral 8x7B",       apiKeyEnv: "GROQ_API_KEY",       priority: 13, tier: 24, baseUrl: "https://api.groq.com/openai/v1" },
  { id: "mistral-small",        provider: "mistral",    model: "mistral-small-2501",               label: "Mistral Small",      apiKeyEnv: "MISTRAL_API_KEY",    priority: 14, tier: 24, baseUrl: "https://api.mistral.ai/v1" },
  { id: "deepseek-r1",          provider: "openrouter", model: "deepseek/deepseek-r1",             label: "DeepSeek R1",        apiKeyEnv: "OPENROUTER_API_KEY", priority: 15, tier: 24, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "qwen3-235b",           provider: "openrouter", model: "qwen/qwen3-235b-a22b",             label: "Qwen3 235B",         apiKeyEnv: "OPENROUTER_API_KEY", priority: 16, tier: 24, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "gpt-4-turbo",          provider: "openai",     model: "gpt-4-turbo",                      label: "GPT-4 Turbo",        apiKeyEnv: "OPENAI_API_KEY",     priority: 17, tier: 24 },
  { id: "claude-3-haiku",       provider: "anthropic",  model: "claude-3-haiku-20240307",          label: "Claude 3 Haiku",     apiKeyEnv: "ANTHROPIC_API_KEY",  priority: 18, tier: 24 },
  { id: "gemini-1-5-flash",     provider: "google",     model: "gemini-1.5-flash",                 label: "Gemini 1.5 Flash",   apiKeyEnv: "GOOGLE_API_KEY",     priority: 19, tier: 24 },
  { id: "llama-4-maverick",     provider: "openrouter", model: "meta-llama/llama-4-maverick",      label: "Llama 4 Maverick",   apiKeyEnv: "OPENROUTER_API_KEY", priority: 20, tier: 24, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "gemma-3-27b",          provider: "openrouter", model: "google/gemma-3-27b-it",            label: "Gemma 3 27B",        apiKeyEnv: "OPENROUTER_API_KEY", priority: 21, tier: 24, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "mistral-medium",       provider: "mistral",    model: "mistral-medium-latest",            label: "Mistral Medium",     apiKeyEnv: "MISTRAL_API_KEY",    priority: 22, tier: 24, baseUrl: "https://api.mistral.ai/v1" },
  { id: "phi-4",                provider: "openrouter", model: "microsoft/phi-4",                  label: "Phi-4",              apiKeyEnv: "OPENROUTER_API_KEY", priority: 23, tier: 24, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "command-r-plus",       provider: "openrouter", model: "cohere/command-r-plus-08-2024",    label: "Command R+",         apiKeyEnv: "OPENROUTER_API_KEY", priority: 24, tier: 24, baseUrl: "https://openrouter.ai/api/v1" },

  // ── Tier 36 additions ─────────────────────────────────────────────────────
  { id: "llama-3-1-405b",       provider: "openrouter", model: "meta-llama/llama-3.1-405b-instruct", label: "Llama 3.1 405B",  apiKeyEnv: "OPENROUTER_API_KEY", priority: 25, tier: 36, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "qwen-2-5-72b",         provider: "openrouter", model: "qwen/qwen-2.5-72b-instruct",       label: "Qwen 2.5 72B",      apiKeyEnv: "OPENROUTER_API_KEY", priority: 26, tier: 36, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "nemotron-70b",         provider: "openrouter", model: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B", apiKeyEnv: "OPENROUTER_API_KEY", priority: 27, tier: 36, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "gpt-4",                provider: "openai",     model: "gpt-4",                            label: "GPT-4",              apiKeyEnv: "OPENAI_API_KEY",     priority: 28, tier: 36 },
  { id: "deepseek-r1-0528",     provider: "openrouter", model: "deepseek/deepseek-r1-0528",        label: "DeepSeek R1 0528",   apiKeyEnv: "OPENROUTER_API_KEY", priority: 29, tier: 36, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "llama-3-2-90b",        provider: "openrouter", model: "meta-llama/llama-3.2-90b-vision-instruct", label: "Llama 3.2 90B", apiKeyEnv: "OPENROUTER_API_KEY", priority: 30, tier: 36, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "ministral-8b",         provider: "mistral",    model: "ministral-8b-latest",              label: "Ministral 8B",      apiKeyEnv: "MISTRAL_API_KEY",    priority: 31, tier: 36, baseUrl: "https://api.mistral.ai/v1" },
  { id: "codestral",            provider: "mistral",    model: "codestral-latest",                 label: "Codestral",         apiKeyEnv: "MISTRAL_API_KEY",    priority: 32, tier: 36, baseUrl: "https://api.mistral.ai/v1" },
  { id: "wizardlm-2-8x22b",     provider: "openrouter", model: "microsoft/wizardlm-2-8x22b",       label: "WizardLM 2 8x22B",  apiKeyEnv: "OPENROUTER_API_KEY", priority: 33, tier: 36, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "nous-hermes-405b",     provider: "openrouter", model: "nousresearch/hermes-3-llama-3.1-405b", label: "Hermes 3 405B", apiKeyEnv: "OPENROUTER_API_KEY", priority: 34, tier: 36, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "solar-pro",            provider: "openrouter", model: "upstage/solar-pro",                label: "SOLAR Pro",         apiKeyEnv: "OPENROUTER_API_KEY", priority: 35, tier: 36, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "glm-4-32b",            provider: "openrouter", model: "thudm/glm-4-32b",                  label: "GLM-4 32B",          apiKeyEnv: "OPENROUTER_API_KEY", priority: 36, tier: 36, baseUrl: "https://openrouter.ai/api/v1" },

  // ── Tier 45 additions ─────────────────────────────────────────────────────
  { id: "qwen3-30b-a3b",        provider: "openrouter", model: "qwen/qwen3-30b-a3b",               label: "Qwen3 30B-A3B",     apiKeyEnv: "OPENROUTER_API_KEY", priority: 37, tier: 45, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "kimi-k2",              provider: "openrouter", model: "moonshotai/kimi-k2",               label: "Kimi K2",            apiKeyEnv: "OPENROUTER_API_KEY", priority: 38, tier: 45, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "aya-expanse-32b",      provider: "openrouter", model: "cohere/aya-expanse-32b",           label: "Aya Expanse 32B",    apiKeyEnv: "OPENROUTER_API_KEY", priority: 39, tier: 45, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "llama-3-2-3b",         provider: "openrouter", model: "meta-llama/llama-3.2-3b-instruct", label: "Llama 3.2 3B",      apiKeyEnv: "OPENROUTER_API_KEY", priority: 40, tier: 45, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "falcon-3-10b",         provider: "openrouter", model: "tiiuae/falcon-3-10b-instruct",     label: "Falcon 3 10B",       apiKeyEnv: "OPENROUTER_API_KEY", priority: 41, tier: 45, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "qwen-2-5-coder-32b",   provider: "openrouter", model: "qwen/qwen-2.5-coder-32b-instruct", label: "Qwen 2.5 Coder",   apiKeyEnv: "OPENROUTER_API_KEY", priority: 42, tier: 45, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "mistral-nemo",         provider: "openrouter", model: "mistralai/mistral-nemo",           label: "Mistral Nemo",       apiKeyEnv: "OPENROUTER_API_KEY", priority: 43, tier: 45, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "dolphin-mixtral",      provider: "openrouter", model: "cognitivecomputations/dolphin-mixtral-8x22b", label: "Dolphin Mixtral", apiKeyEnv: "OPENROUTER_API_KEY", priority: 44, tier: 45, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "openchat-3-6-8b",      provider: "openrouter", model: "openchat/openchat-3.6-8b",         label: "OpenChat 3.6 8B",   apiKeyEnv: "OPENROUTER_API_KEY", priority: 45, tier: 45, baseUrl: "https://openrouter.ai/api/v1" },

  // ── Tier 51 additions ─────────────────────────────────────────────────────
  { id: "deepseek-prover-v2",   provider: "openrouter", model: "deepseek/deepseek-prover-v2",      label: "DeepSeek Prover V2", apiKeyEnv: "OPENROUTER_API_KEY", priority: 46, tier: 51, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "llama-4-scout",        provider: "openrouter", model: "meta-llama/llama-4-scout",         label: "Llama 4 Scout",      apiKeyEnv: "OPENROUTER_API_KEY", priority: 47, tier: 51, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "jamba-1-6-large",      provider: "openrouter", model: "ai21/jamba-1.6-large",             label: "Jamba 1.6 Large",    apiKeyEnv: "OPENROUTER_API_KEY", priority: 48, tier: 51, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "qwq-32b",              provider: "openrouter", model: "qwen/qwq-32b",                     label: "QwQ 32B",            apiKeyEnv: "OPENROUTER_API_KEY", priority: 49, tier: 51, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "deephermes-3-405b",    provider: "openrouter", model: "nousresearch/deephermes-3-llama-3-405b", label: "DeepHermes 3 405B", apiKeyEnv: "OPENROUTER_API_KEY", priority: 50, tier: 51, baseUrl: "https://openrouter.ai/api/v1" },
  { id: "internlm3-8b",         provider: "openrouter", model: "internlm/internlm3-8b-instruct",   label: "InternLM3 8B",       apiKeyEnv: "OPENROUTER_API_KEY", priority: 51, tier: 51, baseUrl: "https://openrouter.ai/api/v1" },
];

export const ULTRAPLINIAN_TIERS = [10, 24, 36, 45, 51] as const;
export type UltraPlinianTier = typeof ULTRAPLINIAN_TIERS[number];

// ── Tier selection ─────────────────────────────────────────────────────────

/**
 * Get the slot pool for a given tier, filtered to only slots whose API keys
 * are configured in the environment. Falls back to available slots if the
 * tier count cannot be met.
 */
export function getSlotsForTier(tier: UltraPlinianTier): UltraPlinianSlot[] {
  // All slots eligible for this tier (priority <= tier slot count)
  const eligible = SLOT_POOL.filter((s) => s.priority <= tier);
  // Filter to slots with available API keys
  const available = eligible.filter((s) => {
    const key = env[s.apiKeyEnv as keyof typeof env] as string | undefined;
    return typeof key === "string" && key.length > 0;
  });

  if (available.length === 0) {
    throw new Error(
      `No API keys configured for ULTRAPLINIAN tier ${tier}. ` +
      `Configure at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY`
    );
  }

  // If we have fewer slots than requested, cycle through available to fill
  const result: UltraPlinianSlot[] = [];
  let i = 0;
  while (result.length < tier) {
    const slot = available[i % available.length];
    // Clone with unique id to avoid key collisions
    result.push(
      result.length < available.length
        ? slot
        : { ...slot, id: `${slot.id}_dup${Math.floor(result.length / available.length)}` }
    );
    i++;
  }

  return result.slice(0, tier);
}

// ── Composite scorer ────────────────────────────────────────────────────────

function scoreResponse(
  text: string,
  latencyMs: number,
  tokens: number,
  allLatencies: number[]
): { composite: number; latency: number; quality: number; token: number } {
  const maxLatency = Math.max(...allLatencies, 1);
  // Latency: lower = better
  const latencyScore = 1 - Math.min(1, latencyMs / maxLatency);
  // Quality: longer, more substantive responses score higher (proxy)
  const qualityScore = Math.min(1, text.length / 1200);
  // Token efficiency: ~300–600 tokens is the sweet spot
  const tokenScore = tokens > 0
    ? Math.min(1, Math.min(tokens, 600) / 600)
    : 0;
  // Weighted composite
  const composite = 0.40 * qualityScore + 0.40 * latencyScore + 0.20 * tokenScore;
  return {
    composite: Math.round(composite * 1000) / 1000,
    latency: Math.round(latencyScore * 1000) / 1000,
    quality: Math.round(qualityScore * 1000) / 1000,
    token: Math.round(tokenScore * 1000) / 1000,
  };
}

// ── Core runner ────────────────────────────────────────────────────────────

export async function runUltraPlinian(
  question: string,
  tier: UltraPlinianTier,
  abortSignal?: AbortSignal,
  onResponse?: (res: UltraPlinianResponse) => void
): Promise<UltraPlinianResult> {
  const slots = getSlotsForTier(tier);
  const startMs = Date.now();

  logger.info({ tier, slotCount: slots.length, question: question.slice(0, 80) }, "ULTRAPLINIAN started");

  const messages: Message[] = [{ role: "user", content: question }];

  // Fire all in parallel
  const settled = await Promise.allSettled(
    slots.map(async (slot): Promise<UltraPlinianResponse> => {
      const slotStart = Date.now();
      const apiKey = env[slot.apiKeyEnv as keyof typeof env] as string;

      try {
        const response = await askProvider(
          {
            name: slot.id,
            type: "api",
            provider: slot.provider === "openrouter" ? "openai" : slot.provider as "openai" | "anthropic" | "google",
            apiKey,
            model: slot.model,
            baseUrl: slot.baseUrl,
            maxTokens: 1024,
            timeoutMs: 45_000,
          },
          messages
        );

        const latencyMs = Date.now() - slotStart;
        const tokens = response.usage?.totalTokens ?? Math.ceil(response.text.length / 4);

        const result: UltraPlinianResponse = {
          id: slot.id,
          model: slot.model,
          label: slot.label,
          text: response.text,
          latencyMs,
          tokens,
          compositeScore: 0,  // computed after all responses
          latencyScore: 0,
          qualityScore: 0,
          tokenScore: 0,
          status: "done",
        };
        return result;
      } catch (err) {
        const latencyMs = Date.now() - slotStart;
        return {
          id: slot.id,
          model: slot.model,
          label: slot.label,
          text: "",
          latencyMs,
          tokens: 0,
          compositeScore: 0,
          latencyScore: 0,
          qualityScore: 0,
          tokenScore: 0,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    })
  );

  // Collect results
  const responses: UltraPlinianResponse[] = settled.map((r) =>
    r.status === "fulfilled" ? r.value : {
      id: "unknown",
      model: "unknown",
      label: "Unknown",
      text: "",
      latencyMs: 0,
      tokens: 0,
      compositeScore: 0,
      latencyScore: 0,
      qualityScore: 0,
      tokenScore: 0,
      status: "error" as const,
      error: r.reason instanceof Error ? r.reason.message : "Promise rejected",
    }
  );

  // Score all successful responses
  const successResponses = responses.filter((r) => r.status === "done");
  const allLatencies = successResponses.map((r) => r.latencyMs);

  for (const r of successResponses) {
    const scores = scoreResponse(r.text, r.latencyMs, r.tokens, allLatencies);
    r.compositeScore = scores.composite;
    r.latencyScore = scores.latency;
    r.qualityScore = scores.quality;
    r.tokenScore = scores.token;
    onResponse?.(r);
  }

  // Sort by composite score descending
  responses.sort((a, b) => b.compositeScore - a.compositeScore);

  const winner = successResponses.length > 0
    ? responses[0]
    : responses[0];

  const scores: Record<string, number> = {};
  for (const r of responses) {
    scores[r.id] = r.compositeScore;
  }

  const totalMs = Date.now() - startMs;
  logger.info({ tier, totalMs, winnerId: winner?.id, winnerScore: winner?.compositeScore }, "ULTRAPLINIAN complete");

  return { question, tier, totalMs, responses, winner, scores };
}

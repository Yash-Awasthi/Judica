/**
 * Council Member Evolution — Phase 7.13
 *
 * Adapts council member reliability weights and system prompt tone
 * based on accumulated user feedback signals (thumbs up/down).
 *
 * Inspired by:
 * - RLHF (Reinforcement Learning from Human Feedback) — Anthropic / OpenAI
 * - Adaptive prompt tuning from feedback (Prompt Breeder, arxiv 2309.16797)
 *
 * How it works:
 * 1. When users rate responses, feedback is linked to the council members
 *    that contributed to that deliberation
 * 2. This module reads accumulated feedback for each model/archetype
 * 3. Computes an evolution adjustment: positive feedback → slightly stronger
 *    system prompt emphasis; negative feedback → add a corrective hint
 * 4. The adjustments are stored and injected into future council calls
 */

import redis from "./redis.js";
import { db } from "./drizzle.js";
import { responseFeedback } from "../db/schema/feedback.js";
import { eq, gte, and, sql } from "drizzle-orm";
import logger from "./logger.js";

const EVOLUTION_TTL = 60 * 60 * 24 * 90; // 90-day window
const MIN_FEEDBACK_SAMPLES = 5; // need at least 5 ratings before evolving

export interface MemberEvolutionProfile {
  model:             string;
  positiveCount:     number;
  negativeCount:     number;
  positiveRate:      number;
  systemPromptHint:  string | null;
  lastEvolved:       number;
}

function redisKey(userId: number, model: string) {
  return `evolution:${userId}:${model.replace(/[^a-z0-9-]/gi, "_")}`;
}

/**
 * Load the evolution profile for a model from Redis.
 */
export async function getEvolutionProfile(
  userId: number,
  model: string,
): Promise<MemberEvolutionProfile | null> {
  try {
    const raw = await redis.get(redisKey(userId, model));
    return raw ? (JSON.parse(raw) as MemberEvolutionProfile) : null;
  } catch {
    return null;
  }
}

/**
 * Recompute the evolution profile for a model based on DB feedback.
 * Considers feedback from the last 90 days.
 */
export async function recomputeEvolution(
  userId: number,
  model: string,
): Promise<MemberEvolutionProfile> {
  const since = new Date(Date.now() - EVOLUTION_TTL * 1000);

  const rows = await db
    .select({ rating: responseFeedback.rating })
    .from(responseFeedback)
    .where(
      and(
        eq(responseFeedback.userId, userId),
        gte(responseFeedback.createdAt, since),
      )
    )
    .limit(500);

  const positiveCount = rows.filter(r => r.rating === "positive").length;
  const negativeCount = rows.filter(r => r.rating === "negative").length;
  const total = positiveCount + negativeCount;
  const positiveRate = total > 0 ? positiveCount / total : 0.5;

  let systemPromptHint: string | null = null;

  if (total >= MIN_FEEDBACK_SAMPLES) {
    if (positiveRate >= 0.8) {
      systemPromptHint = "Your previous responses have been rated highly. Maintain your current approach — be direct and thorough.";
    } else if (positiveRate <= 0.35) {
      systemPromptHint = "Your previous responses have been rated poorly. Focus on accuracy over confidence. Acknowledge uncertainty. Avoid speculation.";
    } else if (positiveRate <= 0.5) {
      systemPromptHint = "Be more concise and accurate. Prioritize verified facts. Flag anything you are unsure about.";
    }
  }

  const profile: MemberEvolutionProfile = {
    model,
    positiveCount,
    negativeCount,
    positiveRate,
    systemPromptHint,
    lastEvolved: Date.now(),
  };

  try {
    await redis.set(redisKey(userId, model), JSON.stringify(profile), "EX", EVOLUTION_TTL);
  } catch (err) {
    logger.warn({ err }, "MemberEvolution: failed to cache profile");
  }

  return profile;
}

/**
 * Apply evolution hints to a provider's system prompt.
 */
export function applyEvolutionHint(
  systemPrompt: string,
  profile: MemberEvolutionProfile | null,
): string {
  if (!profile?.systemPromptHint) return systemPrompt;
  return `${systemPrompt}\n\n[ADAPTATION NOTE]: ${profile.systemPromptHint}`;
}

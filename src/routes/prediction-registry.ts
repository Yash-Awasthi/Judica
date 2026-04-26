/**
 * Quality & Honesty — Phase 7.19: Prediction Registry
 *
 * Inspired by:
 * - Metaculus (metaculus.com) — prediction tracking with calibration scoring.
 * - PredictionBook (predictionbook.com) — log predictions, track accuracy over time.
 * - Manifold Markets (manifold.markets) — prediction market mechanics for probability calibration.
 *
 * When the council makes a falsifiable prediction:
 * - A parser extracts it + target date automatically
 * - Logged as a tracked claim with a target date
 * - When that date arrives, user marks it: correct/incorrect/unclear
 * - Builds empirical accuracy record per archetype over time
 * - Calibration score: how well-matched confidence was to actual accuracy
 *
 * DB schema: in-memory store (could persist to SQL in production)
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Prediction {
  id: string;
  userId: number;
  text: string;
  /** Extracted from response or manually provided */
  targetDate?: Date;
  /** Confidence as stated in original response (0–100) */
  statedConfidence?: number;
  /** Who made the prediction */
  source: string; // archetype name or "user" or "council"
  /** Source response that contained this prediction */
  sourceResponseId?: string;
  status: "pending" | "correct" | "incorrect" | "unclear" | "expired";
  resolution?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

const predictionStore = new Map<string, Prediction>();
let predCounter = 1;

function predId(): string {
  return `pred_${Date.now()}_${predCounter++}`;
}

// ─── LLM helpers ─────────────────────────────────────────────────────────────

const llmProvider = () => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
});

async function extractPredictions(
  text: string,
  sourceLabel: string,
): Promise<Array<{ text: string; targetDate?: string; confidence?: number }>> {
  const prompt = `Extract all falsifiable predictions from this text. A falsifiable prediction:
- Makes a specific claim about what will happen
- Can be verified as true or false
- May have a timeframe

TEXT: ${text.slice(0, 4000)}

Return JSON array (empty if no predictions found):
[
  {
    "text": "exact or paraphrased prediction",
    "targetDate": "YYYY-MM-DD or YYYY-MM or YYYY if mentioned, null if open-ended",
    "confidence": 0-100 if stated confidence, null if not stated
  }
]`;

  const response = await askProvider(llmProvider(), [{ role: "user", content: prompt }]);
  const responseText = typeof response === "string" ? response : (response as any)?.content ?? "";

  try {
    const match = responseText.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch { /* fall through */ }

  return [];
}

// ─── Calibration score ────────────────────────────────────────────────────────

function computeCalibrationScore(predictions: Prediction[]): {
  score: number;
  brier: number;
  accuracy: number;
  total: number;
  resolved: number;
} {
  const resolved = predictions.filter(p => p.status === "correct" || p.status === "incorrect");
  if (resolved.length === 0) return { score: 0, brier: 0, accuracy: 0, total: predictions.length, resolved: 0 };

  let brierSum = 0;
  let correctCount = 0;

  for (const p of resolved) {
    const isCorrect = p.status === "correct";
    const probability = (p.statedConfidence ?? 50) / 100;
    const outcome = isCorrect ? 1 : 0;
    brierSum += Math.pow(probability - outcome, 2);
    if (isCorrect) correctCount++;
  }

  const accuracy = correctCount / resolved.length;
  const brierScore = brierSum / resolved.length;
  const calibrationScore = Math.round((1 - brierScore) * 100); // 0-100

  return {
    score: calibrationScore,
    brier: Math.round(brierScore * 1000) / 1000,
    accuracy: Math.round(accuracy * 100) / 100,
    total: predictions.length,
    resolved: resolved.length,
  };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const extractSchema = z.object({
  text:       z.string().min(1).max(8000),
  source:     z.string().max(100).default("council"),
  sourceResponseId: z.string().optional(),
});

const manualAddSchema = z.object({
  text:             z.string().min(1).max(1000),
  targetDate:       z.string().optional(),
  statedConfidence: z.number().min(0).max(100).optional(),
  source:           z.string().max(100).default("user"),
});

const resolveSchema = z.object({
  status:     z.enum(["correct", "incorrect", "unclear"]),
  resolution: z.string().max(500).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function predictionRegistryPlugin(app: FastifyInstance) {

  /**
   * POST /predictions/extract
   * Parse a response text and extract all falsifiable predictions.
   * Automatically adds them to the registry.
   */
  app.post("/predictions/extract", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = extractSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { text, source, sourceResponseId } = parsed.data;

    const extracted = await extractPredictions(text, source);

    const predictions: Prediction[] = [];
    const now = new Date();

    for (const e of extracted) {
      const id = predId();
      const prediction: Prediction = {
        id, userId,
        text: e.text,
        targetDate: e.targetDate ? new Date(e.targetDate) : undefined,
        statedConfidence: e.confidence ?? undefined,
        source,
        sourceResponseId,
        status: "pending",
        createdAt: now,
      };
      predictionStore.set(id, prediction);
      predictions.push(prediction);
    }

    return reply.send({
      success: true,
      extractedCount: predictions.length,
      predictions,
    });
  });

  /**
   * POST /predictions
   * Manually add a prediction to the registry.
   */
  app.post("/predictions", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = manualAddSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { text, targetDate, statedConfidence, source } = parsed.data;

    const id = predId();
    const prediction: Prediction = {
      id, userId, text,
      targetDate: targetDate ? new Date(targetDate) : undefined,
      statedConfidence,
      source,
      status: "pending",
      createdAt: new Date(),
    };
    predictionStore.set(id, prediction);

    return reply.status(201).send({ success: true, prediction });
  });

  /**
   * GET /predictions
   * List predictions with optional status filter.
   */
  app.get("/predictions", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { status, source } = req.query as { status?: string; source?: string };
    const now = new Date();

    let predictions = [...predictionStore.values()].filter(p => p.userId === userId);

    // Auto-expire predictions past their target date with no resolution
    for (const p of predictions) {
      if (p.status === "pending" && p.targetDate && p.targetDate < now) {
        p.status = "expired";
      }
    }

    if (status) predictions = predictions.filter(p => p.status === status);
    if (source) predictions = predictions.filter(p => p.source === source);

    predictions.sort((a, b) => {
      // Expired first, then by target date
      if (a.targetDate && b.targetDate) return a.targetDate.getTime() - b.targetDate.getTime();
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return reply.send({ success: true, predictions, count: predictions.length });
  });

  /**
   * GET /predictions/due
   * Predictions where the target date has passed and they need resolution.
   */
  app.get("/predictions/due", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const now = new Date();
    const due = [...predictionStore.values()].filter(p =>
      p.userId === userId &&
      p.status === "pending" &&
      p.targetDate &&
      p.targetDate <= now,
    );

    return reply.send({ success: true, due, count: due.length });
  });

  /**
   * POST /predictions/:id/resolve
   * Mark a prediction as correct/incorrect/unclear.
   */
  app.post("/predictions/:id/resolve", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const prediction = predictionStore.get(id);
    if (!prediction || prediction.userId !== userId) {
      return reply.status(404).send({ error: "Prediction not found" });
    }

    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    prediction.status = parsed.data.status;
    prediction.resolution = parsed.data.resolution;
    prediction.resolvedAt = new Date();

    return reply.send({ success: true, prediction });
  });

  /**
   * DELETE /predictions/:id
   */
  app.delete("/predictions/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const prediction = predictionStore.get(id);
    if (!prediction || prediction.userId !== userId) {
      return reply.status(404).send({ error: "Prediction not found" });
    }

    predictionStore.delete(id);
    return reply.send({ success: true });
  });

  /**
   * GET /predictions/calibration
   * Calibration scores per source archetype.
   */
  app.get("/predictions/calibration", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const allPredictions = [...predictionStore.values()].filter(p => p.userId === userId);

    // Group by source
    const bySource = new Map<string, Prediction[]>();
    for (const p of allPredictions) {
      if (!bySource.has(p.source)) bySource.set(p.source, []);
      bySource.get(p.source)!.push(p);
    }

    const calibration = [...bySource.entries()].map(([source, preds]) => ({
      source,
      ...computeCalibrationScore(preds),
    }));

    const overall = computeCalibrationScore(allPredictions);

    return reply.send({
      success: true,
      overall,
      bySource: calibration.sort((a, b) => b.score - a.score),
    });
  });
}

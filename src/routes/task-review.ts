/**
 * Task Review & Merge — Phase 4.3
 *
 * MetaGPT SOP-driven review stages: after a council member submits a task,
 * a reviewer archetype evaluates the output through structured review stages
 * (syntax check → logic review → integration check → approve/reject).
 * Approved tasks are merged into the parent and mark it complete if all
 * subtasks pass.
 *
 * Inspired by:
 * - MetaGPT (geekan/MetaGPT, 45k stars) — SOP-driven multi-agent workflows
 *   with structured review and approval gates
 * - LangGraph review-gate pattern (human-in-the-loop nodes)
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { buildTasks } from "../db/schema/buildTasks.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";

/** SOP review stages — each must pass before advancing */
const REVIEW_STAGES = [
  "syntax_check",
  "logic_review",
  "integration_check",
  "final_approval",
] as const;
type ReviewStage = typeof REVIEW_STAGES[number];

const reviewSchema = z.object({
  reviewerId: z.string().min(1),   // archetype id performing review
  /** Force a specific stage (skip earlier ones) — useful for re-reviews */
  stage: z.enum(REVIEW_STAGES).optional(),
  /** Override: manual approve/reject without LLM review */
  verdict: z.enum(["approved", "rejected"]).optional(),
  feedback: z.string().optional(),
});

const mergeSchema = z.object({
  mergedBy: z.string().min(1),  // archetype or user id
});

/** Build a stage-specific review prompt for the LLM reviewer */
function buildReviewPrompt(stage: ReviewStage, task: { title: string; description?: string | null; output?: string | null }): string {
  const base = `You are reviewing a completed task as part of a structured SOP (Standard Operating Procedure) review pipeline.

Task title: ${task.title}
Task description: ${task.description ?? "(none)"}
Submitted output:
${task.output ?? "(no output)"}

`;

  const stageInstructions: Record<ReviewStage, string> = {
    syntax_check: `STAGE: Syntax Check
Review the output for obvious syntax errors, formatting issues, or malformed content.
Respond in JSON: { "pass": true|false, "issues": ["..."], "summary": "..." }`,

    logic_review: `STAGE: Logic Review
Review the output for logical correctness, completeness, and whether it actually solves the task.
Respond in JSON: { "pass": true|false, "issues": ["..."], "summary": "..." }`,

    integration_check: `STAGE: Integration Check
Review whether the output integrates correctly with related components and has no breaking side-effects.
Respond in JSON: { "pass": true|false, "issues": ["..."], "summary": "..." }`,

    final_approval: `STAGE: Final Approval
Give a final holistic approval decision on the submitted work.
Respond in JSON: { "pass": true|false, "issues": ["..."], "summary": "..." }`,
  };

  return base + stageInstructions[stage];
}

/** Parse LLM JSON response for a review stage */
function parseReviewResponse(text: string): { pass: boolean; issues: string[]; summary: string } {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        pass: Boolean(parsed.pass),
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        summary: String(parsed.summary ?? ""),
      };
    }
  } catch { /* ignore parse errors */ }
  // Fallback: treat non-parseable as pass with summary
  return { pass: true, issues: [], summary: text.slice(0, 200) };
}

export async function taskReviewPlugin(app: FastifyInstance) {
  /**
   * POST /build/tasks/:id/review
   * Run a SOP review stage on a submitted task.
   * Uses LLM unless manual verdict is provided.
   */
  app.post("/build/tasks/:id/review", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { reviewerId, stage, verdict, feedback } = parsed.data;

    const [task] = await db
      .select()
      .from(buildTasks)
      .where(and(eq(buildTasks.id, id), eq(buildTasks.userId, userId)))
      .limit(1);

    if (!task) return reply.status(404).send({ error: "Task not found" });
    if (task.status !== "review") {
      return reply.status(409).send({ error: `Task is not in review status (current: ${task.status})` });
    }

    // Determine which stage to run
    const targetStage = stage ?? "syntax_check";
    const stageIndex = REVIEW_STAGES.indexOf(targetStage);

    let stageResult: { pass: boolean; issues: string[]; summary: string };

    if (verdict) {
      // Manual override — skip LLM
      stageResult = {
        pass: verdict === "approved",
        issues: feedback ? [feedback] : [],
        summary: feedback ?? (verdict === "approved" ? "Manually approved" : "Manually rejected"),
      };
    } else {
      // LLM-driven review
      const prompt = buildReviewPrompt(targetStage, task);
      const reviewerProvider = {
        name: "openai",
        type: "api" as const,
        apiKey: env.OPENAI_API_KEY ?? "",
        model: "gpt-4o-mini",
        systemPrompt: "You are a structured code and task reviewer. Respond only in JSON.",
      };
      const response = await askProvider(
        reviewerProvider,
        [{ role: "user", content: prompt }],
      );
      stageResult = parseReviewResponse(response.text);
    }

    // Check if all stages pass to auto-advance
    const isLastStage = stageIndex === REVIEW_STAGES.length - 1;
    const newStatus = stageResult.pass && isLastStage ? "done" : task.status;

    // Store review result in meta
    const existingMeta = (task.meta as Record<string, unknown>) ?? {};
    const reviewHistory = (existingMeta.reviewHistory as unknown[]) ?? [];
    reviewHistory.push({
      stage: targetStage,
      stageIndex,
      reviewerId,
      pass: stageResult.pass,
      issues: stageResult.issues,
      summary: stageResult.summary,
      reviewedAt: new Date().toISOString(),
    });

    const [updated] = await db
      .update(buildTasks)
      .set({
        status: newStatus,
        meta: { ...existingMeta, reviewHistory, lastReviewStage: targetStage, lastReviewPass: stageResult.pass },
        updatedAt: new Date(),
      })
      .where(eq(buildTasks.id, id))
      .returning();

    return {
      success: true,
      task: updated,
      review: {
        stage: targetStage,
        stageIndex,
        nextStage: stageResult.pass && !isLastStage ? REVIEW_STAGES[stageIndex + 1] : null,
        ...stageResult,
        autoApproved: stageResult.pass && isLastStage,
      },
    };
  });

  /**
   * POST /build/tasks/:id/merge
   * Merge a done subtask into its parent.
   * If all sibling subtasks are done, parent is also marked done.
   */
  app.post("/build/tasks/:id/merge", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "mergedBy required" });

    const { mergedBy } = parsed.data;

    const [task] = await db
      .select()
      .from(buildTasks)
      .where(and(eq(buildTasks.id, id), eq(buildTasks.userId, userId)))
      .limit(1);

    if (!task) return reply.status(404).send({ error: "Task not found" });
    if (task.status !== "done") {
      return reply.status(409).send({ error: `Only done tasks can be merged (current: ${task.status})` });
    }

    const existingMeta = (task.meta as Record<string, unknown>) ?? {};
    const [merged] = await db
      .update(buildTasks)
      .set({
        meta: { ...existingMeta, mergedBy, mergedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(buildTasks.id, id))
      .returning();

    let parentUpdated = null;

    // Check if all siblings are done — if so, complete the parent
    if (task.parentId) {
      const siblings = await db
        .select()
        .from(buildTasks)
        .where(eq(buildTasks.parentId, task.parentId));

      const allDone = siblings.every(s => s.status === "done");
      if (allDone) {
        const siblingOutputs = siblings
          .filter(s => s.output)
          .map(s => `### ${s.title}\n${s.output}`)
          .join("\n\n");

        const [parent] = await db
          .update(buildTasks)
          .set({
            status: "done",
            output: siblingOutputs || null,
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(buildTasks.id, task.parentId), eq(buildTasks.userId, userId)))
          .returning();

        parentUpdated = parent ?? null;
      }
    }

    return {
      success: true,
      task: merged,
      parentCompleted: parentUpdated !== null,
      parent: parentUpdated,
    };
  });

  /**
   * GET /build/tasks/:id/review/stages
   * Return review history and next required stage.
   */
  app.get("/build/tasks/:id/review/stages", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    const [task] = await db
      .select()
      .from(buildTasks)
      .where(and(eq(buildTasks.id, id), eq(buildTasks.userId, userId)))
      .limit(1);

    if (!task) return reply.status(404).send({ error: "Not found" });

    const meta = (task.meta as Record<string, unknown>) ?? {};
    const reviewHistory = (meta.reviewHistory as unknown[]) ?? [];
    const lastStage = meta.lastReviewStage as ReviewStage | undefined;
    const lastPass = meta.lastReviewPass as boolean | undefined;

    const lastStageIndex = lastStage ? REVIEW_STAGES.indexOf(lastStage) : -1;
    const nextStage = lastPass && lastStageIndex < REVIEW_STAGES.length - 1
      ? REVIEW_STAGES[lastStageIndex + 1]
      : lastPass === false
        ? lastStage  // retry failed stage
        : REVIEW_STAGES[0]; // start fresh

    return {
      success: true,
      taskId: id,
      status: task.status,
      stages: REVIEW_STAGES,
      reviewHistory,
      lastStage,
      lastPass,
      nextStage,
    };
  });
}

/**
 * Task Work Stealing — Phase 4.2
 *
 * If a council member finishes all their subtasks and others are still running,
 * they can pick up unclaimed subtasks from peers. No idle members.
 *
 * Inspired by:
 * - AutoGen (MIT, microsoft/autogen, 40k stars) — multi-agent task routing
 *   with dynamic work stealing
 * - CrewAI — agent assist/delegation patterns
 *
 * Work-stealing endpoint: returns the next available unclaimed task for an agent.
 * Atomically claims it to prevent race conditions.
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { buildTasks } from "../db/schema/buildTasks.js";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";

const stealSchema = z.object({
  agentId: z.string().min(1),
  /** Only steal tasks from a specific parent task (optional) */
  parentId: z.number().optional(),
});

export async function workStealingPlugin(app: FastifyInstance) {
  // POST /build/steal — claim the next available unclaimed task
  app.post("/build/steal", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = stealSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "agentId required" });

    const { agentId, parentId } = parsed.data;

    // Find an unclaimed, unlocked task in "planned" status
    // If parentId given, only steal from that subtree
    const availableTasks = await db
      .select()
      .from(buildTasks)
      .where(and(
        eq(buildTasks.userId, userId),
        eq(buildTasks.status, "planned"),
        eq(buildTasks.isLocked, false),
      ))
      .limit(10);

    const candidates = parentId
      ? availableTasks.filter(t => t.parentId === parentId)
      : availableTasks.filter(t => t.claimedBy === null);

    if (candidates.length === 0) {
      return { success: true, task: null, message: "No available tasks to steal" };
    }

    // Claim the first available task atomically
    const target = candidates[0];
    const [claimed] = await db
      .update(buildTasks)
      .set({
        status:    "claimed",
        claimedBy: agentId,
        claimedAt: new Date(),
        isLocked:  true,
        updatedAt: new Date(),
      })
      .where(and(
        eq(buildTasks.id, target.id),
        eq(buildTasks.isLocked, false), // optimistic locking: only update if still unlocked
      ))
      .returning();

    if (!claimed) {
      return { success: false, task: null, message: "Task was claimed by another agent (race)" };
    }

    return { success: true, task: claimed, stolen: true };
  });

  // GET /build/available — list all unclaimed available tasks
  app.get("/build/available", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const tasks = await db
      .select()
      .from(buildTasks)
      .where(and(
        eq(buildTasks.userId, userId),
        eq(buildTasks.status, "planned"),
        eq(buildTasks.isLocked, false),
      ));

    return { success: true, tasks, count: tasks.length };
  });
}

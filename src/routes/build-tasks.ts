/**
 * Build Tab Task Graph routes — Phase 4.1
 *
 * Task CRUD + claim/release/submit operations for the council team.
 * Claiming locks a task; submission moves it to review.
 *
 * Inspired by CrewAI task delegation and Taskade agent task graphs.
 */

import { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { buildTasks } from "../db/schema/buildTasks.js";
import { eq, and, isNull, desc } from "drizzle-orm";
import { z } from "zod";

const createTaskSchema = z.object({
  title:          z.string().min(1).max(500),
  description:    z.string().optional(),
  parentId:       z.number().optional(),
  conversationId: z.string().optional(),
  meta:           z.record(z.unknown()).optional(),
});

const claimSchema = z.object({
  agentId: z.string().min(1), // council member archetype claiming the task
});

const submitSchema = z.object({
  output: z.string().min(1),
});

const subtasksSchema = z.object({
  subtasks: z.array(z.object({
    title:       z.string().min(1),
    description: z.string().optional(),
  })),
});

export async function buildTasksPlugin(app: FastifyInstance) {
  // GET /build/tasks — list all tasks for user
  app.get("/build/tasks", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { status, parentId } = req.query as Record<string, string>;

    const tasks = await db
      .select()
      .from(buildTasks)
      .where(eq(buildTasks.userId, userId))
      .orderBy(desc(buildTasks.createdAt));

    // Filter client-side for simplicity
    const filtered = tasks.filter(t => {
      if (status && t.status !== status) return false;
      if (parentId === "null" && t.parentId !== null) return false;
      if (parentId && parentId !== "null" && t.parentId !== Number(parentId)) return false;
      return true;
    });

    return { success: true, tasks: filtered };
  });

  // GET /build/tasks/:id — get task with subtasks
  app.get("/build/tasks/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    const [task] = await db
      .select()
      .from(buildTasks)
      .where(and(eq(buildTasks.id, id), eq(buildTasks.userId, userId)))
      .limit(1);

    if (!task) return reply.status(404).send({ error: "Not found" });

    const subtasks = await db
      .select()
      .from(buildTasks)
      .where(eq(buildTasks.parentId, id));

    return { success: true, task, subtasks };
  });

  // POST /build/tasks — create a root task
  app.post("/build/tasks", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const [task] = await db
      .insert(buildTasks)
      .values({ userId, ...parsed.data })
      .returning();

    return reply.status(201).send({ success: true, task });
  });

  // POST /build/tasks/:id/claim — claim a task (locks it)
  app.post("/build/tasks/:id/claim", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "agentId required" });

    const [task] = await db
      .select()
      .from(buildTasks)
      .where(and(eq(buildTasks.id, id), eq(buildTasks.userId, userId)))
      .limit(1);

    if (!task) return reply.status(404).send({ error: "Not found" });
    if (task.isLocked) return reply.status(409).send({ error: `Task already claimed by ${task.claimedBy}` });

    const [updated] = await db
      .update(buildTasks)
      .set({
        status:    "claimed",
        claimedBy: parsed.data.agentId,
        claimedAt: new Date(),
        isLocked:  true,
        updatedAt: new Date(),
      })
      .where(eq(buildTasks.id, id))
      .returning();

    return { success: true, task: updated };
  });

  // POST /build/tasks/:id/release — release a claimed task (unlocks)
  app.post("/build/tasks/:id/release", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);

    const [updated] = await db
      .update(buildTasks)
      .set({ status: "planned", claimedBy: null, claimedAt: null, isLocked: false, updatedAt: new Date() })
      .where(and(eq(buildTasks.id, id), eq(buildTasks.userId, userId)))
      .returning();

    if (!updated) return reply.status(404).send({ error: "Not found" });
    return { success: true, task: updated };
  });

  // POST /build/tasks/:id/subtasks — agent breaks task into subtasks
  app.post("/build/tasks/:id/subtasks", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);

    const parsed = subtasksSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const [parent] = await db
      .select({ id: buildTasks.id })
      .from(buildTasks)
      .where(and(eq(buildTasks.id, id), eq(buildTasks.userId, userId)))
      .limit(1);

    if (!parent) return reply.status(404).send({ error: "Parent task not found" });

    const subtasks = await db
      .insert(buildTasks)
      .values(parsed.data.subtasks.map(s => ({ userId, parentId: id, ...s })))
      .returning();

    // Update parent to in_progress
    await db.update(buildTasks).set({ status: "in_progress", updatedAt: new Date() }).where(eq(buildTasks.id, id));

    return reply.status(201).send({ success: true, subtasks });
  });

  // POST /build/tasks/:id/submit — submit completed work for review
  app.post("/build/tasks/:id/submit", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "output required" });

    const [updated] = await db
      .update(buildTasks)
      .set({ status: "review", output: parsed.data.output, submittedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(buildTasks.id, id), eq(buildTasks.userId, userId)))
      .returning();

    if (!updated) return reply.status(404).send({ error: "Not found" });
    return { success: true, task: updated };
  });

  // PATCH /build/tasks/:id/status — update task status (merge/done/blocked)
  app.patch("/build/tasks/:id/status", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    const { status } = req.body as { status?: string };
    const validStatuses = ["planned", "claimed", "in_progress", "review", "done", "blocked"];
    if (!status || !validStatuses.includes(status)) {
      return reply.status(400).send({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }

    const [updated] = await db
      .update(buildTasks)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(buildTasks.id, id), eq(buildTasks.userId, userId)))
      .returning();

    if (!updated) return reply.status(404).send({ error: "Not found" });
    return { success: true, task: updated };
  });

  // DELETE /build/tasks/:id — delete task and all subtasks
  app.delete("/build/tasks/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);

    // Delete subtasks first
    await db.delete(buildTasks).where(eq(buildTasks.parentId, id));
    // Delete task
    await db.delete(buildTasks).where(and(eq(buildTasks.id, id), eq(buildTasks.userId, userId)));

    return { success: true };
  });
}

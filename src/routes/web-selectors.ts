/**
 * Natural Language Web Selectors routes — Phase 3.12
 *
 * CRUD for NL selectors, resolve, execute, batch, self-heal, history.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createSelector,
  getSelectors,
  getSelectorById,
  updateSelector,
  deleteSelector,
  resolveSelector,
  executeSelector,
  batchExecute,
  selfHealSelector,
  getSelectorExecutions,
  generateSelectorFromExamples,
  validateSelector,
} from "../services/webSelectors.service.js";

/* ── Validation Schemas ────────────────────────────────────────────── */

const createSchema = z.object({
  name:         z.string().min(1).max(200),
  description:  z.string().min(1).max(2000),
  url:          z.string().url().optional(),
  selectorType: z.enum(["css", "xpath", "aria"]).optional(),
});

const updateSchema = z.object({
  name:         z.string().min(1).max(200).optional(),
  description:  z.string().min(1).max(2000).optional(),
  url:          z.string().url().optional(),
  selectorType: z.enum(["css", "xpath", "aria"]).optional(),
});

const resolveSchema = z.object({
  description: z.string().min(1).max(2000),
  url:         z.string().url().optional(),
  html:        z.string().max(500_000).optional(),
});

const executeSchema = z.object({
  url: z.string().url(),
});

const batchSchema = z.object({
  selectorIds: z.array(z.number().int().positive()).min(1).max(20),
  url:         z.string().url(),
});

const examplesSchema = z.object({
  description: z.string().min(1).max(2000),
  exampleUrls: z.array(z.string().url()).min(1).max(5),
});

/* ── Plugin ────────────────────────────────────────────────────────── */

export async function webSelectorsPlugin(app: FastifyInstance) {

  // POST /web-selectors — create a NL selector
  app.post("/web-selectors", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const selector = await createSelector(userId, parsed.data);
    return reply.status(201).send({ success: true, selector });
  });

  // GET /web-selectors — list selectors for user
  app.get("/web-selectors", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const selectors = await getSelectors(userId);
    return { success: true, selectors };
  });

  // PUT /web-selectors/:id — update a selector
  app.put("/web-selectors/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid selector id" });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const updated = await updateSelector(id, userId, parsed.data);
    if (!updated) return reply.status(404).send({ error: "Selector not found" });

    return { success: true, selector: updated };
  });

  // DELETE /web-selectors/:id — delete a selector
  app.delete("/web-selectors/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid selector id" });

    const deleted = await deleteSelector(id, userId);
    if (!deleted) return reply.status(404).send({ error: "Selector not found" });

    return { success: true };
  });

  // POST /web-selectors/resolve — resolve NL description to selector (stateless)
  app.post("/web-selectors/resolve", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await resolveSelector(parsed.data.description, parsed.data.url, parsed.data.html);
    return { success: true, ...result };
  });

  // POST /web-selectors/:id/execute — execute selector on a URL
  app.post("/web-selectors/:id/execute", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid selector id" });

    const parsed = executeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await executeSelector(id, parsed.data.url, userId);
    return { success: result.success, execution: result };
  });

  // POST /web-selectors/batch — batch execute multiple selectors
  app.post("/web-selectors/batch", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const results = await batchExecute(parsed.data.selectorIds, parsed.data.url, userId);
    return { success: true, results };
  });

  // POST /web-selectors/:id/heal — self-heal broken selector
  app.post("/web-selectors/:id/heal", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid selector id" });

    const parsed = executeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await selfHealSelector(id, parsed.data.url, userId);
    return { success: result.success, execution: result };
  });

  // GET /web-selectors/:id/history — execution history
  app.get("/web-selectors/:id/history", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid selector id" });

    // Verify ownership
    const selector = await getSelectorById(id, userId);
    if (!selector) return reply.status(404).send({ error: "Selector not found" });

    const { limit = "50" } = req.query as Record<string, string>;
    const executions = await getSelectorExecutions(id, Math.min(Number(limit) || 50, 200));
    return { success: true, executions };
  });

  // POST /web-selectors/from-examples — generate cross-site selector
  app.post("/web-selectors/from-examples", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = examplesSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await generateSelectorFromExamples(
      parsed.data.description,
      parsed.data.exampleUrls,
    );
    return { success: true, ...result };
  });

  // POST /web-selectors/validate — validate a selector against HTML
  app.post("/web-selectors/validate", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const schema = z.object({
      selector:     z.string().min(1),
      selectorType: z.enum(["css", "xpath", "aria"]),
      html:         z.string().min(1).max(500_000),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = validateSelector(parsed.data.selector, parsed.data.selectorType, parsed.data.html);
    return { success: true, ...result };
  });
}

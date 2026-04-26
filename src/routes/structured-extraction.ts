/**
 * Structured Web Data Extraction routes — Phase 3.13
 *
 * CRUD for extraction schemas, run extraction jobs, preview, templates,
 * schema inference, and result export.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createSchema,
  getSchemas,
  getSchemaById,
  updateSchema,
  deleteSchema,
  runExtraction,
  getExtractionJobs,
  getExtractionJobById,
  cancelExtraction,
  getExtractionTemplates,
  previewExtraction,
  exportResult,
} from "../services/structuredExtraction.service.js";
import { inferSchemaFromUrl } from "../lib/extractionEngine.js";
import { validateSafeUrl } from "../lib/ssrf.js";
import { buildStealthHeaders } from "../lib/stealthBrowser.js";

/* ── Validation Schemas ────────────────────────────────────────────── */

const schemaFieldZ: z.ZodType<any> = z.lazy(() =>
  z.object({
    name:        z.string().min(1).max(100),
    type:        z.enum(["string", "number", "boolean", "date", "url", "email", "array", "object"]),
    required:    z.boolean().optional(),
    description: z.string().max(500).optional(),
    children:    z.array(schemaFieldZ).optional(),
  })
);

const createSchemaZ = z.object({
  name:         z.string().min(1).max(200),
  description:  z.string().max(2000).optional(),
  schema:       z.object({ fields: z.array(schemaFieldZ).min(1).max(50) }),
  outputFormat: z.enum(["json", "csv", "table"]).optional(),
  isPublic:     z.boolean().optional(),
});

const updateSchemaZ = z.object({
  name:         z.string().min(1).max(200).optional(),
  description:  z.string().max(2000).optional(),
  schema:       z.object({ fields: z.array(schemaFieldZ).min(1).max(50) }).optional(),
  outputFormat: z.enum(["json", "csv", "table"]).optional(),
  isPublic:     z.boolean().optional(),
});

const runExtractionZ = z.object({
  schemaId: z.number().int().positive(),
  url:      z.string().url(),
  authConfig: z.object({
    type:        z.enum(["bearer", "basic", "cookie", "header"]),
    credentials: z.record(z.string(), z.string()),
  }).optional(),
  paginationConfig: z.object({
    type:      z.enum(["page-number", "offset", "next-link"]),
    selector:  z.string().optional(),
    maxPages:  z.number().int().min(1).max(10).optional(),
  }).optional(),
});

const previewZ = z.object({
  url:    z.string().url(),
  schema: z.object({ fields: z.array(schemaFieldZ).min(1).max(50) }),
});

const inferSchemaZ = z.object({
  url: z.string().url(),
});

/* ── Plugin ────────────────────────────────────────────────────────── */

export async function structuredExtractionPlugin(app: FastifyInstance) {

  // ─── POST /schemas — create extraction schema ────────────────────
  app.post("/schemas", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createSchemaZ.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const schema = await createSchema(userId, parsed.data);
    return reply.status(201).send({ success: true, schema });
  });

  // ─── GET /schemas — list extraction schemas ──────────────────────
  app.get("/schemas", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const schemas = await getSchemas(userId);
    return { success: true, schemas };
  });

  // ─── PUT /schemas/:id — update extraction schema ─────────────────
  app.put<{ Params: { id: string } }>("/schemas/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number(req.params.id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid schema ID" });

    const parsed = updateSchemaZ.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const updated = await updateSchema(id, userId, parsed.data);
    if (!updated) return reply.status(404).send({ error: "Schema not found" });

    return { success: true, schema: updated };
  });

  // ─── DELETE /schemas/:id — delete extraction schema ──────────────
  app.delete<{ Params: { id: string } }>("/schemas/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number(req.params.id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid schema ID" });

    const deleted = await deleteSchema(id, userId);
    if (!deleted) return reply.status(404).send({ error: "Schema not found" });

    return { success: true };
  });

  // ─── POST /run — run extraction job ──────────────────────────────
  app.post("/run", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = runExtractionZ.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const job = await runExtraction(
      parsed.data.schemaId,
      parsed.data.url,
      userId,
      {
        authConfig: parsed.data.authConfig ?? null,
        paginationConfig: parsed.data.paginationConfig ?? null,
      },
    );

    return reply.status(201).send({ success: true, job });
  });

  // ─── GET /jobs — list extraction jobs ────────────────────────────
  app.get("/jobs", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const query = req.query as { schemaId?: string };
    const schemaId = query.schemaId ? Number(query.schemaId) : undefined;

    const jobs = await getExtractionJobs(userId, schemaId);
    return { success: true, jobs };
  });

  // ─── GET /jobs/:id — get extraction job ──────────────────────────
  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number(req.params.id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid job ID" });

    const job = await getExtractionJobById(id, userId);
    if (!job) return reply.status(404).send({ error: "Job not found" });

    return { success: true, job };
  });

  // ─── DELETE /jobs/:id — cancel extraction job ────────────────────
  app.delete<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number(req.params.id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid job ID" });

    try {
      const cancelled = await cancelExtraction(id, userId);
      if (!cancelled) return reply.status(404).send({ error: "Job not found" });
      return { success: true, job: cancelled };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  // ─── POST /preview — preview extraction (first page only) ───────
  app.post("/preview", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = previewZ.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await previewExtraction(parsed.data.url, parsed.data.schema);
    return { success: true, result };
  });

  // ─── GET /templates — list extraction templates ──────────────────
  app.get("/templates", async (req, _reply) => {
    const query = req.query as { category?: string };
    const templates = await getExtractionTemplates(query.category);
    return { success: true, templates };
  });

  // ─── POST /infer-schema — auto-infer schema from URL ────────────
  app.post("/infer-schema", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = inferSchemaZ.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    validateSafeUrl(parsed.data.url);
    const headers = buildStealthHeaders("moderate");
    const resp = await fetch(parsed.data.url, {
      headers,
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });

    if (!resp.ok) {
      return reply.status(502).send({ error: `Failed to fetch URL: ${resp.status}` });
    }

    const html = await resp.text();
    const inferred = await inferSchemaFromUrl(parsed.data.url, html);

    return { success: true, inferred };
  });

  // ─── GET /jobs/:id/export — export job results ───────────────────
  app.get<{ Params: { id: string } }>("/jobs/:id/export", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number(req.params.id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid job ID" });

    const query = req.query as { format?: string };
    const format = (query.format === "csv" || query.format === "table") ? query.format : "json";

    try {
      const exported = await exportResult(id, userId, format);
      reply
        .header("Content-Type", exported.contentType)
        .header("Content-Disposition", `attachment; filename="${exported.filename}"`)
        .send(exported.data);
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });
}

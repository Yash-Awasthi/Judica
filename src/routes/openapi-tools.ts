/**
 * OpenAPI Tool Definitions — Phase 1.15
 *
 * Allows council tools to be described using OpenAPI/JSON Schema format.
 * An OpenAPI tool definition maps to a callable HTTP endpoint that the
 * council can invoke during deliberation.
 *
 * Inspired by:
 * - OpenAI function calling / tool use spec (JSON Schema parameter definition)
 * - LangChain OpenAPIChain (MIT, langchain-ai/langchain) — auto-tool from OpenAPI spec
 * - Dify's tool provider system (Apache 2.0, langgenius/dify)
 *
 * Storage: user_openapi_tools table
 * Routes:
 *   GET    /openapi-tools              — list user's defined tools
 *   POST   /openapi-tools              — register a new tool from OpenAPI spec snippet
 *   PUT    /openapi-tools/:id          — update a tool definition
 *   DELETE /openapi-tools/:id          — remove a tool
 *   POST   /openapi-tools/:id/test     — test-invoke with sample parameters
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { openapiTools } from "../db/schema/openapiTools.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { z } from "zod";

// JSON Schema for a single OpenAPI-style tool parameter property
const parameterPropertySchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean", "array", "object"]),
  description: z.string().max(500).optional(),
  enum: z.array(z.string()).optional(),
  default: z.unknown().optional(),
});

const toolDefinitionSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "Tool name must be alphanumeric with underscores/hyphens"),
  description: z.string().min(5).max(1000),
  /** HTTP method for the endpoint */
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
  /** Full URL of the endpoint */
  url: z.string().url().refine(u => /^https?:\/\//i.test(u), "URL must use http or https"),
  /** JSON Schema object describing parameters */
  parameters: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), parameterPropertySchema),
    required: z.array(z.string()).optional(),
  }),
  /** Optional auth header name (e.g. "Authorization") */
  authHeader: z.string().max(100).optional(),
  /** Optional auth value (stored encrypted in meta) */
  authValue: z.string().max(500).optional(),
  /** Whether this tool is active and can be selected during deliberation */
  enabled: z.boolean().default(true),
});

export const openapiToolsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", fastifyRequireAuth);

  // GET /openapi-tools
  fastify.get("/openapi-tools", async (request: any) => {
    const tools = await db
      .select()
      .from(openapiTools)
      .where(eq(openapiTools.userId, request.user.userId))
      .orderBy(desc(openapiTools.createdAt));
    return { tools };
  });

  // POST /openapi-tools
  fastify.post("/openapi-tools", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const body = toolDefinitionSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }
    const { name, description, method, url, parameters, authHeader, authValue, enabled } = body.data;

    const [tool] = await db
      .insert(openapiTools)
      .values({
        userId: request.user.userId,
        name,
        description,
        method,
        url,
        parameters: parameters as Record<string, unknown>,
        meta: authHeader ? { authHeader, authValue } : null,
        enabled,
      })
      .returning();

    return reply.code(201).send({ tool: sanitizeToolOutput(tool) });
  });

  // PUT /openapi-tools/:id
  fastify.put("/openapi-tools/:id", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };
    const body = toolDefinitionSchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const d = body.data;
    if (d.name !== undefined) update.name = d.name;
    if (d.description !== undefined) update.description = d.description;
    if (d.method !== undefined) update.method = d.method;
    if (d.url !== undefined) update.url = d.url;
    if (d.parameters !== undefined) update.parameters = d.parameters;
    if (d.enabled !== undefined) update.enabled = d.enabled;
    if (d.authHeader !== undefined) update.meta = { authHeader: d.authHeader, authValue: d.authValue };

    const [updated] = await db
      .update(openapiTools)
      .set(update)
      .where(and(eq(openapiTools.id, id), eq(openapiTools.userId, userId)))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Tool not found" });
    return { tool: sanitizeToolOutput(updated) };
  });

  // DELETE /openapi-tools/:id
  fastify.delete("/openapi-tools/:id", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };

    const [deleted] = await db
      .delete(openapiTools)
      .where(and(eq(openapiTools.id, id), eq(openapiTools.userId, userId)))
      .returning();

    if (!deleted) return reply.code(404).send({ error: "Tool not found" });
    return { success: true };
  });

  // POST /openapi-tools/:id/test — test-invoke with sample parameters
  fastify.post("/openapi-tools/:id/test", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };
    const { params: testParams = {} } = (request.body as any) ?? {};

    const [tool] = await db
      .select()
      .from(openapiTools)
      .where(and(eq(openapiTools.id, id), eq(openapiTools.userId, userId)))
      .limit(1);

    if (!tool) return reply.code(404).send({ error: "Tool not found" });

    try {
      const result = await invokeOpenapiTool(tool as unknown as { method: string; url: string; parameters: Record<string, unknown>; meta: Record<string, unknown> | null }, testParams);
      return { success: true, result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: "Tool invocation failed", detail: msg });
    }
  });
};

/** Invoke an OpenAPI tool with given parameters */
export async function invokeOpenapiTool(
  tool: { method: string; url: string; parameters: Record<string, unknown>; meta: Record<string, unknown> | null },
  params: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const meta = tool.meta as { authHeader?: string; authValue?: string } | null;
  if (meta?.authHeader && meta?.authValue) {
    headers[meta.authHeader] = meta.authValue;
  }

  const method = tool.method.toUpperCase();
  let fetchUrl = tool.url;
  let body: string | undefined;

  if (method === "GET" || method === "DELETE") {
    // Append params as query string
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();
    if (qs) fetchUrl = `${fetchUrl}?${qs}`;
  } else {
    body = JSON.stringify(params);
  }

  const response = await fetch(fetchUrl, { method, headers, body });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

/** Strip auth credentials from tool output */
function sanitizeToolOutput(tool: Record<string, unknown>): Record<string, unknown> {
  const { meta: _meta, ...rest } = tool;
  return { ...rest, hasAuth: !!_meta };
}

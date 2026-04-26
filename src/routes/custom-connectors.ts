/**
 * Custom Connector Builder — Phase 3.1
 *
 * CRUD for user-defined connectors + proxy invocation endpoint.
 * Supports api_key, bearer, basic auth types.
 *
 * Inspired by Nango (unified API builder) and Airbyte (low-code connector SDK).
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { customConnectors } from "../db/schema/customConnectors.js";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";

const endpointSchema = z.object({
  name:            z.string(),
  path:            z.string(),
  method:          z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  parameters:      z.record(z.string(), z.unknown()).optional(),
  responseMapping: z.record(z.string(), z.string()).optional(), // { localField: "jsonPath.to.value" }
});

const connectorSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().optional(),
  baseUrl:     z.string().url(),
  authType:    z.enum(["none", "api_key", "bearer", "basic", "oauth2"]).default("none"),
  authConfig:  z.record(z.string(), z.unknown()).optional(),
  endpoints:   z.array(endpointSchema).optional().default([]),
  isActive:    z.boolean().optional(),
});

const invokeSchema = z.object({
  endpointName: z.string(),
  params:       z.record(z.string(), z.unknown()).optional(),
  credentials:  z.record(z.string(), z.string()).optional(), // runtime credentials (not stored)
});

/** Build Authorization header based on connector auth config. */
function buildAuthHeaders(
  authType: string,
  authConfig: Record<string, unknown>,
  credentials: Record<string, string>,
): Record<string, string> {
  switch (authType) {
    case "bearer":
      return { Authorization: `Bearer ${credentials.token ?? authConfig.token ?? ""}` };
    case "api_key": {
      const headerName = (authConfig.headerName as string) ?? "X-API-Key";
      return { [headerName]: credentials.apiKey ?? (authConfig.apiKey as string) ?? "" };
    }
    case "basic": {
      const user = credentials.username ?? (authConfig.username as string) ?? "";
      const pass = credentials.password ?? (authConfig.password as string) ?? "";
      return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
    }
    default:
      return {};
  }
}

export async function customConnectorsPlugin(app: FastifyInstance) {
  // GET /connectors/custom — list user's custom connectors
  app.get("/connectors/custom", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const rows = await db
      .select()
      .from(customConnectors)
      .where(and(eq(customConnectors.userId, userId), eq(customConnectors.isActive, true)));

    return { success: true, connectors: rows };
  });

  // POST /connectors/custom — create a new custom connector
  app.post("/connectors/custom", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = connectorSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { name, description, baseUrl, authType, authConfig = {}, endpoints = [], isActive = true } = parsed.data;

    const [row] = await db
      .insert(customConnectors)
      .values({ userId, name, description, baseUrl, authType, authConfig, endpoints, isActive })
      .returning();

    return reply.status(201).send({ success: true, connector: row });
  });

  // PATCH /connectors/custom/:id — update
  app.patch("/connectors/custom/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid id" });

    const parsed = connectorSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const [existing] = await db
      .select({ id: customConnectors.id })
      .from(customConnectors)
      .where(and(eq(customConnectors.id, id), eq(customConnectors.userId, userId)))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: "Not found" });

    const [updated] = await db
      .update(customConnectors)
      .set({ ...parsed.data, updatedAt: new Date(), version: sql`version + 1` as any })
      .where(eq(customConnectors.id, id))
      .returning();

    return { success: true, connector: updated };
  });

  // DELETE /connectors/custom/:id — soft delete
  app.delete("/connectors/custom/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid id" });

    await db
      .update(customConnectors)
      .set({ isActive: false })
      .where(and(eq(customConnectors.id, id), eq(customConnectors.userId, userId)));

    return { success: true };
  });

  // POST /connectors/custom/:id/invoke — proxy a request through the connector
  app.post("/connectors/custom/:id/invoke", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  } as any, async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid id" });

    const parsed = invokeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const [connector] = await db
      .select()
      .from(customConnectors)
      .where(and(eq(customConnectors.id, id), eq(customConnectors.userId, userId)))
      .limit(1);

    if (!connector) return reply.status(404).send({ error: "Connector not found" });

    const { endpointName, params = {}, credentials = {} } = parsed.data;
    const endpoints = (connector.endpoints as any[]) ?? [];
    const endpoint = endpoints.find((e: any) => e.name === endpointName);
    if (!endpoint) return reply.status(400).send({ error: `Endpoint "${endpointName}" not found` });

    // Build URL with query params for GET
    let url = `${connector.baseUrl}${endpoint.path}`;
    const method = endpoint.method ?? "GET";
    const authHeaders = buildAuthHeaders(
      connector.authType,
      (connector.authConfig as Record<string, unknown>) ?? {},
      credentials,
    );

    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders },
    };

    if (method === "GET" && Object.keys(params).length > 0) {
      url += "?" + new URLSearchParams(params as unknown as Record<string, string>).toString();
    } else if (method !== "GET") {
      fetchOptions.body = JSON.stringify(params);
    }

    const res = await fetch(url, fetchOptions);
    const data = await res.json().catch(() => res.text());

    return { success: res.ok, status: res.status, data };
  });
}

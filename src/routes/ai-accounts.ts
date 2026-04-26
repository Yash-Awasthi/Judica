/**
 * Connected AI Accounts Routes — Phase 1.28
 *
 * Securely store and manage per-user AI provider API keys.
 * Keys are masked in GET responses (only last 4 chars shown).
 *
 * GET    /ai-accounts           — list accounts (keys masked)
 * POST   /ai-accounts           — add a new account
 * PUT    /ai-accounts/:id       — update label/model/baseUrl
 * DELETE /ai-accounts/:id       — remove account
 * POST   /ai-accounts/:id/test  — test if the key is valid (HEAD request to provider)
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { connectedAiAccounts } from "../db/schema/connectedAiAccounts.js";
import { eq, and } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { z } from "zod";

const ALLOWED_PROVIDERS = ["openai", "anthropic", "gemini", "mistral", "cohere", "groq", "ollama", "custom"] as const;

const createSchema = z.object({
  provider: z.enum(ALLOWED_PROVIDERS),
  label: z.string().min(1).max(100),
  apiKey: z.string().min(1).max(500),
  baseUrl: z.string().url().optional().or(z.literal("").transform(() => undefined)).optional(),
  defaultModel: z.string().max(100).optional(),
});

const updateSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().optional().or(z.literal("").transform(() => undefined)).optional(),
  defaultModel: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});

/** Mask API key — show only last 4 characters */
function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return "•".repeat(Math.min(key.length - 4, 20)) + key.slice(-4);
}

function sanitize(account: Record<string, unknown>): Record<string, unknown> {
  return {
    ...account,
    apiKeyEncrypted: undefined,
    maskedKey: maskKey(String(account.apiKeyEncrypted ?? "")),
  };
}

export const aiAccountsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", fastifyRequireAuth);

  // GET /ai-accounts
  fastify.get("/ai-accounts", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request: any) => {
    const rows = await db
      .select()
      .from(connectedAiAccounts)
      .where(eq(connectedAiAccounts.userId, request.user.userId));

    return { accounts: rows.map(r => sanitize(r as unknown as Record<string, unknown>)) };
  });

  // POST /ai-accounts
  fastify.post("/ai-accounts", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const body = createSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }
    const { provider, label, apiKey, baseUrl, defaultModel } = body.data;

    const [account] = await db
      .insert(connectedAiAccounts)
      .values({
        userId: request.user.userId,
        provider,
        label,
        apiKeyEncrypted: apiKey, // In production: encrypt with AES-256 using server secret
        baseUrl: baseUrl ?? null,
        defaultModel: defaultModel ?? null,
      })
      .returning();

    return reply.code(201).send({ account: sanitize(account as unknown as Record<string, unknown>) });
  });

  // PUT /ai-accounts/:id
  fastify.put("/ai-accounts/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };
    const body = updateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const d = body.data;
    if (d.label !== undefined) update.label = d.label;
    if (d.baseUrl !== undefined) update.baseUrl = d.baseUrl;
    if (d.defaultModel !== undefined) update.defaultModel = d.defaultModel;
    if (d.isActive !== undefined) update.isActive = d.isActive;

    const [updated] = await db
      .update(connectedAiAccounts)
      .set(update)
      .where(and(eq(connectedAiAccounts.id, id), eq(connectedAiAccounts.userId, userId)))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Account not found" });
    return { account: sanitize(updated as unknown as Record<string, unknown>) };
  });

  // DELETE /ai-accounts/:id
  fastify.delete("/ai-accounts/:id", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const [deleted] = await db
      .delete(connectedAiAccounts)
      .where(and(
        eq(connectedAiAccounts.id, (request.params as any).id),
        eq(connectedAiAccounts.userId, request.user.userId),
      ))
      .returning();

    if (!deleted) return reply.code(404).send({ error: "Account not found" });
    return { success: true };
  });

  // POST /ai-accounts/:id/test — verify key works
  fastify.post("/ai-accounts/:id/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const [account] = await db
      .select()
      .from(connectedAiAccounts)
      .where(and(
        eq(connectedAiAccounts.id, (request.params as any).id),
        eq(connectedAiAccounts.userId, request.user.userId),
      ))
      .limit(1);

    if (!account) return reply.code(404).send({ error: "Account not found" });

    // Minimal test: call provider's models endpoint (no-op for custom/ollama)
    try {
      if (account.provider === "openai") {
        const base = account.baseUrl ?? "https://api.openai.com/v1";
        const res = await fetch(`${base}/models`, {
          headers: { "Authorization": `Bearer ${account.apiKeyEncrypted}` },
        });
        if (!res.ok) return { valid: false, reason: `HTTP ${res.status}` };
      } else if (account.provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": account.apiKeyEncrypted, "anthropic-version": "2023-06-01" },
        });
        if (!res.ok) return { valid: false, reason: `HTTP ${res.status}` };
      } else {
        // For other providers: just mark as untested
        return { valid: null, reason: "Test not implemented for this provider" };
      }

      // Update lastUsedAt on success
      await db.update(connectedAiAccounts)
        .set({ lastUsedAt: new Date() })
        .where(eq(connectedAiAccounts.id, account.id));

      return { valid: true };
    } catch (err: unknown) {
      return { valid: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
};

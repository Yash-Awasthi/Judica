import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { askProvider } from "../lib/providers.js";
import type { Message, Provider } from "../lib/providers.js";
import { db } from "../lib/drizzle.js";
import { councilConfigs } from "../db/schema/auth.js";
import { eq } from "drizzle-orm";
import logger from "../lib/logger.js";
import { encrypt } from "../lib/crypto.js";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { validateSafeUrl } from "../lib/ssrf.js";

const addProviderBody = z.object({
  name: z.string().min(1),
  type: z.enum(["api", "local", "rpa"]),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  provider: z.enum(["openai", "anthropic", "google", "ollama", "chatgpt", "claude", "deepseek", "gemini"]).optional(),
  baseUrl: z.string().url().optional(),
});

const testProviderBody = z.object({
  type: z.enum(["api", "local", "rpa"]),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
});

const providersPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    try {
      const userId = request.userId!;

      const rows = await db
        .select({ config: councilConfigs.config })
        .from(councilConfigs)
        .where(eq(councilConfigs.userId, userId))
        .limit(1);

      const config = (rows[0]?.config as Record<string, unknown>) || {};
      const providers = (config.providers || []) as Array<Record<string, unknown>>;

      const maskedProviders = providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? "••••••••" + (p.apiKey as string).slice(-4) : null,
      }));

      return { providers: maskedProviders };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Failed to get providers");
      reply.code(500);
      return { error: "Failed to get providers", code: "PROVIDER_FETCH_FAILED" };
    }
  });

    fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const parsed = addProviderBody.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: "Validation failed",
        details: parsed.error.issues.map((e) => ({ field: e.path.join("."), message: e.message })),
      };
    }

    try {
      const userId = request.userId!;
      const { name, type, apiKey, model, baseUrl, provider: providerIdentifier } = parsed.data;

      // R2-10: Validate baseUrl against SSRF before storing
      if (baseUrl) {
        try {
          await validateSafeUrl(baseUrl);
        } catch {
          reply.code(400);
          return { error: "baseUrl points to a restricted or private address", code: "SSRF_BLOCKED" };
        }
      }

      const encryptedKey = encrypt(apiKey);

      const rows = await db
        .select({ config: councilConfigs.config })
        .from(councilConfigs)
        .where(eq(councilConfigs.userId, userId))
        .limit(1);

      const currentConfig = (rows[0]?.config as Record<string, unknown>) || {};
      const providers = (currentConfig.providers || []) as Array<Record<string, unknown>>;

      const newProvider = {
        id: Date.now().toString(),
        name,
        type,
        provider: providerIdentifier,
        apiKey: encryptedKey,
        model,
        baseUrl,
        createdAt: new Date().toISOString(),
      };

      providers.push(newProvider);

      await db
        .insert(councilConfigs)
        .values({ userId, config: { ...currentConfig, providers }, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: councilConfigs.userId,
          set: { config: { ...currentConfig, providers }, updatedAt: new Date() },
        });

      reply.code(201);
      return {
        provider: {
          ...newProvider,
          apiKey: "••••••••" + apiKey.slice(-4),
        },
      };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Failed to add provider");
      reply.code(500);
      return { error: "Failed to add provider", code: "PROVIDER_CREATE_FAILED" };
    }
  });

    fastify.post("/test", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const parsed = testProviderBody.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: "Validation failed",
        details: parsed.error.issues.map((e) => ({ field: e.path.join("."), message: e.message })),
      };
    }

    try {
      const { type, apiKey, model, baseUrl } = parsed.data;

      const provider: Provider = {
        name: "Test Provider",
        type,
        apiKey,
        model,
        baseUrl,
      };

      const messages: Message[] = [
        { role: "user", content: "Say 'Hello, I am working!' in exactly 5 words." },
      ];

      const startTime = Date.now();
      const response = await askProvider(provider, messages, false);
      const latency = Date.now() - startTime;

      return {
        success: true,
        response: response.text,
        usage: response.usage,
        latencyMs: latency,
      };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Provider test failed");
      reply.code(400);
      return { success: false, error: (err as Error).message };
    }
  });

    fastify.delete<{ Params: { id: string } }>("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    try {
      const userId = request.userId!;
      const { id } = request.params;

      const rows = await db
        .select({ config: councilConfigs.config })
        .from(councilConfigs)
        .where(eq(councilConfigs.userId, userId))
        .limit(1);

      const currentConfig = (rows[0]?.config as Record<string, unknown>) || {};
      const providers = (currentConfig.providers || []) as Array<Record<string, unknown>>;

      const filteredProviders = providers.filter((p) => p.id !== id);

      if (filteredProviders.length === providers.length) {
        reply.code(404);
        return { error: "Provider not found" };
      }

      await db
        .insert(councilConfigs)
        .values({ userId, config: { ...currentConfig, providers: filteredProviders }, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: councilConfigs.userId,
          set: { config: { ...currentConfig, providers: filteredProviders }, updatedAt: new Date() },
        });

      return { message: "Provider deleted" };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Failed to delete provider");
      reply.code(500);
      return { error: "Failed to delete provider", code: "PROVIDER_DELETE_FAILED" };
    }
  });
};

export default providersPlugin;

import { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { encrypt } from "../lib/crypto.js";
import { registerAdapter, deregisterAdapter, listAvailableProviders, getAdapterOrNull } from "../adapters/registry.js";
import { CustomAdapter, type CustomProviderConfig } from "../adapters/custom.adapter.js";
import { db } from "../lib/drizzle.js";
import { customProviders } from "../db/schema/council.js";
import { eq, and } from "drizzle-orm";
import logger from "../lib/logger.js";
import { validateSafeUrl } from "../lib/ssrf.js";

const customProvidersPlugin: FastifyPluginAsync = async (fastify) => {
    fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;

    // Built-in providers
    const builtIn = listAvailableProviders()
      .filter((id) => !id.startsWith("custom_"))
      .map((id) => ({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        type: "builtin" as const,
        available: true,
      }));

    // Custom providers
    const custom = await db
      .select({
        id: customProviders.id,
        name: customProviders.name,
        baseUrl: customProviders.baseUrl,
        authType: customProviders.authType,
        capabilities: customProviders.capabilities,
        models: customProviders.models,
        createdAt: customProviders.createdAt,
        updatedAt: customProviders.updatedAt,
      })
      .from(customProviders)
      .where(eq(customProviders.userId, userId));

    const customMapped = custom.map((cp) => ({
      id: `custom_${cp.id}`,
      name: cp.name,
      type: "custom" as const,
      baseUrl: cp.baseUrl,
      authType: cp.authType,
      capabilities: cp.capabilities,
      models: cp.models,
      createdAt: cp.createdAt,
      updatedAt: cp.updatedAt,
      available: getAdapterOrNull(`custom_${cp.id}`) !== null,
    }));

    return { providers: [...builtIn, ...customMapped] };
  });

    fastify.post("/custom", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const { name, base_url, auth_type, auth_key, auth_header_name, capabilities, models } = request.body as { name?: string; base_url?: string; auth_type?: string; auth_key?: string; auth_header_name?: string; capabilities?: Record<string, boolean>; models?: string[] };

    if (!name || !base_url || !auth_type) {
      throw new AppError(400, "name, base_url, and auth_type are required", "VALIDATION_ERROR");
    }

    // Validate base_url against SSRF (block private IPs, cloud metadata, etc.)
    try {
      await validateSafeUrl(base_url);
    } catch {
      throw new AppError(400, "base_url points to a restricted or private address", "SSRF_BLOCKED");
    }

    if (!models || !Array.isArray(models) || models.length === 0) {
      throw new AppError(400, "At least one model must be specified", "VALIDATION_ERROR");
    }

    // Encrypt the auth key
    const encryptedKey = auth_key ? encrypt(auth_key) : "";

    const [created] = await db
      .insert(customProviders)
      .values({
        userId,
        name,
        baseUrl: base_url,
        authType: auth_type,
        authKey: encryptedKey,
        authHeaderName: auth_header_name || null,
        capabilities: capabilities || { streaming: true, tools: false, vision: false },
        models,
        updatedAt: new Date(),
      })
      .returning();

    // Register the adapter in the registry
    const config: CustomProviderConfig = {
      id: String(created.id),
      name: created.name,
      base_url: created.baseUrl,
      auth_type: created.authType as CustomProviderConfig["auth_type"],
      auth_key_encrypted: created.authKey,
      auth_header_name: created.authHeaderName || undefined,
      capabilities: created.capabilities as CustomProviderConfig["capabilities"],
      models: created.models,
    };

    registerAdapter(`custom_${created.id}`, new CustomAdapter(config));

    logger.info({ providerId: `custom_${created.id}`, name }, "Custom provider created");

    reply.code(201);
    return {
      id: `custom_${created.id}`,
      name: created.name,
      baseUrl: created.baseUrl,
      authType: created.authType,
      capabilities: created.capabilities,
      models: created.models,
    };
  });

    fastify.put("/custom/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;
    const providerId = parseInt((request.params as { id: string }).id, 10);

    const [existing] = await db
      .select()
      .from(customProviders)
      .where(and(eq(customProviders.id, providerId), eq(customProviders.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new AppError(404, "Custom provider not found", "NOT_FOUND");
    }

    const { name, base_url, auth_type, auth_key, auth_header_name, capabilities, models } = request.body as { name?: string; base_url?: string; auth_type?: string; auth_key?: string; auth_header_name?: string; capabilities?: Record<string, boolean>; models?: string[] };

    const updateData: Record<string, unknown> = {};
    if (name) updateData.name = name;
    if (base_url) updateData.baseUrl = base_url;
    if (auth_type) updateData.authType = auth_type;
    if (auth_key) updateData.authKey = encrypt(auth_key);
    if (auth_header_name !== undefined) updateData.authHeaderName = auth_header_name;
    if (capabilities) updateData.capabilities = capabilities;
    if (models) updateData.models = models;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(customProviders)
      .set(updateData)
      .where(eq(customProviders.id, providerId))
      .returning();

    // Re-register adapter
    const config: CustomProviderConfig = {
      id: String(updated.id),
      name: updated.name,
      base_url: updated.baseUrl,
      auth_type: updated.authType as CustomProviderConfig["auth_type"],
      auth_key_encrypted: updated.authKey,
      auth_header_name: updated.authHeaderName || undefined,
      capabilities: updated.capabilities as CustomProviderConfig["capabilities"],
      models: updated.models,
    };

    deregisterAdapter(`custom_${updated.id}`);
    registerAdapter(`custom_${updated.id}`, new CustomAdapter(config));

    return {
      id: `custom_${updated.id}`,
      name: updated.name,
      baseUrl: updated.baseUrl,
      authType: updated.authType,
      capabilities: updated.capabilities,
      models: updated.models,
    };
  });

    fastify.delete("/custom/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;
    const providerId = parseInt((request.params as { id: string }).id, 10);

    const [existing] = await db
      .select()
      .from(customProviders)
      .where(and(eq(customProviders.id, providerId), eq(customProviders.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new AppError(404, "Custom provider not found", "NOT_FOUND");
    }

    await db.delete(customProviders).where(eq(customProviders.id, providerId));
    deregisterAdapter(`custom_${providerId}`);

    logger.info({ providerId: `custom_${providerId}` }, "Custom provider deleted");
    return { deleted: true };
  });

    fastify.post("/custom/:id/test", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;
    const providerId = parseInt((request.params as { id: string }).id, 10);

    const [existing] = await db
      .select()
      .from(customProviders)
      .where(and(eq(customProviders.id, providerId), eq(customProviders.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new AppError(404, "Custom provider not found", "NOT_FOUND");
    }

    const adapter = getAdapterOrNull(`custom_${providerId}`);
    if (!adapter) {
      throw new AppError(500, "Adapter not registered", "ADAPTER_NOT_FOUND");
    }

    try {
      const result = await adapter.generate({
        model: existing.models[0],
        messages: [{ role: "user", content: "Say 'hello' in one word." }],
        max_tokens: 10,
      });

      const collected = await result.collect();
      return {
        success: true,
        response: collected.text.slice(0, 100),
        usage: collected.usage,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  });

    fastify.get("/:providerId/models", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { providerId } = request.params as { providerId: string };

    const adapter = getAdapterOrNull(providerId as string);
    if (!adapter) {
      throw new AppError(404, `Provider "${providerId}" not found`, "NOT_FOUND");
    }

    const models = await adapter.listModels();
    return { provider: providerId, models };
  });
};

export default customProvidersPlugin;

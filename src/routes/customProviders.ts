import { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { encrypt, decrypt, mask } from "../lib/crypto.js";
import { registerAdapter, deregisterAdapter, listAvailableProviders, getAdapterOrNull } from "../adapters/registry.js";
import { CustomAdapter, type CustomProviderConfig } from "../adapters/custom.adapter.js";
import { db } from "../lib/drizzle.js";
import { customProviders } from "../db/schema/council.js";
import { eq, and } from "drizzle-orm";
import logger from "../lib/logger.js";

const customProvidersPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /api/custom-providers:
   *   get:
   *     tags:
   *       - Providers
   *     summary: List all providers (built-in and custom)
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Combined list of built-in and custom providers
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 providers:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       name:
   *                         type: string
   *                       type:
   *                         type: string
   *                         enum:
   *                           - builtin
   *                           - custom
   *                       baseUrl:
   *                         type: string
   *                       authType:
   *                         type: string
   *                       capabilities:
   *                         type: object
   *                       models:
   *                         type: array
   *                         items:
   *                           type: string
   *                       available:
   *                         type: boolean
   *       401:
   *         description: Unauthorized
   */
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /api/custom-providers/custom:
   *   post:
   *     tags:
   *       - Providers
   *     summary: Create a custom provider
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - base_url
   *               - auth_type
   *               - models
   *             properties:
   *               name:
   *                 type: string
   *               base_url:
   *                 type: string
   *                 format: uri
   *               auth_type:
   *                 type: string
   *               auth_key:
   *                 type: string
   *               auth_header_name:
   *                 type: string
   *               capabilities:
   *                 type: object
   *                 properties:
   *                   streaming:
   *                     type: boolean
   *                   tools:
   *                     type: boolean
   *                   vision:
   *                     type: boolean
   *               models:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       201:
   *         description: Custom provider created
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                 name:
   *                   type: string
   *                 baseUrl:
   *                   type: string
   *                 authType:
   *                   type: string
   *                 capabilities:
   *                   type: object
   *                 models:
   *                   type: array
   *                   items:
   *                     type: string
   *       400:
   *         description: Validation error
   *       401:
   *         description: Unauthorized
   */
  fastify.post("/custom", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const { name, base_url, auth_type, auth_key, auth_header_name, capabilities, models } = request.body as any;

    if (!name || !base_url || !auth_type) {
      throw new AppError(400, "name, base_url, and auth_type are required", "VALIDATION_ERROR");
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

  /**
   * @openapi
   * /api/custom-providers/custom/{id}:
   *   put:
   *     tags:
   *       - Providers
   *     summary: Update a custom provider
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Custom provider ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               base_url:
   *                 type: string
   *                 format: uri
   *               auth_type:
   *                 type: string
   *               auth_key:
   *                 type: string
   *               auth_header_name:
   *                 type: string
   *               capabilities:
   *                 type: object
   *               models:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Updated custom provider
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Custom provider not found
   */
  fastify.put("/custom/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const providerId = parseInt((request.params as any).id, 10);

    const [existing] = await db
      .select()
      .from(customProviders)
      .where(and(eq(customProviders.id, providerId), eq(customProviders.userId, userId)))
      .limit(1);

    if (!existing) {
      throw new AppError(404, "Custom provider not found", "NOT_FOUND");
    }

    const { name, base_url, auth_type, auth_key, auth_header_name, capabilities, models } = request.body as any;

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

  /**
   * @openapi
   * /api/custom-providers/custom/{id}:
   *   delete:
   *     tags:
   *       - Providers
   *     summary: Delete a custom provider
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Custom provider ID
   *     responses:
   *       200:
   *         description: Custom provider deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 deleted:
   *                   type: boolean
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Custom provider not found
   */
  fastify.delete("/custom/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const providerId = parseInt((request.params as any).id, 10);

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

  /**
   * @openapi
   * /api/custom-providers/custom/{id}/test:
   *   post:
   *     tags:
   *       - Providers
   *     summary: Test a custom provider connection
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Custom provider ID
   *     responses:
   *       200:
   *         description: Test result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 response:
   *                   type: string
   *                 usage:
   *                   type: object
   *                 error:
   *                   type: string
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Custom provider not found
   */
  fastify.post("/custom/:id/test", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const providerId = parseInt((request.params as any).id, 10);

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

  /**
   * @openapi
   * /api/custom-providers/{providerId}/models:
   *   get:
   *     tags:
   *       - Providers
   *     summary: List models for a provider
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: providerId
   *         required: true
   *         schema:
   *           type: string
   *         description: Provider identifier
   *     responses:
   *       200:
   *         description: List of models
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 provider:
   *                   type: string
   *                 models:
   *                   type: array
   *                   items:
   *                     type: object
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Provider not found
   */
  fastify.get("/:providerId/models", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { providerId } = request.params as any;

    const adapter = getAdapterOrNull(providerId as string);
    if (!adapter) {
      throw new AppError(404, `Provider "${providerId}" not found`, "NOT_FOUND");
    }

    const models = await adapter.listModels();
    return { provider: providerId, models };
  });
};

export default customProvidersPlugin;

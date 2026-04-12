import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { encrypt, decrypt, mask } from "../lib/crypto.js";
import { registerAdapter, deregisterAdapter, listAvailableProviders, getAdapterOrNull } from "../adapters/registry.js";
import { CustomAdapter, type CustomProviderConfig } from "../adapters/custom.adapter.js";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import type { AuthRequest } from "../types/index.js";

const router = Router();

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
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

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
  const custom = await prisma.customProvider.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      baseUrl: true,
      authType: true,
      capabilities: true,
      models: true,
      createdAt: true,
      updatedAt: true,
    },
  });

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

  res.json({ providers: [...builtIn, ...customMapped] });
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
router.post("/custom", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { name, base_url, auth_type, auth_key, auth_header_name, capabilities, models } = req.body;

  if (!name || !base_url || !auth_type) {
    throw new AppError(400, "name, base_url, and auth_type are required", "VALIDATION_ERROR");
  }

  if (!models || !Array.isArray(models) || models.length === 0) {
    throw new AppError(400, "At least one model must be specified", "VALIDATION_ERROR");
  }

  // Encrypt the auth key
  const encryptedKey = auth_key ? encrypt(auth_key) : "";

  const created = await prisma.customProvider.create({
    data: {
      userId,
      name,
      baseUrl: base_url,
      authType: auth_type,
      authKey: encryptedKey,
      authHeaderName: auth_header_name || null,
      capabilities: capabilities || { streaming: true, tools: false, vision: false },
      models,
    },
  });

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

  res.status(201).json({
    id: `custom_${created.id}`,
    name: created.name,
    baseUrl: created.baseUrl,
    authType: created.authType,
    capabilities: created.capabilities,
    models: created.models,
  });
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
router.put("/custom/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const providerId = parseInt(req.params.id as string, 10);

  const existing = await prisma.customProvider.findFirst({
    where: { id: providerId, userId },
  });

  if (!existing) {
    throw new AppError(404, "Custom provider not found", "NOT_FOUND");
  }

  const { name, base_url, auth_type, auth_key, auth_header_name, capabilities, models } = req.body;

  const updateData: Record<string, unknown> = {};
  if (name) updateData.name = name;
  if (base_url) updateData.baseUrl = base_url;
  if (auth_type) updateData.authType = auth_type;
  if (auth_key) updateData.authKey = encrypt(auth_key);
  if (auth_header_name !== undefined) updateData.authHeaderName = auth_header_name;
  if (capabilities) updateData.capabilities = capabilities;
  if (models) updateData.models = models;

  const updated = await prisma.customProvider.update({
    where: { id: providerId },
    data: updateData,
  });

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

  res.json({
    id: `custom_${updated.id}`,
    name: updated.name,
    baseUrl: updated.baseUrl,
    authType: updated.authType,
    capabilities: updated.capabilities,
    models: updated.models,
  });
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
router.delete("/custom/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const providerId = parseInt(req.params.id as string, 10);

  const existing = await prisma.customProvider.findFirst({
    where: { id: providerId, userId },
  });

  if (!existing) {
    throw new AppError(404, "Custom provider not found", "NOT_FOUND");
  }

  await prisma.customProvider.delete({ where: { id: providerId } });
  deregisterAdapter(`custom_${providerId}`);

  logger.info({ providerId: `custom_${providerId}` }, "Custom provider deleted");
  res.json({ deleted: true });
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
router.post("/custom/:id/test", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const providerId = parseInt(req.params.id as string, 10);

  const existing = await prisma.customProvider.findFirst({
    where: { id: providerId, userId },
  });

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
    res.json({
      success: true,
      response: collected.text.slice(0, 100),
      usage: collected.usage,
    });
  } catch (err) {
    res.json({
      success: false,
      error: (err as Error).message,
    });
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
router.get("/:providerId/models", requireAuth, async (req: AuthRequest, res: Response) => {
  const { providerId } = req.params;

  const adapter = getAdapterOrNull(providerId as string);
  if (!adapter) {
    throw new AppError(404, `Provider "${providerId}" not found`, "NOT_FOUND");
  }

  const models = await adapter.listModels();
  res.json({ provider: providerId, models });
});

export default router;

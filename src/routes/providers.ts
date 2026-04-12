import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { askProvider, Message, Provider } from "../lib/providers.js";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

/**
 * @openapi
 * /api/providers:
 *   get:
 *     tags:
 *       - Providers
 *     summary: List configured providers (API keys masked)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of providers with masked API keys
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
 *                       model:
 *                         type: string
 *                       apiKey:
 *                         type: string
 *                         description: Masked API key
 *       401:
 *         description: Unauthorized
 */
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { councilConfig: true },
    });

    const config = user?.councilConfig?.config as any;
    const providers = config?.providers || [];

    const maskedProviders = providers.map((p: any) => ({
      ...p,
      apiKey: p.apiKey ? "••••••••" + p.apiKey.slice(-4) : null,
    }));

    res.json({ providers: maskedProviders });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to get providers");
    throw new AppError(500, "Failed to get providers", "PROVIDERS_FETCH_FAILED");
  }
});

const addProviderSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    type: z.enum(["api", "local", "rpa"]),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    provider: z.enum(["openai", "anthropic", "google", "ollama", "chatgpt", "claude", "deepseek", "gemini"]).optional(),
    baseUrl: z.string().url().optional(),
  }),
});

/**
 * @openapi
 * /api/providers:
 *   post:
 *     tags:
 *       - Providers
 *     summary: Add a new provider
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
 *               - type
 *               - apiKey
 *               - model
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum:
 *                   - api
 *                   - local
 *                   - rpa
 *               apiKey:
 *                 type: string
 *               model:
 *                 type: string
 *               provider:
 *                 type: string
 *                 enum:
 *                   - openai
 *                   - anthropic
 *                   - google
 *                   - ollama
 *                   - chatgpt
 *                   - claude
 *                   - deepseek
 *                   - gemini
 *               baseUrl:
 *                 type: string
 *                 format: uri
 *     responses:
 *       201:
 *         description: Provider added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 provider:
 *                   type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", requireAuth, validate(addProviderSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { name, type, apiKey, model, baseUrl, provider: providerIdentifier } = req.body;

    const encryptedKey = encrypt(apiKey);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { councilConfig: true },
    });

    const currentConfig = (user?.councilConfig?.config as any) || {};
    const providers = currentConfig.providers || [];

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

    await prisma.councilConfig.upsert({
      where: { userId },
      update: { config: { ...currentConfig, providers } },
      create: { userId, config: { ...currentConfig, providers } },
    });

    res.status(201).json({
      provider: {
        ...newProvider,
        apiKey: "••••••••" + apiKey.slice(-4),
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to add provider");
    throw new AppError(500, "Failed to add provider", "PROVIDER_CREATE_FAILED");
  }
});

const testProviderSchema = z.object({
  body: z.object({
    type: z.enum(["api", "local", "rpa"]),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    baseUrl: z.string().url().optional(),
  }),
});

/**
 * @openapi
 * /api/providers/test:
 *   post:
 *     tags:
 *       - Providers
 *     summary: Test a provider connection
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - apiKey
 *               - model
 *             properties:
 *               type:
 *                 type: string
 *                 enum:
 *                   - api
 *                   - local
 *                   - rpa
 *               apiKey:
 *                 type: string
 *               model:
 *                 type: string
 *               baseUrl:
 *                 type: string
 *                 format: uri
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
 *                 latencyMs:
 *                   type: integer
 *       400:
 *         description: Test failed or validation error
 */
router.post("/test", validate(testProviderSchema), async (req: Request, res: Response) => {
  try {
    const { type, apiKey, model, baseUrl } = req.body;

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

    res.json({
      success: true,
      response: response.text,
      usage: response.usage,
      latencyMs: latency,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Provider test failed");
    res.status(400).json({
      success: false,
      error: (err as Error).message,
    });
  }
});

/**
 * @openapi
 * /api/providers/{id}:
 *   delete:
 *     tags:
 *       - Providers
 *     summary: Delete a provider
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Provider ID
 *     responses:
 *       200:
 *         description: Provider deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Provider not found
 */
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { councilConfig: true },
    });

    const currentConfig = (user?.councilConfig?.config as any) || {};
    const providers = currentConfig.providers || [];

    const filteredProviders = providers.filter((p: any) => p.id !== id);

    if (filteredProviders.length === providers.length) {
      return res.status(404).json({ error: "Provider not found" });
    }

    await prisma.councilConfig.upsert({
      where: { userId },
      update: { config: { ...currentConfig, providers: filteredProviders } },
      create: { userId, config: { ...currentConfig, providers: filteredProviders } },
    });

    res.json({ message: "Provider deleted" });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to delete provider");
    throw new AppError(500, "Failed to delete provider", "PROVIDER_DELETE_FAILED");
  }
});

export default router;

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
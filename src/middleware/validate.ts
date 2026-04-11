import { Request, Response, NextFunction } from "express";
import { z, ZodSchema } from "zod";

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.issues.map((e: any) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

export const providerSchema = z.object({
  name: z.string().min(1).max(50),
  type: z.string().min(1).max(20).default("api"),
  apiKey: z.string().max(1000).optional().or(z.literal("")),
  model: z.string().min(1).max(100),
  baseUrl: z.string().url().optional().or(z.literal("")),
  systemPrompt: z.string().max(2000).optional(),
  maxTokens: z.number().int().min(256).max(8192).optional(),
});

export const askSchema = z
  .object({
    question: z
      .string()
      .min(1, "Question cannot be empty")
      .max(4000, "Question too long"),
    conversationId: z.string().uuid().optional(),
    members: z
      .array(providerSchema)
      .min(1, "At least one council member required")
      .max(15)
      .optional(),
    master: providerSchema.optional(),
    summon: z.enum(["business", "technical", "personal", "creative", "ethical", "strategy", "default"]).optional(),
    mode: z.enum(["auto", "manual"]).default("manual"),
    maxTokens: z.number().int().min(256).max(8192).optional(),
    rounds: z.number().int().min(1).max(5).default(1),
    anonymous: z.boolean().default(false),
    context: z.string().max(100000).optional(),
    upload_ids: z.array(z.string()).max(10).optional(),
    kb_id: z.string().optional(),
    userConfig: z.object({
      providers: z.array(z.object({
        name: z.string(),
        enabled: z.boolean(),
        role: z.enum(["member", "master"]).optional(),
        priority: z.number().optional()
      })).optional(),
      maxAgents: z.number().int().min(1).max(6).optional(),
      allowRPA: z.boolean().optional(),
      preferLocalMix: z.boolean().optional()
    }).optional()
  });

export const renameConversationSchema = z.object({
  title: z.string().min(1, "Title cannot be empty").max(100, "Title too long")
});

export const archetypeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/).max(50),
  name: z.string().min(1).max(50),
  thinkingStyle: z.string().max(200).optional(),
  asks: z.string().max(200).optional(),
  blindSpot: z.string().max(200).optional(),
  systemPrompt: z.string().min(10).max(5000),
  tools: z.array(z.string()).optional(),
});

export const forkSchema = z.object({
  toChatId: z.number().int(),
});

export const authSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, underscores"),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
});

export const configSchema = z
  .object({
    config: z.object({
      members: z.array(providerSchema).min(1).max(15),
      masterIndex: z.number().int().min(0),
    }),
  })
  .refine((data) => data.config.masterIndex < data.config.members.length, {
    message: "masterIndex is out of range for the members array",
    path: ["config", "masterIndex"],
  });
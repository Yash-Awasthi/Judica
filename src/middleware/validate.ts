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

// ── Schemas ───────────────────────────────────────────

export const providerSchema = z.object({
  name: z.string().min(1).max(50),
  type: z.enum(["openai-compat", "anthropic", "google"]),
  apiKey: z.string().min(1),
  model: z.string().min(1).max(100),
  baseUrl: z.string().url().optional().or(z.literal("")),
  systemPrompt: z.string().max(1000).optional(),
});

export const askSchema = z.object({
  question: z.string().min(1, "Question cannot be empty").max(2000, "Question too long"),
  members: z.array(providerSchema).min(1, "At least one council member required").max(10),
  master: providerSchema,
});

export const authSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(30).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, underscores"),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
});

export const configSchema = z.object({
  config: z.object({
    members: z.array(providerSchema),
    masterIndex: z.number().int().min(0),
  }),
});
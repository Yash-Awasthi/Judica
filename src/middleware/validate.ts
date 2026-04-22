import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { ZodSchema } from "zod";

/**
 * Fastify-compatible validation preHandler hook.
 */
export function fastifyValidate(schema: ZodSchema) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      reply.code(400).send({
        error: "Validation failed",
        details: result.error.issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }
    request.body = result.data;
  };
}

export const providerSchema = z.object({
  name: z.string().min(1).max(50),
  type: z.string().min(1).max(20).default("api"),
  apiKey: z.string().max(1000).optional().or(z.literal("")),
  model: z.string().min(1).max(100),
  // P1-24: Restrict baseUrl to http/https protocols only
  baseUrl: z.string().url().refine(
    (url) => /^https?:\/\//i.test(url),
    { message: "baseUrl must use http or https protocol" }
  ).optional().or(z.literal("")),
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
    // P8-53: Cap members array to prevent cost explosion (archetypes × member count)
    members: z
      .array(providerSchema)
      .min(1, "At least one council member required")
      .max(10, "Maximum 10 council members allowed")
      .optional(),
    master: providerSchema.optional(),
    summon: z.enum(["business", "technical", "personal", "creative", "ethical", "strategy", "debate", "research", "default"]).optional(),
    mode: z.enum(["auto", "manual", "direct"]).default("manual"),
    maxTokens: z.number().int().min(256).max(8192).optional(),
    rounds: z.number().int().min(1).max(5).default(1),
    anonymous: z.boolean().default(false),
    context: z.string().max(20000).optional(),  // M-3: reduced from 100000 to limit prompt injection payload size
    upload_ids: z.array(z.string()).max(10).optional(),
    kb_id: z.string().uuid("kb_id must be a valid UUID").optional(),  // M-3: enforce UUID format
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
    }).optional(),
    deliberation_mode: z.enum(["standard", "socratic", "red_blue", "hypothesis", "confidence"]).default("standard"),
    repo_id: z.string().optional(),
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
  // P8-54: NIST SP 800-63B recommends min 12 chars + at least one non-alpha character
  password: z.string()
    .min(12, "Password must be at least 12 characters")
    .max(100)
    .refine((pw) => /[^a-zA-Z]/.test(pw), {
      message: "Password must contain at least one non-alphabetic character (number, symbol, etc.)",
    }),
});

// P1-15: Strict schema for PUT /settings — whitelist known keys
export const userSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  language: z.string().min(2).max(10).optional(),
  fontSize: z.number().int().min(10).max(32).optional(),
  showTimestamps: z.boolean().optional(),
  defaultModel: z.string().max(100).optional(),
  defaultMaxTokens: z.number().int().min(256).max(8192).optional(),
  notificationsEnabled: z.boolean().optional(),
  streamResponses: z.boolean().optional(),
  sidebarCollapsed: z.boolean().optional(),
  deliberationMode: z.enum(["standard", "socratic", "red_blue", "hypothesis", "confidence"]).optional(),
}).strict();

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

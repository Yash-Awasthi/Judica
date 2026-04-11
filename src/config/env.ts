import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL").default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  MASTER_ENCRYPTION_KEY: z.string().min(32, "MASTER_ENCRYPTION_KEY must be at least 32 characters"),
  PORT: z.string().default("3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  ALLOWED_ORIGINS: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  SYSTEM_PROMPT: z.string().optional(),
  TRUST_PROXY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  XIAOMI_MIMO_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  CEREBRAS_API_KEY: z.string().optional(),
  COHERE_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional().default("http://localhost:11434"),
  SERP_API_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  PROVIDER_REGISTRY_CONFIG: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  CURRENT_ENCRYPTION_VERSION: z.string().regex(/^\d+$/).default("1"),
  ENABLE_VECTOR_CACHE: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  parsed.error.issues.forEach((e: any) => {
    console.error(`   ${e.path.join(".")}: ${e.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;

if (!parsed.data.OPENAI_API_KEY && !parsed.data.ANTHROPIC_API_KEY && !parsed.data.GOOGLE_API_KEY) {
  console.warn("⚠️  No AI provider API keys found (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY). All council requests will fail at runtime.");
}
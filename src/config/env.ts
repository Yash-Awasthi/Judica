import "dotenv/config";
import { z } from "zod";

// P1-31: TRUST_PROXY validation — accept boolean, number, or comma-separated CIDRs
const trustProxySchema = z.string().optional().transform((val) => {
  if (!val) return undefined;
  if (val === "true") return true;
  if (val === "false") return false;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 0) return num;
  // Accept comma-separated IPs/CIDRs
  return val;
});

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL").default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  MASTER_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "MASTER_ENCRYPTION_KEY must be a hex-encoded 32-byte (64 hex chars) key"),
  // P1-30: Coerce PORT to a validated integer
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  // P40-05: Add upper bound on rate limit to prevent accidental disabling
  RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10000).default(10),
  ALLOWED_ORIGINS: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  SYSTEM_PROMPT: z.string().optional(),
  // P1-31: Validate TRUST_PROXY as boolean/number/CIDR
  TRUST_PROXY: trustProxySchema,
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
  // P1-32: Add missing env vars
  LANGFUSE_BASEURL: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),
  GRACEFUL_SHUTDOWN_MS: z.coerce.number().int().positive().default(10_000),
  PROVIDER_REGISTRY_CONFIG: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  CURRENT_ENCRYPTION_VERSION: z.string().regex(/^\d+$/).default("1"),
  ENABLE_VECTOR_CACHE: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  OAUTH_CALLBACK_BASE_URL: z.string().optional().default("http://localhost:3000"),
});

// P1-34: Warn about unknown env vars that look like typos of known keys
const KNOWN_KEYS = new Set(Object.keys(envSchema.shape));
const ENV_PREFIXES = ["DATABASE_", "REDIS_", "JWT_", "MASTER_", "PORT", "NODE_", "RATE_LIMIT_", "ALLOWED_", "TAVILY_", "SYSTEM_", "TRUST_", "OPENAI_", "ANTHROPIC_", "GOOGLE_", "OPENROUTER_", "NVIDIA_", "XIAOMI_", "GROQ_", "MISTRAL_", "CEREBRAS_", "COHERE_", "OLLAMA_", "SERP_", "LANGFUSE_", "PROVIDER_", "FRONTEND_", "CURRENT_", "ENABLE_", "GITHUB_", "OAUTH_", "OTEL_", "SENTRY_", "SMTP_", "GRACEFUL_"];
for (const key of Object.keys(process.env)) {
  if (!KNOWN_KEYS.has(key) && ENV_PREFIXES.some(p => key.startsWith(p))) {
    process.stderr.write(`WARNING: Unknown env var '${key}' looks like a typo of a known config key\n`);
  }
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // P1-33: Throw instead of process.exit(1) — allows test runners to catch
  const messages = parsed.error.issues.map(i => `   ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${messages}`);
}

export const env = parsed.data;

if (!parsed.data.OPENAI_API_KEY && !parsed.data.ANTHROPIC_API_KEY && !parsed.data.GOOGLE_API_KEY) {
  process.stderr.write("WARNING: No AI provider API keys found (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY). All council requests will fail at runtime.\n");
}

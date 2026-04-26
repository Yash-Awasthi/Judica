import "dotenv/config";
import { z } from "zod";

// M-5: Validate each CIDR/IP entry to prevent misconfigured TRUST_PROXY from
// enabling IP spoofing (e.g. "0.0.0.0/0" would trust any X-Forwarded-For).
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

// TRUST_PROXY validation — accept boolean, number, or comma-separated CIDRs
const trustProxySchema = z.string().optional().transform((val, ctx) => {
  if (!val) return undefined;
  if (val === "true") return true;
  if (val === "false") return false;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 0) return num;
  // Validate each comma-separated IP/CIDR entry
  const parts = val.split(",").map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (!CIDR_RE.test(part)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `TRUST_PROXY contains invalid IP/CIDR: '${part}'. Use a valid IPv4 address or CIDR range.`,
      });
      return z.NEVER;
    }
  }
  return val;
});

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL").default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  MASTER_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "MASTER_ENCRYPTION_KEY must be a hex-encoded 32-byte (64 hex chars) key"),
  // Coerce PORT to a validated integer
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  // Add upper bound on rate limit to prevent accidental disabling
  RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10000).default(10),
  ALLOWED_ORIGINS: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  SYSTEM_PROMPT: z.string().optional(),
  // Validate TRUST_PROXY as boolean/number/CIDR
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
  OLLAMA_BASE_URL: z.string().url().optional().default("http://localhost:11434"),
  SERP_API_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  // Add missing env vars
  LANGFUSE_BASEURL: z.string().url().optional(),
  OTEL_ENABLED: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
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
  // SSO / SAML / OIDC
  SSO_ENABLED: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
  SSO_CALLBACK_BASE_URL: z.string().optional(),
  // Slack bot integration
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().optional(),
  SLACK_API_BASE_URL: z.string().optional(),
  SLACK_INTERNAL_API_KEY: z.string().optional(),
  // Discord bot
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_APPLICATION_ID: z.string().optional(),
  DISCORD_PUBLIC_KEY: z.string().optional(),
  // CAPTCHA
  CAPTCHA_PROVIDER: z.enum(["recaptcha", "hcaptcha", "turnstile", "none"]).optional(),
  RECAPTCHA_SITE_KEY: z.string().optional(),
  RECAPTCHA_SECRET_KEY: z.string().optional(),
  RECAPTCHA_MIN_SCORE: z.coerce.number().min(0).max(1).optional(),
  HCAPTCHA_SITE_KEY: z.string().optional(),
  HCAPTCHA_SECRET_KEY: z.string().optional(),
  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  // Image generation
  AZURE_OPENAI_IMAGE_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_IMAGE_KEY: z.string().optional(),
  GOOGLE_VERTEX_PROJECT: z.string().optional(),
  GOOGLE_VERTEX_LOCATION: z.string().optional(),
  STABILITY_API_KEY: z.string().optional(),
  REPLICATE_API_TOKEN: z.string().optional(),
  // Voice providers
  ELEVENLABS_API_KEY: z.string().optional(),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  // Web search providers
  WEB_SEARCH_PROVIDER: z.enum(["tavily", "serpapi", "serper", "brave", "google_pse", "searxng"]).optional(),
  SERPER_API_KEY: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  GOOGLE_PSE_API_KEY: z.string().optional(),
  GOOGLE_PSE_CX: z.string().optional(),
  SEARXNG_BASE_URL: z.string().url().optional(),
  // Web scraping / extraction
  FIRECRAWL_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  // LiteLLM proxy gateway
  LITELLM_API_KEY: z.string().optional(),
  LITELLM_BASE_URL: z.string().url().optional(),
  // vLLM self-hosted inference
  VLLM_BASE_URL: z.string().url().optional(),
  VLLM_API_KEY: z.string().optional(),
  // Connector webhook secrets
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  CONFLUENCE_WEBHOOK_TOKEN: z.string().optional(),
  NOTION_WEBHOOK_TOKEN: z.string().optional(),
  GOOGLE_DRIVE_WEBHOOK_TOKEN: z.string().optional(),
  // Stripe billing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Vector DB backend selection
  VECTOR_DB_BACKEND: z.enum(["pgvector", "vespa", "weaviate", "pinecone"]).optional(),
  // Vespa search backend
  VESPA_ENDPOINT: z.string().url().optional(),
  VESPA_APP_NAME: z.string().optional(),
  VESPA_NAMESPACE: z.string().optional(),
  // Weaviate vector DB
  WEAVIATE_URL: z.string().url().optional(),
  WEAVIATE_API_KEY: z.string().optional(),
  // Pinecone vector DB
  PINECONE_API_KEY: z.string().optional(),
  PINECONE_ENVIRONMENT: z.string().optional(),
  PINECONE_INDEX: z.string().optional(),
  // Bot integrations (Phase 4.11)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  // GitHub agent (Phase 4.17)
  GITHUB_TOKEN: z.string().optional(),
  // Web Push / VAPID (Phase 4.20)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_EMAIL: z.string().email().optional(),
  // Feature toggles
  ANTHROPIC_PROMPT_CACHE: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
  QUERY_EXPANSION_ENABLED: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
  // Deployment mode
  DEPLOYMENT_MODE: z.enum(["lite", "standard", "enterprise"]).optional(),
  LITE_MODE: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
});

// Warn about unknown env vars that look like typos of known keys
const KNOWN_KEYS = new Set(Object.keys(envSchema.shape));
const ENV_PREFIXES = ["DATABASE_", "REDIS_", "JWT_", "MASTER_", "PORT", "NODE_", "RATE_LIMIT_", "ALLOWED_", "TAVILY_", "SYSTEM_", "TRUST_", "OPENAI_", "ANTHROPIC_", "GOOGLE_", "OPENROUTER_", "NVIDIA_", "XIAOMI_", "GROQ_", "MISTRAL_", "CEREBRAS_", "COHERE_", "OLLAMA_", "SERP_", "LANGFUSE_", "PROVIDER_", "FRONTEND_", "CURRENT_", "ENABLE_", "GITHUB_", "OAUTH_", "OTEL_", "SENTRY_", "SMTP_", "GRACEFUL_", "SSO_", "SLACK_", "DISCORD_", "CAPTCHA_", "RECAPTCHA_", "HCAPTCHA_", "TURNSTILE_", "AZURE_", "STABILITY_", "REPLICATE_", "ELEVENLABS_", "DEEPGRAM_", "WEB_SEARCH_", "SERPER_", "BRAVE_", "SEARXNG_", "FIRECRAWL_", "EXA_", "LITELLM_", "VLLM_", "STRIPE_", "VECTOR_DB_", "VESPA_", "WEAVIATE_", "PINECONE_", "QUERY_", "DEPLOYMENT_", "LITE_", "CONFLUENCE_", "NOTION_", "TELEGRAM_", "WHATSAPP_", "VAPID_"];
for (const key of Object.keys(process.env)) {
  if (!KNOWN_KEYS.has(key) && ENV_PREFIXES.some(p => key.startsWith(p))) {
    process.stderr.write(`WARNING: Unknown env var '${key}' looks like a typo of a known config key\n`);
  }
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Throw instead of process.exit(1) — allows test runners to catch
  const messages = parsed.error.issues.map(i => `   ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${messages}`);
}

export const env = parsed.data;

if (!parsed.data.OPENAI_API_KEY && !parsed.data.ANTHROPIC_API_KEY && !parsed.data.GOOGLE_API_KEY) {
  // L-9: In production, missing AI provider keys is a fatal misconfiguration — throw instead of warn
  const msg = "No AI provider API keys found (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY). All council requests will fail at runtime.";
  if (parsed.data.NODE_ENV === "production") {
    throw new Error(msg);
  }
  process.stderr.write(`WARNING: ${msg}\n`);
}

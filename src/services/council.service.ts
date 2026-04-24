import { env } from "../config/env.js";
import {
  loadSystemProviders,
  resolveActiveProviders,
  composeCouncil,
  validateUserConfig
} from "../lib/configResolver.js";
import type {
  UserCouncilConfig,
  CouncilComposition,
} from "../types/userConfig.js";
import logger from "../lib/logger.js";

export class CouncilServiceError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "CouncilServiceError";
  }
}

export interface CouncilProvider {
  type: "api";
  apiKey: string;
  model: string;
  name: string;
  baseUrl?: string;
}

export function getDefaultMembers(count = 3): CouncilProvider[] {
  const providers: CouncilProvider[] = [];
  
  if (env.MISTRAL_API_KEY) {
    providers.push({
      type: "api",
      apiKey: env.MISTRAL_API_KEY,
      model: "mistral-large-latest",
      name: "Mistral",
      baseUrl: "https://api.mistral.ai/v1"
    });
  }

  if (env.GROQ_API_KEY) {
    providers.push({
      type: "api",
      apiKey: env.GROQ_API_KEY,
      model: "llama-3.3-70b-versatile",
      name: "Groq",
      baseUrl: "https://api.groq.com/openai/v1"
    });
  }

  if (env.OPENAI_API_KEY) {
    providers.push({ 
      type: "api", 
      apiKey: env.OPENAI_API_KEY, 
      model: "gpt-4o", 
      name: "OpenAI" 
    });
  }
  
  if (env.GOOGLE_API_KEY) {
    providers.push({ 
      type: "api", 
      apiKey: env.GOOGLE_API_KEY, 
      model: "gemini-2.0-flash", 
      name: "Gemini" 
    });
  }
  
  if (env.ANTHROPIC_API_KEY) {
    providers.push({ 
      type: "api", 
      apiKey: env.ANTHROPIC_API_KEY, 
      model: "claude-3-5-sonnet-20241022", 
      name: "Claude" 
    });
  }
  
  if (providers.length === 0) {
    throw new CouncilServiceError(
      "NO_PROVIDERS",
      "No AI provider API keys configured. Set OPENAI_API_KEY, GOOGLE_API_KEY, or ANTHROPIC_API_KEY in your environment."
    );
  }
  
  const originalLength = providers.length;
  // Cap count to prevent unbounded provider cloning
  const safeCount = Math.min(count, 100);
  const MAX_CLONE_ITERATIONS = 20;
  let iterations = 0;
  while (providers.length < safeCount) {
    if (++iterations > MAX_CLONE_ITERATIONS) {
      logger.warn({ count, originalLength, iterations }, "Council cloning hit max iteration guard");
      break;
    }
    // Guard against modulo by zero when originalLength is 0
    if (originalLength <= 0) break;
    const providerToClone = providers[(providers.length - originalLength) % originalLength];
    providers.push({ ...providerToClone, name: `${providerToClone.name}-${providers.length - originalLength + 1}` });
  }
  
  return providers.slice(0, safeCount);
}

export function getDefaultMaster(): CouncilProvider {
  if (env.MISTRAL_API_KEY) {
    return {
      type: "api",
      apiKey: env.MISTRAL_API_KEY,
      model: "mistral-large-latest",
      name: "Master",
      baseUrl: "https://api.mistral.ai/v1"
    };
  }

  if (env.GROQ_API_KEY) {
    return {
      type: "api",
      apiKey: env.GROQ_API_KEY,
      model: "llama-3.3-70b-versatile",
      name: "Master",
      baseUrl: "https://api.groq.com/openai/v1"
    };
  }

  if (env.OPENAI_API_KEY) {
    return { 
      type: "api", 
      apiKey: env.OPENAI_API_KEY, 
      model: "gpt-4o", 
      name: "Master" 
    };
  }
  
  if (env.GOOGLE_API_KEY) {
    return { 
      type: "api", 
      apiKey: env.GOOGLE_API_KEY, 
      model: "gemini-2.0-flash", 
      name: "Master" 
    };
  }
  
  if (env.ANTHROPIC_API_KEY) {
    return { 
      type: "api", 
      apiKey: env.ANTHROPIC_API_KEY, 
      model: "claude-3-5-sonnet-20241022", 
      name: "Master" 
    };
  }
  
  throw new CouncilServiceError(
    "NO_MASTER",
    "No AI provider API keys configured for master."
  );
}

export interface ApiKeyResolutionInput {
  type?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  name?: string;
}

function getHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return "";
  }
}

// Allowlist of known provider domains mapped to their env key getter
const PROVIDER_DOMAINS: Record<string, () => string> = {
  "api.siliconflow.cn": () => env.XIAOMI_MIMO_API_KEY || env.OPENAI_API_KEY || "",
  "api.siliconflow.com": () => env.XIAOMI_MIMO_API_KEY || env.OPENAI_API_KEY || "",
  "openrouter.ai": () => env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || "",
  "api.groq.com": () => env.GROQ_API_KEY || env.OPENAI_API_KEY || "",
  "api.mistral.ai": () => env.MISTRAL_API_KEY || env.OPENAI_API_KEY || "",
  "api.cerebras.ai": () => env.CEREBRAS_API_KEY || env.OPENAI_API_KEY || "",
  "integrate.api.nvidia.com": () => env.NVIDIA_API_KEY || env.OPENAI_API_KEY || "",
};

function matchProviderDomain(hostname: string): string | null {
  // Exact match or subdomain match (hostname === domain || hostname ends with .domain)
  for (const [domain, getKey] of Object.entries(PROVIDER_DOMAINS)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return getKey();
    }
  }
  return null;
}

export function resolveApiKey(member: ApiKeyResolutionInput): string {
  const hostname = getHostname(member.baseUrl || "");
  const model = (member.model || "").toLowerCase();

  const domainKey = matchProviderDomain(hostname);
  if (domainKey !== null) return domainKey;

  if (model.includes("xiaomi") || model.includes("mimo")) return env.XIAOMI_MIMO_API_KEY || env.OPENAI_API_KEY || "";
  if (model.includes("mistral"))      return env.MISTRAL_API_KEY || env.OPENAI_API_KEY || "";
  if (model.includes("gemini") || model.includes("palm")) return env.GOOGLE_API_KEY || env.OPENAI_API_KEY || "";
  if (model.includes("claude") || model.includes("anthropic")) return env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || "";
  if (model.includes("qwen-3-235b") || model.includes("gpt-oss") || model.includes("llama3.1-8b")) {
    return env.CEREBRAS_API_KEY || env.OPENAI_API_KEY || "";
  }
  if (model.includes("/"))            return env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || "";

  if (member.type === "api") {
    const key = env.GOOGLE_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || "";
    if (!key) logger.warn({ member: { model: member.model, baseUrl: member.baseUrl } }, "resolveApiKey: no API key found for api-type member");
    return key;
  }

  const fallbackKey = env.OPENAI_API_KEY || "";
  if (!fallbackKey) logger.warn({ member: { model: member.model, baseUrl: member.baseUrl } }, "resolveApiKey: no fallback API key found");
  return fallbackKey;
}

export function resolveMembersApiKeys(members: ApiKeyResolutionInput[]): CouncilProvider[] {
  return members.map(member => ({
    type: "api",
    apiKey: member.apiKey || resolveApiKey(member),
    model: member.model || "gpt-4o",
    name: member.name || "Council Member"
  }));
}

export function composeCouncilFromUserConfig(
  userConfig?: Partial<UserCouncilConfig>
): CouncilComposition {
  const validation = validateUserConfig((userConfig ?? null) as UserCouncilConfig | null);
  if (!validation.valid) {
    throw new CouncilServiceError(
      "INVALID_CONFIG",
      `Invalid council configuration: ${validation.errors.join(", ")}`
    );
  }

  const systemProviders = loadSystemProviders();
  
  if (systemProviders.length === 0) {
    throw new CouncilServiceError(
      "NO_SYSTEM_PROVIDERS",
      "No system providers available. Check environment configuration."
    );
  }

  logger.info({
    systemProviders: systemProviders.map(p => p.name),
    userConfig
  }, "Preparing council from user config");

  const resolved = resolveActiveProviders(systemProviders, userConfig);

  const composition = composeCouncil(resolved, userConfig);

  for (const warning of validation.warnings) {
    logger.warn({ warning }, "Council config warning");
  }

  return composition;
}

export function prepareCouncilMembers(
  members?: CouncilProvider[],
  userConfig?: Partial<UserCouncilConfig>
): { members: CouncilProvider[]; master: CouncilProvider } {
  if (userConfig) {
    const composition = composeCouncilFromUserConfig(userConfig);
    return {
      members: composition.members.map(m => ({
        type: m.type as "api", // All providers use "api" type for council
        apiKey: m.apiKey,
        model: m.model,
        name: m.name,
        baseUrl: m.baseUrl
      })),
      master: {
        type: composition.master.type as "api",
        apiKey: composition.master.apiKey,
        model: composition.master.model,
        name: composition.master.name,
        baseUrl: composition.master.baseUrl
      }
    };
  }

  const councilMembers = members || getDefaultMembers();
  const master = getDefaultMaster();

  return { members: councilMembers, master };
}

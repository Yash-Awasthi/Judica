

// P10-16: Priority scoring semantics:
// - Priority is a 0-1000 integer scale (higher = more preferred)
// - Default priority for system providers: 100
// - User-specified priorities override system defaults
// - All code paths use the same scale via the `priority` field on ResolvedProvider.

// P10-19: This module imports CouncilServiceError from services/councilService.ts,
// creating a lib → services dependency. This is acceptable as a thin error type import.
// TODO: Move CouncilServiceError to a shared types/errors.ts to eliminate the cycle.
import type { Provider } from "./providers.js";
import logger from "./logger.js";
import type {
  UserProviderConfig,
  UserCouncilConfig,
  ResolvedProvider,
  ConfigValidationResult,
  CouncilComposition
} from "../types/userConfig.js";
import { env } from "../config/env.js";
import { CouncilServiceError } from "../services/council.service.js";

export function validateUserConfig(
  config: UserCouncilConfig | null
): ConfigValidationResult {
  if (!config) {
    return { valid: true, errors: [], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.maxAgents !== undefined) {
    if (config.maxAgents < 1) {
      errors.push("maxAgents must be at least 1");
    } else if (config.maxAgents > 6) {
      errors.push("maxAgents cannot exceed 6");
    }
  }

  if (config.providers !== undefined && !Array.isArray(config.providers)) {
    errors.push("providers must be an array");
  } else if (Array.isArray(config.providers)) {
    config.providers.forEach((provider, index) => {
      if (!provider.name || typeof provider.name !== "string" || provider.name.trim() === "") {
        errors.push(`Provider at index ${index}: name must be a non-empty string`);
      }
      if (typeof provider.enabled !== "boolean") {
        errors.push(`Provider at index ${index}: enabled must be a boolean`);
      }
    });

    const masters = config.providers.filter(p => p.role === "master" && p.enabled);
    if (masters.length > 1) {
      warnings.push(`Multiple masters specified (${masters.length}), will select highest priority`);
    }

    // P10-18: Deduplicate by (name + model) pair, not just name.
    // Same provider with different models (e.g., openai/gpt-4o and openai/gpt-4o-mini)
    // should be treated as distinct providers.
    const nameModelPairs = config.providers.map(p => `${p.name}:${(p as any).model || ""}`);
    const duplicates = nameModelPairs.filter((pair, index) => nameModelPairs.indexOf(pair) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate provider configurations: ${[...new Set(duplicates)].join(", ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function loadSystemProviders(): Provider[] {
  const providers: Provider[] = [];

  if (env.OPENAI_API_KEY) {
    providers.push({
      name: "openai",
      type: "api",
      provider: "openai",
      apiKey: env.OPENAI_API_KEY,
      // P10-14: Model names configurable via env vars instead of hardcoded
      model: process.env.OPENAI_MODEL || "gpt-4o",
      baseUrl: "https://api.openai.com/v1"
    });
  }

  if (env.GOOGLE_API_KEY) {
    providers.push({
      name: "google",
      type: "api",
      provider: "google",
      apiKey: env.GOOGLE_API_KEY,
      model: process.env.GOOGLE_MODEL || "gemini-2.0-flash"
    });
  }

  if (env.ANTHROPIC_API_KEY) {
    providers.push({
      name: "anthropic",
      type: "api",
      provider: "anthropic",
      apiKey: env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022"
    });
  }

  // P10-13: Ollama is opt-in — only added when OLLAMA_ENABLED=true is explicitly set.
  // Previously injected unconditionally, causing silent failures when no Ollama is running.
  if (process.env.OLLAMA_ENABLED === "true") {
    providers.push({
      name: "ollama",
      type: "local",
      provider: "ollama",
      apiKey: "local",
      model: process.env.OLLAMA_MODEL || "llama3",
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434"
    });
  }

  return providers;
}

function mergeProviderConfig(
  systemProvider: Provider,
  userConfig?: UserProviderConfig
): ResolvedProvider {
  const systemEnabled = true; // System providers are enabled by default
  const userEnabled = userConfig?.enabled ?? true; // Default to enabled if no user config

  return {
    name: systemProvider.name,
    type: systemProvider.type,
    apiKey: systemProvider.apiKey,
    model: systemProvider.model,
    baseUrl: systemProvider.baseUrl,
    enabled: systemEnabled && userEnabled,
    role: userConfig?.role || "member",
    priority: userConfig?.priority ?? 100,
    systemEnabled,
    userEnabled
  };
}

export function resolveActiveProviders(
  systemProviders: Provider[],
  userConfig?: Partial<UserCouncilConfig>
): ResolvedProvider[] {
  const userProviderMap = new Map<string, UserProviderConfig>();
  
  if (userConfig?.providers) {
    for (const userProvider of userConfig.providers) {
      userProviderMap.set(userProvider.name, userProvider);
    }
  }

  const resolved: ResolvedProvider[] = [];
  
  for (const systemProvider of systemProviders) {
    const userProvider = userProviderMap.get(systemProvider.name);
    const merged = mergeProviderConfig(systemProvider, userProvider);
    resolved.push(merged);
  }

  if (userConfig?.providers) {
    const systemNames = new Set(systemProviders.map(p => p.name));
    for (const userProvider of userConfig.providers) {
      if (!systemNames.has(userProvider.name)) {
        logger.warn(
          { providerName: userProvider.name },
          "User specified provider not found in system configuration"
        );
      }
    }
  }

  return resolved;
}

export function selectMaster(resolved: ResolvedProvider[]): ResolvedProvider {
  const enabled = resolved.filter(p => p.enabled);

  if (enabled.length === 0) {
    throw new CouncilServiceError("NO_PROVIDERS", "No enabled providers available for master selection");
  }

  const userMasters = enabled.filter(p => p.role === "master");

  if (userMasters.length > 0) {
    userMasters.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    
    if (userMasters.length > 1) {
      logger.warn(
        { masters: userMasters.map(m => m.name), selected: userMasters[0].name },
        "Multiple user-specified masters found, selecting highest priority"
      );
    }

    logger.info(
      { 
        master: userMasters[0].name,
        type: userMasters[0].type,
        priority: userMasters[0].priority,
        selectionReason: "user-specified"
      },
      "Using user-specified master provider"
    );

    return { ...userMasters[0], role: "master" };
  }

  const apiProviders = enabled.filter(p => p.type === "api");
  const candidates = apiProviders.length > 0 ? apiProviders : enabled;
  
  candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  logger.info(
    { 
      master: candidates[0].name,
      type: candidates[0].type,
      priority: candidates[0].priority,
      selectionReason: "auto-selected",
      alternatives: candidates.slice(1, 3).map(c => ({ name: c.name, priority: c.priority }))
    },
    "Auto-selected master provider"
  );

  return { ...candidates[0], role: "master" };
}

function enforceConstraints(
  providers: ResolvedProvider[],
  maxAgents: number
): { valid: ResolvedProvider[]; constraints: string[] } {
  const constraints: string[] = [];
  let valid = [...providers];

  if (valid.length === 0) {
    throw new CouncilServiceError("NO_PROVIDERS", "At least 1 provider is required");
  }

  if (valid.length > maxAgents) {
    // P10-15: Warn with names of dropped providers instead of silently truncating
    const dropped = valid.slice(maxAgents).map(p => p.name);
    logger.warn({ dropped, maxAgents, total: valid.length }, "Provider list truncated — excess providers dropped");
    constraints.push(`Limited to ${maxAgents} agents (had ${valid.length}); dropped: ${dropped.join(", ")}`);
    valid = valid.slice(0, maxAgents);
  }

  const rpaCount = valid.filter(p => p.type === "rpa").length;
  if (rpaCount > 2) {
    constraints.push(`Limited to 2 RPA providers (had ${rpaCount})`);
    const rpaRemoved: ResolvedProvider[] = [];
    let rpaKept = 0;
    
    for (const p of valid) {
      if (p.type === "rpa") {
        if (rpaKept < 2) {
          rpaRemoved.push(p);
          rpaKept++;
        }
      } else {
        rpaRemoved.push(p);
      }
    }
    valid = rpaRemoved;
  }

  return { valid, constraints };
}

export function composeCouncil(
  resolved: ResolvedProvider[],
  userConfig?: Partial<UserCouncilConfig>
): CouncilComposition {
  const appliedConstraints: string[] = [];

  let enabled = resolved.filter(p => p.enabled);

  if (userConfig?.allowRPA === false) {
    const beforeCount = enabled.length;
    enabled = enabled.filter(p => p.type !== "rpa");
    if (enabled.length < beforeCount) {
      appliedConstraints.push("RPA providers disabled by user config");
      logger.info("RPA providers filtered out (allowRPA: false)");
    }
  }

  const maxAgents = Math.min(Math.max(userConfig?.maxAgents ?? 4, 1), 6);
  
  enabled.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const master = selectMaster(enabled);
  
  const memberCandidates = enabled.filter(p => p.name !== master.name);

  const { valid: members, constraints } = enforceConstraints(
    memberCandidates,
    maxAgents - 1 // Reserve 1 slot for master
  );
  appliedConstraints.push(...constraints);

  // P10-17: preferLocalMix flag is deprecated — the local-mix routing strategy
  // was never implemented. This check is kept for backward compatibility with
  // existing user configs but has no functional effect.
  if (userConfig?.preferLocalMix && members.length > 1) {
    const hasLocal = members.some(p => p.type === "local");
    const hasApi = members.some(p => p.type === "api");

    if (!hasLocal || !hasApi) {
      appliedConstraints.push("preferLocalMix: diversity preference noted but could not be satisfied (deprecated flag)");
    } else {
      appliedConstraints.push("preferLocalMix: local+API diversity satisfied");
    }
  }

  const filtered = enabled.filter(
    p => p.name !== master.name && !members.some(m => m.name === p.name)
  );

  logger.info({
    master: master.name,
    members: members.map(m => ({ name: m.name, type: m.type, priority: m.priority })),
    filtered: filtered.map(f => ({ name: f.name, reason: "not selected" })),
    constraints: appliedConstraints,
    totalProviders: enabled.length,
    selectedMembers: members.length
  }, "Council composition resolved");

  return {
    members,
    master,
    filtered,
    appliedConstraints
  };
}

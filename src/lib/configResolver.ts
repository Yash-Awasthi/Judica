/**
 * Config Resolver - Merges system provider configuration with user preferences
 * 
 * Rules:
 * 1. Provider must be enabled in BOTH system AND user config to be active
 * 2. User config takes precedence for role and priority settings
 * 3. If user config missing, fallback to system defaults
 * 4. Invalid providers are filtered safely
 */

import { Provider } from "./providers.js";
import logger from "./logger.js";
import {
  UserProviderConfig,
  UserCouncilConfig,
  ResolvedProvider,
  ConfigValidationResult,
  CouncilComposition
} from "../types/userConfig.js";
import { env } from "../config/env.js";
import { CouncilServiceError } from "../services/councilService.js";

/**
 * Validate user council configuration
 */
export function validateUserConfig(
  config: UserCouncilConfig | null
): ConfigValidationResult {
  if (!config) {
    return { valid: true, errors: [], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check maxAgents bounds
  if (config.maxAgents !== undefined) {
    if (config.maxAgents < 1) {
      errors.push("maxAgents must be at least 1");
    } else if (config.maxAgents > 6) {
      errors.push("maxAgents cannot exceed 6");
    }
  }

  // Check providers array
  if (config.providers !== undefined && !Array.isArray(config.providers)) {
    errors.push("providers must be an array");
  } else if (Array.isArray(config.providers)) {
    // Validate each provider
    config.providers.forEach((provider, index) => {
      if (!provider.name || typeof provider.name !== "string" || provider.name.trim() === "") {
        errors.push(`Provider at index ${index}: name must be a non-empty string`);
      }
      if (typeof provider.enabled !== "boolean") {
        errors.push(`Provider at index ${index}: enabled must be a boolean`);
      }
    });

    // Count user-specified masters
    const masters = config.providers.filter(p => p.role === "master" && p.enabled);
    if (masters.length > 1) {
      warnings.push(`Multiple masters specified (${masters.length}), will select highest priority`);
    }

    // Check for duplicate provider names
    const names = config.providers.map(p => p.name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate provider names: ${[...new Set(duplicates)].join(", ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Load system providers from environment/config
 * Returns array of available providers with system-level settings
 */
export function loadSystemProviders(): Provider[] {
  const providers: Provider[] = [];

  // OpenAI
  if (env.OPENAI_API_KEY) {
    providers.push({
      name: "openai",
      type: "api",
      provider: "openai",
      apiKey: env.OPENAI_API_KEY,
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1"
    });
  }

  // Google
  if (env.GOOGLE_API_KEY) {
    providers.push({
      name: "google",
      type: "api",
      provider: "google",
      apiKey: env.GOOGLE_API_KEY,
      model: "gemini-2.0-flash"
    });
  }

  // Anthropic
  if (env.ANTHROPIC_API_KEY) {
    providers.push({
      name: "anthropic",
      type: "api",
      provider: "anthropic",
      apiKey: env.ANTHROPIC_API_KEY,
      model: "claude-3-5-sonnet-20241022"
    });
  }

  // Local Ollama (if available)
  providers.push({
    name: "ollama",
    type: "local",
    provider: "ollama",
    apiKey: "local",
    model: "llama3",
    baseUrl: "http://localhost:11434"
  });

  return providers;
}

/**
 * Merge system provider with user configuration
 */
function mergeProviderConfig(
  systemProvider: Provider,
  userConfig?: UserProviderConfig
): ResolvedProvider {
  // Default: enabled if system says so and user hasn't disabled
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

/**
 * Resolve active providers by merging system + user config
 * 
 * @param systemProviders - Providers available from system
 * @param userConfig - User's council configuration preferences
 * @returns Array of resolved providers (filtered and merged)
 */
export function resolveActiveProviders(
  systemProviders: Provider[],
  userConfig?: Partial<UserCouncilConfig>
): ResolvedProvider[] {
  // Create lookup for user config by provider name
  const userProviderMap = new Map<string, UserProviderConfig>();
  
  if (userConfig?.providers) {
    for (const userProvider of userConfig.providers) {
      userProviderMap.set(userProvider.name, userProvider);
    }
  }

  // Merge system providers with user config
  const resolved: ResolvedProvider[] = [];
  
  for (const systemProvider of systemProviders) {
    const userProvider = userProviderMap.get(systemProvider.name);
    const merged = mergeProviderConfig(systemProvider, userProvider);
    resolved.push(merged);
  }

  // If user specified providers not in system, log warning
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

/**
 * Select master provider from resolved providers
 * 
 * Rules:
 * 1. If user sets role === "master" → use that provider
 * 2. Only ONE master allowed
 * 3. If multiple masters → pick highest priority
 * 4. If no master specified → auto-select best API provider
 * 
 * @param resolved - Resolved providers after merging
 * @returns Selected master provider
 */
export function selectMaster(resolved: ResolvedProvider[]): ResolvedProvider {
  const enabled = resolved.filter(p => p.enabled);

  if (enabled.length === 0) {
    throw new CouncilServiceError("NO_PROVIDERS", "No enabled providers available for master selection");
  }

  // Find user-specified masters
  const userMasters = enabled.filter(p => p.role === "master");

  if (userMasters.length > 0) {
    // Sort by priority (highest first)
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

  // Auto-select: prefer API providers, then by priority
  const apiProviders = enabled.filter(p => p.type === "api");
  const candidates = apiProviders.length > 0 ? apiProviders : enabled;
  
  // Sort by priority (highest first)
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

/**
 * Enforce safety constraints on council composition
 * 
 * Constraints:
 * - At least 1 provider required
 * - Max 6 agents
 * - Max 2 RPA agents
 */
function enforceConstraints(
  providers: ResolvedProvider[],
  maxAgents: number
): { valid: ResolvedProvider[]; constraints: string[] } {
  const constraints: string[] = [];
  let valid = [...providers];

  // Must have at least 1
  if (valid.length === 0) {
    throw new CouncilServiceError("NO_PROVIDERS", "At least 1 provider is required");
  }

  // Max 6 agents
  if (valid.length > maxAgents) {
    constraints.push(`Limited to ${maxAgents} agents (had ${valid.length})`);
    valid = valid.slice(0, maxAgents);
  }

  // Max 2 RPA
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

/**
 * Compose council from resolved providers
 * 
 * @param resolved - Resolved providers
 * @param userConfig - User configuration for constraints
 * @returns Council composition with members and master
 */
export function composeCouncil(
  resolved: ResolvedProvider[],
  userConfig?: Partial<UserCouncilConfig>
): CouncilComposition {
  const appliedConstraints: string[] = [];

  // Filter to enabled providers
  let enabled = resolved.filter(p => p.enabled);

  // Filter RPA if not allowed
  if (userConfig?.allowRPA === false) {
    const beforeCount = enabled.length;
    enabled = enabled.filter(p => p.type !== "rpa");
    if (enabled.length < beforeCount) {
      appliedConstraints.push("RPA providers disabled by user config");
      logger.info("RPA providers filtered out (allowRPA: false)");
    }
  }

  // Enforce max agents
  const maxAgents = Math.min(Math.max(userConfig?.maxAgents ?? 4, 1), 6);
  
  // Sort by priority (highest first)
  enabled.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // Select master first (removes from member pool)
  const master = selectMaster(enabled);
  
  // Remove master from member candidates
  const memberCandidates = enabled.filter(p => p.name !== master.name);

  // Apply constraints to remaining members
  const { valid: members, constraints } = enforceConstraints(
    memberCandidates,
    maxAgents - 1 // Reserve 1 slot for master
  );
  appliedConstraints.push(...constraints);

  // Ensure diversity if requested
  if (userConfig?.preferLocalMix && members.length > 1) {
    const hasLocal = members.some(p => p.type === "local");
    const hasApi = members.some(p => p.type === "api");
    
    if (!hasLocal || !hasApi) {
      appliedConstraints.push("Diversity preference noted but could not be satisfied");
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

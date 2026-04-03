/**
 * User-controlled council configuration types
 * 
 * These interfaces define how users can customize council composition
 * without breaking system stability.
 */

/**
 * User-facing provider configuration
 * Allows toggling providers on/off and assigning roles
 */
export interface UserProviderConfig {
  /** Provider name (must match system provider name) */
  name: string;
  
  /** Enable/disable this provider */
  enabled: boolean;
  
  /** Role in council - member participates in debate, master synthesizes verdict */
  role?: "member" | "master";
  
  /** Priority for selection (higher = preferred) */
  priority?: number;
}

/**
 * User council configuration
 * Controls overall council composition
 */
export interface UserCouncilConfig {
  /** Provider configurations */
  providers: UserProviderConfig[];
  
  /** Maximum number of agents to include (default: 4-6) */
  maxAgents?: number;
  
  /** Allow RPA providers in this council (default: true) */
  allowRPA?: boolean;
  
  /** Require at least one local provider if available */
  preferLocalMix?: boolean;
}

/**
 * Resolved provider with merged system + user configuration
 */
export interface ResolvedProvider {
  name: string;
  type: "api" | "local" | "rpa";
  apiKey: string;
  model: string;
  baseUrl?: string;
  enabled: boolean;
  role: "member" | "master";
  priority: number;
  systemEnabled: boolean;
  userEnabled: boolean;
}

/**
 * Validation result for user config
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Council composition result
 */
export interface CouncilComposition {
  members: ResolvedProvider[];
  master: ResolvedProvider;
  filtered: ResolvedProvider[];
  appliedConstraints: string[];
}

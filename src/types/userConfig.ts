

export interface UserProviderConfig {
  
  name: string;

  enabled: boolean;

  role?: "member" | "master";

  priority?: number;
}

export interface UserCouncilConfig {
  
  providers: UserProviderConfig[];

  /** Maximum agents in council. Must be 1-10 — enforced in configResolver.ts. */
  maxAgents?: number;

  allowRPA?: boolean;

  preferLocalMix?: boolean;
}

export interface ResolvedProvider {
  name: string;
  type: "api" | "local" | "rpa";
  /** SENSITIVE — never log or include in error objects. Redacted by logger. */
  apiKey: string;
  model: string;
  baseUrl?: string;
  enabled: boolean;
  role: "member" | "master";
  priority: number;
  systemEnabled: boolean;
  userEnabled: boolean;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CouncilComposition {
  members: ResolvedProvider[];
  master: ResolvedProvider;
  filtered: ResolvedProvider[];
  appliedConstraints: string[];
}

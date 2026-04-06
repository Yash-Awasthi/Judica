

export interface UserProviderConfig {
  
  name: string;

  enabled: boolean;

  role?: "member" | "master";

  priority?: number;
}

export interface UserCouncilConfig {
  
  providers: UserProviderConfig[];

  maxAgents?: number;

  allowRPA?: boolean;

  preferLocalMix?: boolean;
}

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

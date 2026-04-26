// Schema barrel re-exports are synchronous but safe — these are just
// Drizzle table/column definitions (no DB calls or I/O at import time).
// The actual DB connection is deferred via lazy initialization in lib/drizzle.ts (P9-45).
// Circular import risk is mitigated by keeping schema files as pure declarations
// with no cross-imports of runtime modules (lib/, routes/, middleware/).
export * from "./users.js";
export * from "./conversations.js";
export * from "./auth.js";
export * from "./council.js";
export * from "./uploads.js";
export * from "./memory.js";
export * from "./research.js";
export * from "./workflows.js";
export * from "./prompts.js";
export * from "./social.js";
export * from "./marketplace.js";
export * from "./traces.js";
export * from "./repos.js";
export * from "./projects.js";
export * from "./admin.js";
export * from "./types.js";
export * from "./whitelabel.js";
export * from "./billing.js";
export * from "./mfa.js";
export * from "./promptVersions.js";
export * from "./feedback.js";
export * from "./rooms.js";
export * from "./hypotheses.js";
export * from "./branches.js";
export * from "./memoryFacts.js";
export * from "./ideaNodes.js";
export * from "./openapiTools.js";
export * from "./spendingLimits.js";
export * from "./workspaces.js";
export * from "./sessionTemplates.js";

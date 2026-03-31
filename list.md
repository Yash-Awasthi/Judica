# AI Council Backend Gap Analysis (list.md)

## 1. File-level differences

### `.env.example`
- **status:** modified
- **what changed:** Lines added: 13, Lines removed: 27.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `Dockerfile`
- **status:** modified
- **what changed:** Lines added: 27, Lines removed: 49.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `docker-compose.yml`
- **status:** modified
- **what changed:** Lines added: 33, Lines removed: 56.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `package.json`
- **status:** modified
- **what changed:** Lines added: 13, Lines removed: 34.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `prisma/migrations/20260323155340_cascade_delete/migration.sql`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `prisma/migrations/20260323172932_add_conversations/migration.sql`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `prisma/migrations/20260323175349_medium_term_goals/migration.sql`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `prisma/migrations/20260323175520_add_revoked_token/migration.sql`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `prisma/migrations/20260323181636_cost_quotas_and_indices/migration.sql`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `prisma/migrations/20260323182556_semantic_cache/migration.sql`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `prisma/migrations/20260324102732_add_pgvector_embedding/migration.sql`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `prisma/migrations/20260325113050_sync_schema/migration.sql`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `prisma/schema.prisma`
- **status:** modified
- **what changed:** Lines added: 14, Lines removed: 68.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `scripts/orchestrator.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `scripts/rotate-keys.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/config/archetypes.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/config/env.ts`
- **status:** modified
- **what changed:** Lines added: 21, Lines removed: 38.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/config/fallbacks.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/config/quotas.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/index.ts`
- **status:** modified
- **what changed:** Lines added: 84, Lines removed: 200.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/lib/breaker.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/cache.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/context.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/council.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/crypto.ts`
- **status:** modified
- **what changed:** Lines added: 38, Lines removed: 81.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/lib/db.ts`
- **status:** modified
- **what changed:** Lines added: 9, Lines removed: 23.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/lib/history.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/logger.ts`
- **status:** modified
- **what changed:** Lines added: 0, Lines removed: 5.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/lib/providers.ts`
- **status:** modified
- **what changed:** Lines added: 256, Lines removed: 202.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/lib/redis.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/retry.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/socket.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/ssrf.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/strategies/anthropic.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/strategies/google.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/strategies/openai.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/sweeper.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/templates.ts`
- **status:** modified
- **what changed:** Lines added: 56, Lines removed: 56.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/lib/tools/execute_code.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/tools/index.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/tools/read_webpage.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/lib/tools/search.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/middleware/auth.ts`
- **status:** modified
- **what changed:** Lines added: 36, Lines removed: 66.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/middleware/cspNonce.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/middleware/errorHandler.ts`
- **status:** modified
- **what changed:** Lines added: 33, Lines removed: 56.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/middleware/quota.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/middleware/rateLimit.ts`
- **status:** modified
- **what changed:** Lines added: 16, Lines removed: 33.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/middleware/requestId.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/middleware/validate.ts`
- **status:** modified
- **what changed:** Lines added: 49, Lines removed: 92.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/routes/ask.ts`
- **status:** modified
- **what changed:** Lines added: 74, Lines removed: 290.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/routes/auth.ts`
- **status:** modified
- **what changed:** Lines added: 129, Lines removed: 198.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/routes/council.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/routes/export.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/routes/history.ts`
- **status:** modified
- **what changed:** Lines added: 74, Lines removed: 194.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/routes/metrics.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/routes/providers.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `src/routes/stream.ts`
- **status:** added
- **what changed:** File exists in ai-council but not in oldcouncil.
- **what action will be needed later:** Keep in ai-council. Ensure it integrates correctly with restored features.

### `src/routes/templates.ts`
- **status:** modified
- **what changed:** Lines added: 18, Lines removed: 18.
- **what action will be needed later:** Merge missing logic/functions from oldcouncil back into ai-council.

### `src/types/index.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

### `test/council.test.ts`
- **status:** missing
- **what changed:** File is completely missing in ai-council.
- **what action will be needed later:** Restore from oldcouncil or reimplement in ai-council.

## 2. Feature-level differences

### API routes and controllers
- **feature name:** Advanced routing (history, export, metrics, providers, stream)
- **files involved:** `src/routes/*`, `src/index.ts`
- **what exists in ai-council:** `ask.ts`, `auth.ts`, `history.ts`, `templates.ts`, `stream.ts`. Simplistic implementations.
- **what is missing or different:** `council.ts`, `export.ts`, `metrics.ts`, `providers.ts` are missing. `history.ts` and `ask.ts` are stripped down (e.g., missing multi-round iterative debate or streaming from oldcouncil's `ask`).
- **exact change needed:** Restore `council.ts` for full council management. Restore `export.ts` for data export. Restore `metrics.ts` for token usage tracking. Restore `providers.ts` for testing providers. Re-add missing routes in `index.ts`.


### Services and business logic
- **feature name:** Multi-Model Orchestration, Archetypes & Fallbacks
- **files involved:** `src/lib/council.ts`, `src/config/archetypes.ts`, `src/config/fallbacks.ts`, `src/lib/context.ts`, `src/lib/retry.ts`, `src/lib/breaker.ts`
- **what exists in ai-council:** Basic linear multi-provider fan-out in `ask.ts` / `providers.ts`. Very minimal orchestration.
- **what is missing or different:** Full council logic (Critic persona, multi-round deliberation), predefined Archetypes, AI Provider fallback system (circuit breaker / retry logic).
- **exact change needed:** Reimplement/restore `council.ts` and the associated config files (`archetypes.ts`, `fallbacks.ts`). Restore `breaker.ts` (Opossum circuit breaker) and `retry.ts`.


### Database models and schema
- **feature name:** Extended Prisma Schema & pgvector
- **files involved:** `prisma/schema.prisma`
- **what exists in ai-council:** Basic `User`, `Chat`, `Conversation`, `ProviderConfig` (stripped down).
- **what is missing or different:** missing/modified models or fields like `DailyUsage`, `RevokedToken`, semantic cache fields (vector embeddings), cost quotas, cascade deletes.
- **exact change needed:** Replace `ai-council` schema with `oldcouncil` schema. Run `npx prisma db push` or `migrate` to sync.


### Auth and token handling
- **feature name:** Advanced Auth & Token revocation
- **files involved:** `src/middleware/auth.ts`, `src/routes/auth.ts`, `src/lib/crypto.ts`
- **what exists in ai-council:** Basic JWT login/register, simple AES encryption.
- **what is missing or different:** Missing token revocation lists (`RevokedToken`), potentially more robust encryption logic in `crypto.ts`.
- **exact change needed:** Merge old `auth.ts` middleware and `crypto.ts` changes to support revocation checks and stronger crypto.


### Redis, cache, queues, jobs
- **feature name:** Semantic caching and Data Sweeping
- **files involved:** `src/lib/redis.ts`, `src/lib/cache.ts`, `src/lib/sweeper.ts`
- **what exists in ai-council:** Nothing (no Redis or cache files).
- **what is missing or different:** Exact match Redis caching + PostgreSQL pgvector similarity search. Background sweeping of old cache/tokens.
- **exact change needed:** Restore `redis.ts`, `cache.ts`, `sweeper.ts`. Add Redis connection logic to app startup (`index.ts`).


### Config and env usage
- **feature name:** Comprehensive Environment Config
- **files involved:** `src/config/env.ts`, `.env.example`, `src/config/quotas.ts`
- **what exists in ai-council:** Basic Zod env validation.
- **what is missing or different:** Quota configurations (`quotas.ts`), extra env vars for Tavily, Anthropic, Redis, rate limiting.
- **exact change needed:** Restore `quotas.ts`, update `env.ts` with all old variables, and sync `.env.example`.


### Integrations and external APIs
- **feature name:** Agentic Tools and Provider Strategies
- **files involved:** `src/lib/tools/*`, `src/lib/strategies/*`, `src/lib/providers.ts`
- **what exists in ai-council:** Basic `providers.ts`.
- **what is missing or different:** `execute_code.ts` (isolated-vm), `read_webpage.ts`, `search.ts`. Specific provider SDK wrappers (`openai.ts`, `anthropic.ts`, `google.ts`).
- **exact change needed:** Copy `src/lib/tools/` and `src/lib/strategies/`. Update `providers.ts` to use these advanced wrappers and tools.


### Startup and runtime wiring
- **feature name:** Express App Setup & WebSockets
- **files involved:** `src/index.ts`, `src/lib/socket.ts`, `src/middleware/*`
- **what exists in ai-council:** Basic Express server.
- **what is missing or different:** WebSockets (`socket.ts`), advanced middlewares (`cspNonce.ts`, `quota.ts`, `requestId.ts`), background jobs (`sweeper.ts`).
- **exact change needed:** Restore `socket.ts` and initialize it in `index.ts`. Add missing middlewares. Start sweeper jobs on boot.


### Tests, scripts, CI, and build files if backend-related
- **feature name:** Testing and Maintenance Scripts
- **files involved:** `test/`, `scripts/`, `Dockerfile`, `docker-compose.yml`, `package.json`
- **what exists in ai-council:** Stripped down Dockerfile, no tests, no scripts.
- **what is missing or different:** `vitest` tests (`council.test.ts`), `orchestrator.ts`, `rotate-keys.ts`, comprehensive Docker environment, necessary npm packages.
- **exact change needed:** Restore `test/` and `scripts/`. Merge `package.json` dependencies (like `isolated-vm`, `redis`, `socket.io`). Merge `Dockerfile` multi-stage build improvements.


## 3. Code-level differences

### `.env.example`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Internal variables or logic blocks altered.
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `Dockerfile`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Internal variables or logic blocks altered.
- **config/env changes:** None detected.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `docker-compose.yml`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Internal variables or logic blocks altered.
- **config/env changes:** None detected.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `package.json`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Internal variables or logic blocks altered.
- **config/env changes:** None detected.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `prisma/schema.prisma`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Internal variables or logic blocks altered.
- **config/env changes:** None detected.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/config/env.ts`
- **missing functions/classes:** export const env = parsed.data;
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/index.ts`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/lib/crypto.ts`
- **missing functions/classes:** function getCurrentVersion(): string {, function getKey(version: string = "1"): Buffer {
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/lib/db.ts`
- **missing functions/classes:** export const pool = new pg.Pool({
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/lib/logger.ts`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/lib/providers.ts`
- **missing functions/classes:** function resolveProvider(provider: Provider): ResolvedProvider {
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** None detected.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/lib/templates.ts`
- **missing functions/classes:** export const TEMPLATES: CouncilTemplate[] = [
- **logic changes:** Internal variables or logic blocks altered.
- **config/env changes:** None detected.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/middleware/auth.ts`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/middleware/errorHandler.ts`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/middleware/rateLimit.ts`
- **missing functions/classes:** export const askLimiter = rateLimit({, export const authLimiter = rateLimit({
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/middleware/validate.ts`
- **missing functions/classes:** export const providerSchema = z.object({, export const askSchema = z, export const renameConversationSchema = z.object({, export const archetypeSchema = z.object({, export const forkSchema = z.object({, export const authSchema = z.object({, export const configSchema = z
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** None detected.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/routes/ask.ts`
- **missing functions/classes:** function getDefaultMembers(count = 3) {, function getDefaultMaster() {
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/routes/auth.ts`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** Modified environment variables or hardcoded constants.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/routes/history.ts`
- **missing functions/classes:** function parsePagination(query: any, defaultLimit = 20, maxLimit = 100) {, function paginationMeta(page: number, limit: number, total: number) {
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** None detected.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

### `src/routes/templates.ts`
- **missing functions/classes:** None identified by exact export/function regex, but large code blocks removed.
- **logic changes:** Imports changed (dependencies added/removed).
- **config/env changes:** None detected.
- **behavior changes:** Application behavior changed due to missing or altered code paths in this file.
- **where the change is needed:** Inside the respective file/module functions.

## Deep Code-level differences for modified files

### `src/index.ts`
- **missing functions/classes/constants:** const app, const trustProxyConfig, const allowedOrigins, const publicPath, const server, const io, const shutdown
- **logic changes:** Imports removed/added, Async flow changed, Redis cache logic removed, WebSocket logic removed
- **config/env changes:** process.env variables changed or removed
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/index.ts requires re-integrating the removed blocks.

### `src/config/env.ts`
- **missing functions/classes/constants:** const envSchema, const parsed, export const env
- **logic changes:** Imports removed/added, Redis cache logic removed, pgvector embeddings logic removed
- **config/env changes:** process.env variables changed or removed
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/config/env.ts requires re-integrating the removed blocks.

### `src/lib/crypto.ts`
- **missing functions/classes/constants:** const ALGORITHM, const IV_LENGTH, function getCurrentVersion(): string, function getKey(version: string, export function encrypt(text: string): string, export function decrypt(ciphertext: string): string, export function encryptConfig(config: any): any, export function decryptConfig(config: any): any
- **logic changes:** Imports removed/added
- **config/env changes:** process.env variables changed or removed
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/lib/crypto.ts requires re-integrating the removed blocks.

### `src/lib/db.ts`
- **missing functions/classes/constants:** const dbUrl, const connectionLimitStr, const maxConnections, export const pool, const adapter, const prisma
- **logic changes:** Imports removed/added
- **config/env changes:** process.env variables changed or removed
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/lib/db.ts requires re-integrating the removed blocks.

### `src/lib/logger.ts`
- **missing functions/classes/constants:** No specific top-level exports missing, but large logic blocks removed.
- **logic changes:** Imports removed/added
- **config/env changes:** process.env variables changed or removed
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/lib/logger.ts requires re-integrating the removed blocks.

### `src/lib/providers.ts`
- **missing functions/classes/constants:** const PROVIDER_REGISTRY: Record<string, ProviderRegistryEntry>, function resolveProvider(provider: Provider): ResolvedProvider, export async function askProvider(, export async function askProviderStream(
- **logic changes:** Imports removed/added, Async flow changed, Role/system prompt logic changed
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/lib/providers.ts requires re-integrating the removed blocks.

### `src/lib/templates.ts`
- **missing functions/classes/constants:** export const TEMPLATES: CouncilTemplate[]
- **logic changes:** Internal logic blocks altered.
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/lib/templates.ts requires re-integrating the removed blocks.

### `src/middleware/auth.ts`
- **missing functions/classes/constants:** export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction), export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction)
- **logic changes:** Imports removed/added, Async flow changed, Redis cache logic removed
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/middleware/auth.ts requires re-integrating the removed blocks.

### `src/middleware/errorHandler.ts`
- **missing functions/classes/constants:** export function errorHandler(
- **logic changes:** Imports removed/added
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/middleware/errorHandler.ts requires re-integrating the removed blocks.

### `src/middleware/rateLimit.ts`
- **missing functions/classes/constants:** const commonHandler, export const askLimiter, export const authLimiter
- **logic changes:** Imports removed/added
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/middleware/rateLimit.ts requires re-integrating the removed blocks.

### `src/middleware/validate.ts`
- **missing functions/classes/constants:** export function validate(schema: ZodSchema), export const providerSchema, export const askSchema, export const renameConversationSchema, export const archetypeSchema, export const forkSchema, export const authSchema, export const configSchema
- **logic changes:** Imports removed/added
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/middleware/validate.ts requires re-integrating the removed blocks.

### `src/routes/ask.ts`
- **missing functions/classes/constants:** function getDefaultMembers(count, function getDefaultMaster(), const router
- **logic changes:** Imports removed/added, Async flow changed, Quota limit logic removed, Role/system prompt logic changed
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/routes/ask.ts requires re-integrating the removed blocks.

### `src/routes/auth.ts`
- **missing functions/classes/constants:** const router
- **logic changes:** Imports removed/added, Async flow changed, Redis cache logic removed
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/routes/auth.ts requires re-integrating the removed blocks.

### `src/routes/history.ts`
- **missing functions/classes/constants:** const router, function parsePagination(query: any, defaultLimit, function paginationMeta(page: number, limit: number, total: number)
- **logic changes:** Imports removed/added, Async flow changed
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/routes/history.ts requires re-integrating the removed blocks.

### `src/routes/templates.ts`
- **missing functions/classes/constants:** const router
- **logic changes:** Imports removed/added
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file src/routes/templates.ts requires re-integrating the removed blocks.

### `prisma/schema.prisma`
- **missing functions/classes/constants:** No specific top-level exports missing, but large logic blocks removed.
- **logic changes:** pgvector embeddings logic removed
- **config/env changes:** None directly related to env configs detected.
- **behavior changes:** Application behavior changed due to missing code paths in this module.
- **where the change is needed:** The file prisma/schema.prisma requires re-integrating the removed blocks.

## 4. Dependencies

### Feature: Semantic Caching (Redis + pgvector)
- **prerequisites:** Database schema (`schema.prisma`) must have `pgvector` configured and Redis server accessible.
- **dependent features:** `ask.ts`, `metrics.ts`
- **safe order of implementation:** 1. Update `env.ts` for Redis config. 2. Update `schema.prisma` and run migrations. 3. Restore `redis.ts` and `cache.ts`. 4. Integrate into `providers.ts`/`ask.ts`.


### Feature: Streaming & WebSockets (Socket.io)
- **prerequisites:** Redis adapter (optional, if scaling) and Express HTTP server instance.
- **dependent features:** `index.ts`, `ask.ts` (if streaming verdicts)
- **safe order of implementation:** 1. Install `socket.io`. 2. Restore `socket.ts`. 3. Wire `socket.ts` into `index.ts` server listen. 4. Implement streaming in routes.


### Feature: Agentic Tools (Code Exec & Web Scrape)
- **prerequisites:** `isolated-vm` dependency, `axios`/`cheerio` for scraping.
- **dependent features:** `providers.ts`, `council.ts`
- **safe order of implementation:** 1. Install dependencies. 2. Restore `src/lib/tools/*`. 3. Update Provider strategies to register tools. 4. Handle tool callbacks in `council.ts`.


### Feature: Multi-round Council Deliberation
- **prerequisites:** Configured Archetypes (`archetypes.ts`), Fallbacks (`fallbacks.ts`).
- **dependent features:** `routes/ask.ts`, `routes/council.ts`
- **safe order of implementation:** 1. Restore config files. 2. Restore `council.ts` orchestration engine. 3. Connect engine to routes.



## 5. Risk notes

### `src/lib/tools/execute_code.ts`
- **Unsafe Pattern:** Running untrusted code (even in `isolated-vm`) is highly risky. `oldcouncil` handles this, but careful configuration of `isolated-vm` memory limits, timeouts, and restricted built-ins is required.
- **Why:** Potential for denial of service (infinite loops) or memory leaks.


### `src/config/env.ts` / `src/lib/crypto.ts`
- **Unsafe Pattern:** Bad env handling. If `ENCRYPTION_KEY` length is not validated perfectly (must be exactly 32 bytes for AES-256-GCM), the crypto library will throw silent or hard runtime errors.
- **Why:** User provider API keys are stored encrypted. If encryption breaks, all stored keys become inaccessible or corrupt.


### `src/lib/cache.ts` / `src/lib/redis.ts`
- **Unsafe Pattern:** Silent failures on Redis connection. If Redis goes down, `cache.ts` in `oldcouncil` might silently fail or block the main thread waiting for a timeout.
- **Why:** Broken async flow. We must ensure Redis operations are wrapped in try-catch with low timeouts so the AI council can still proceed (cache miss fallback) instead of hanging.


### `src/lib/tools/read_webpage.ts` / `src/lib/ssrf.ts`
- **Unsafe Pattern:** SSRF (Server-Side Request Forgery). Agentic tools that fetch URLs must be strictly validated against internal IP ranges (10.x, 192.168.x, localhost).
- **Why:** Bad wiring. If `ssrf.ts` is not applied correctly before every fetch, an AI model could be manipulated to scan the internal network.


### `src/lib/council.ts` / `src/routes/ask.ts`
- **Unsafe Pattern:** Unstable runtime patterns with Promise.all fan-out without partial result tolerance.
- **Why:** If one AI model API times out, the entire `Promise.all` rejects. `breaker.ts` (Circuit breaker) must be carefully integrated to absorb individual worker errors.


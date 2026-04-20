================================================================================
MASTER TASK LIST â€” AIBYAI BACKEND AUDIT (COMPLETE)
Source: Full audit of https://github.com/Yash-Awasthi/aibyai
Compiled from: source code audit (210 items) + test suite audit (pt6-pt8 additions)
================================================================================

TOTAL: 228 tasks
  P0 Critical Security:       46
  P1 High Security/Correct:   42
  P2 Architectural Debt:      27
  P3 Correctness Bugs:        28
  P4 Missing Features:        50
  P5 Tech Debt & Cleanup:     19
  P6 Test Suite Gaps:         16 (test-specific findings not in source audit)

================================================================================
## P0 â€” CRITICAL SECURITY (Fix Immediately)
================================================================================

### Authentication & Authorization
--------------------------------------------------------------------------------
[x] [P0-01]  Close anonymous /ask cost-exfil â€” Require auth on `/ask` and
             `/ask/stream`, or implement IP-scoped anonymous quota with
             5-req/min cap and direct mode only.

[x] [P0-02]  Fix user enumeration via timing â€” Always run `argon2.verify`
             against a constant dummy hash when user not found to equalize
             response timing.

[x] [P0-03]  Hash revokedTokens.token â€” Store `sha256(token)` instead of
             plaintext JWT in the revocation table.

[x] [P0-04]  Fix logout not revoking cookie-delivered token â€” Extract token
             from cookie on logout, not just Authorization header.

[x] [P0-05]  Add device/IP binding to /refresh â€” Prevent stolen refresh
             tokens from working on different devices.

[x] [P0-06]  Fix replay detection â€” On refresh token replay, revoke ALL
             tokens for that user (not just log a warning).

[x] [P0-07]  Add issuer/audience claims to JWT â€” Pin `issuer: "aibyai"` and
             `audience: env.NODE_ENV` in jwt.sign + jwt.verify.

[x] [P0-08]  Fix role default("member") â€” Make role required in JWT payload
             schema (no default).

[x] [P0-09]  Add CSRF protection â€” Either require header-only auth for
             state-mutating routes or implement double-submit CSRF token.

[x] [P0-10]  Fix authRateLimit multi-replica bypass â€” Move from in-process
             Map to Redis-backed rate limiting.

[x] [P0-11]  Fix rate-limit IP spoofing â€” Validate X-Forwarded-For against
             trusted proxy list.

[x] [P0-12]  Fix suspended user can still hit /ask â€” Check `user:status` in
             `fastifyOptionalAuth` too.

[x] [P0-13]  Fix suspension TTL â€” Remove 30-day EX on Redis suspension key
             (should be permanent until cleared by admin).

### Encryption & Crypto
--------------------------------------------------------------------------------
[x] [P0-14]  Replace sha256 with proper KDF â€” Use HKDF-SHA256 (for random
             keys) or Argon2id (for passphrases) with stored salt in crypto.ts.

[x] [P0-15]  Add AAD to AES-256-GCM â€” Bind ciphertext to
             `${tableName}:${recordId}:${fieldName}` to prevent cross-row
             swap attacks.

[x] [P0-16]  Add version byte to encryption envelope â€” Switch from
             `iv:tag:ct` to `{v:1, iv, tag, ct}` JSON format.

[x] [P0-17]  Fix encryption detection heuristic â€” Replace
             `apiKey.includes(":")` with proper `isEncrypted()` type-guard
             using JSON envelope.

[x] [P0-18]  Fix JWT_SECRET min length â€” Change from `min(16)` to `min(32)`
             in env.ts Zod schema.

[x] [P0-19]  Fix MASTER_ENCRYPTION_KEY validation â€” Require hex-encoded
             32-byte key: `.regex(/^[0-9a-f]{64}$/i)`.

[x] [P0-20]  Fix key rotation endpoint â€” Don't transmit master keys via
             HTTP body; require env-var + redeploy or KMS.

[x] [P0-21]  Fix "rotate" endpoint â€” Actually support multiple key versions
             (not just re-encrypt with same key).

### SSRF & Network Security
--------------------------------------------------------------------------------
[x] [P0-22]  Fix Ollama SSRF bypass â€” Parse URL and check
             `hostname === "localhost" | "127.0.0.1" | "::1"`, not string
             prefix match.

[x] [P0-23]  Add DNS rebinding protection to ssrf.ts â€” Pin validated IP and
             fetch by IP with Host header preserved.

[x] [P0-24]  Block 100.64.0.0/10 (CGN) â€” Add to SSRF blocklist (covers
             Alibaba metadata 100.100.100.200).

[x] [P0-25]  Block TEST-NET ranges â€” Add 192.0.2.0/24, 198.51.100.0/24,
             203.0.113.0/24, 198.18.0.0/15 to blocklist.

[x] [P0-26]  Add port whitelist to SSRF â€” Only allow 80/443/8080/8443.

[x] [P0-27]  Add DNS lookup timeout â€” Race against
             `AbortSignal.timeout(2000)`.

[x] [P0-28]  Redact resolved IP from SSRF error messages â€” Don't leak
             internal network topology.

[x] [P0-29]  Add `redirect: "error"` to all adapter fetches â€” Prevent
             open-redirect SSRF (strategies had it, adapters lost it).

### Sandbox Security
--------------------------------------------------------------------------------
[x] [P0-30]  Fix Python sandbox _BLOCKED_MODULES bypass â€” Move preamble to
             separate module not in user namespace; make frozen.

[x] [P0-31]  Fix _restricted_import reassignment â€” Make
             `__builtins__.__import__` non-writable or use closure-captured
             reference.

[x] [P0-32]  Replace hand-rolled seccomp BPF with libseccomp â€” Fixes
             x86_64-only numbers, arch check, default posture all at once.

[x] [P0-33]  Add seccomp_data.arch check â€” Block i386/x32 ABI bypass at
             filter entry.

[x] [P0-34]  Change SECCOMP_RET_ERRNO to SECCOMP_RET_KILL_PROCESS â€” Comment
             says "kills" but code returns EPERM.

[x] [P0-35]  Block socket() syscall in seccomp â€” Python-level monkey-patch
             has no backup at kernel level.

[x] [P0-36]  Block execve/execveat in seccomp â€” Prevent shelling out from
             Python sandbox.

[x] [P0-37]  Add clone3, process_vm_readv/writev to seccomp blocklist â€”
             Defense-in-depth.

[x] [P0-38]  Fix socket.fromfd/socketpair not patched â€” Close network escape
             via inherited file descriptors.

[x] [P0-39]  Fix bash -c shell interpolation â€” Use `execFile` with proper
             arg escaping or avoid `bash -c` entirely.

[x] [P0-40]  Set killSignal: "SIGKILL" on spawn timeout â€” SIGTERM may not
             kill uninterruptible processes.

### Quota & Cost Control
--------------------------------------------------------------------------------
[x] [P0-41]  Fix quota TOCTOU â€” Single atomic SQL
             `INSERT ... ON CONFLICT DO UPDATE RETURNING` with rejection
             in same statement.

[x] [P0-42]  Fix quota increments before request success â€” Only bill after
             successful completion.

[x] [P0-43]  Fix anonymous usage invisible in metrics â€” Track/log anonymous
             requests even without billing.

[x] [P0-44]  Remove duplicate fastifyCheckQuota in ask.ts â€” Use only the
             middleware version.

[x] [P0-45]  Fix preferred-provider bypasses RPM/quota â€” Apply same
             canUse()/checkRPM() checks to preferred provider path.

### Monitoring
--------------------------------------------------------------------------------
[x] [P0-46]  Fix Prometheus high-cardinality label â€” Use
             `routeOptions.url || “unmatched”`, never `request.url`.

================================================================================
## P1 â€” HIGH SECURITY & CORRECTNESS
================================================================================

### Provider Layer
--------------------------------------------------------------------------------
[x] [P1-01]  Fix Anthropic adapter parallel tool_use clobber â€” Change scalar
             currentToolId/Name/Args to a Map keyed by tool call index.

[x] [P1-02]  Fix image_url silently degraded to text â€” Implement proper
             Anthropic image/Gemini fileData support.

[x] [P1-03]  Fix Ollama adapter missing tool call support â€” Send tools in
             body and parse message.tool_calls.

[x] [P1-04]  Fix strategy streaming drops tools â€” Anthropic/Google strategies
             don't send tools in stream mode.

[x] [P1-05]  Fix API key in URL (Google strategy) â€” Move to
             `x-goog-api-key` header.

[x] [P1-06]  Fix custom adapter caches decrypted key forever â€” Clear after
             use or use secret-manager abstraction.

[x] [P1-07]  Fix Anthropic `anthropic-version: 2023-06-01` â€” Update to
             current version for parallel tools, cache_control.

[x] [P1-08]  Fix OpenRouter adapter missing
             transforms/route/provider.order â€” Use OpenRouter's built-in
             routing features.

[x] [P1-09]  Extract OpenAICompatibleAdapter base class â€” Deduplicate
             OpenAI/Groq/OpenRouter (95% identical code).

[x] [P1-10]  Fix SSE parser line-splitting â€” Split on `\n\n` boundary, not
             single `\n`.

[x] [P1-11]  Fix breaker.fire() cast to Response â€” Add runtime guard for
             open-breaker TypeError.

[x] [P1-12]  Fix abort signal not propagated to recursive tool calls â€” All
             three strategies drop AbortSignal in recursion.

### Auth & Session
--------------------------------------------------------------------------------
[x] [P1-13]  Fix cookie-based auth without CSRF on admin routes â€” Admin
             browser can be forced to delete users via CSRF.

[x] [P1-14]  Fix custom_instructions persistent prompt injection â€” Sanitize
             or length-cap custom instructions field.

[x] [P1-15]  Fix PUT /settings accepts arbitrary JSON â€” Add schema validation
             with key whitelist.

[x] [P1-16]  Fix role hierarchy confusion â€” Unify “owner/admin/member/viewer”
             across all endpoints.

[x] [P1-17]  Prevent admin self-demotion to zero-admin state â€” Require at
             least one admin remains after any role change.

[x] [P1-18]  Fix hard-delete users without cascade â€” Add soft-delete or
             proper cascade on related tables.

### Rate Limiting
--------------------------------------------------------------------------------
[x] [P1-19]  Wire rate-limit Redis into @fastify/rate-limit â€” Currently Redis
             client constructed but never attached.

[x] [P1-20]  Fix silent fallback to in-memory on Redis failure â€” Add /ready
             probe, health gate to prevent degraded-mode startup.

[x] [P1-21]  Fix sandbox rate-limit multi-replica bypass â€” Move to
             Redis-backed limiting.

[x] [P1-22]  Add sandbox concurrency cap â€” 10 req/min Ã— 10s = 100s
             CPU/user/min with no ceiling on concurrent executions.

### Middleware
--------------------------------------------------------------------------------
[x] [P1-23]  Unify token revocation checks â€” One `isTokenRevoked` used by
             both optional and required middleware.

[x] [P1-24]  Fix providerSchema.baseUrl allows file:// gopher:// â€” Restrict
             to http/https at schema layer.

[x] [P1-25]  Fix askSchema.context 100KB Ã— enrichment = 500KB+ prompts â€”
             Add post-enrichment size cap.

[x] [P1-26]  Fix CSP script-src allows cdn.jsdelivr.net â€” Pin to specific
             package subpaths or use SRI hashes.

[x] [P1-27]  Fix CSP connect-src ws: wss: without origin restriction â€”
             Specify your domain.

[x] [P1-28]  Fix request ID trusted blindly from header â€” Validate format or
             always generate server-side.

### Config & Env
--------------------------------------------------------------------------------
[x] [P1-29]  Fix ENABLE_VECTOR_CACHE only accepts "true"/"1" â€” Use proper
             boolean coercion in Zod schema.

[x] [P1-30]  Fix PORT as string not number â€” Use
             `z.coerce.number().int().positive()`.

[x] [P1-31]  Fix TRUST_PROXY accepts any string â€” Validate as
             number/boolean/CIDR.

[x] [P1-32]  Add missing env vars to Zod schema â€” OTEL_EXPORTER_OTLP_ENDPOINT,
             SENTRY_DSN, SMTP_*, GRACEFUL_SHUTDOWN_MS, LANGFUSE_BASEURL.

[x] [P1-33]  Fix process.exit(1) in env module â€” Throw instead (kills test
             runners, breaks vitest).

[x] [P1-34]  Add unknown-key warnings for env vars â€” Catch typos like
             JWT_SECERT at startup.

### Sandbox
--------------------------------------------------------------------------------
[x] [P1-35]  Fix JS sandbox output unbounded â€” Cap output array to prevent
             Node heap exhaustion.

[x] [P1-36]  Add "use strict" to JS sandbox â€” Prepend to user-wrapped code.

[x] [P1-37]  Fix seccomp policy regenerated per invocation â€” Cache static
             policy at startup.

[x] [P1-38]  Fix isSeccompAvailable false positive â€” Check
             CONFIG_SECCOMP_FILTER, not just Seccomp: line in /proc/status.

================================================================================
## P2 â€” ARCHITECTURAL DEBT (High Impact)
================================================================================

### Provider Unification (4 parallel abstractions)
--------------------------------------------------------------------------------
[x] [P2-01]  Pick src/adapters/ as canonical layer â€” It has the superior
             type system; all other layers should delegate to it.

[x] [P2-02]  Delete src/lib/providers/* + lib/providers.ts â€” Migrate all
             callers to adapter types.

[x] [P2-03]  Replace src/lib/providerRegistry.ts with Zod schema over
             config/providers.json â€” Expose read-only metadata from adapter
             registry.

[x] [P2-04]  Delete src/config/providerConfig.ts â€” Fourth abstraction; merge
             into adapter registry.

[x] [P2-05]  Delete src/lib/strategies/* (3 files) â€” Strictly inferior to
             adapters; have regressions (no tool streaming, key in URL).

[x] [P2-06]  Unify type shapes â€” Two Usage types (snake_case vs camelCase),
             two Message types, three fallback systems.

### Fallback & Router
--------------------------------------------------------------------------------
[x] [P2-07]  Fix config/fallbacks.ts always-Gemini â€” Doesn't implement
             README's chain; either delete or make it emergency-last-resort only.

[x] [P2-08]  Fix fallback silently disabled if GOOGLE_API_KEY empty â€” Add
             startup warning.

[x] [P2-09]  Fix config/fallbacks.ts contradicts providers.json fallbacks â€”
             Single source of truth needed.

[x] [P2-10]  Fix providerChain: gemini appears in both FREE and PAID chains
             â€” find() returns wrong entry.

[x] [P2-11]  Fix selectProvider estimatedTokens dead parameter â€” Either wire
             it in or remove.

[x] [P2-12]  Fix routeAndCollect returns "auto" as provider name â€” Metrics
             and audit logs lying about actual provider used.

[x] [P2-13]  Fix recordRequest fires before request succeeds â€” Move to
             .then() after adapter.generate().

[x] [P2-14]  Fix RPM/quota TOCTOU race â€” Atomic check-and-reserve or
             document as known limitation.

[x] [P2-15]  Add circuit breaker to adapter path â€” Only legacy baseProvider
             has Opossum; modern adapters have none.

### Naming & Organization
--------------------------------------------------------------------------------
[x] [P2-16]  Fix service naming inconsistency â€” Rename 5 `camelCaseService.ts`
             files to match 42 `dot.service.ts` files.

[x] [P2-17]  Rename src/router/ or src/routes/ â€” Naming collision (provider
             routing vs HTTP routes).

[x] [P2-18]  Merge lib/validation.ts and lib/validator.ts â€” Duplicate
             validation files.

[x] [P2-19]  Merge lib/metrics.ts and lib/prometheusMetrics.ts â€” Duplicate
             metrics implementations.

[x] [P2-20]  Fix lib/cache.ts flat file alongside lib/cache/ directory â€”
             Delete the original file.

[x] [P2-21]  Merge lib/db.ts and lib/drizzle.ts â€” Two DB entrypoints,
             unclear which is canonical.

[x] [P2-22]  Consolidate cost/usage (5 places) â€” lib/cost.ts,
             lib/realtimeCost.ts, services/usageService.ts, routes/costs.ts,
             routes/usage.ts.

[x] [P2-23]  Fix council logic scattered across 7+ files in 2 directories â€”
             Risk of circular imports.

### Redis
--------------------------------------------------------------------------------
[x] [P2-24]  Drop `redis` package, standardize on ioredis â€” Two Redis
             clients = double pools, double auth, double failure surface.

### Database & Schema
--------------------------------------------------------------------------------
[x] [P2-25]  Fix providers.json stale model names â€” claude-3-opus without
             date suffix 400s; Groq's llama-3.1-70b retired.

[x] [P2-26]  Delete LM Studio from providers.json â€” No adapter exists
             (ghost provider silently fails).

[x] [P2-27]  Remove or gate RPA providers â€” Browser automation against
             SaaS AI = ToS violation risk.

[x] [P2-28]  Fix quotas.ts â€” Two hardcoded constants; needs tiers,
             env-override, per-route support.

[x] [P2-29]  Add composite indexes â€” On (user_id, created_at) for
             marketplace/annotations/voting tables.

[x] [P2-30]  Fix council_configs encryption contradiction â€” PUT writes
             plaintext, rotate expects encrypted.

================================================================================
## P3 â€” CORRECTNESS BUGS
================================================================================

### Adapter Bugs
--------------------------------------------------------------------------------
[x] [P3-01]  Fix Groq adapter multi-modal JSON.stringify â€” Flattens image
             blocks to garbage.

[x] [P3-02]  Fix OpenRouter adapter no multi-modal forwarding â€” Same
             JSON.stringify image issue.

[x] [P3-03]  Fix Anthropic usage split across two chunks â€” Accumulate inside
             adapter, emit once at end.

[x] [P3-04]  Fix adapter import of legacy Provider type â€” Decouple from the
             layer being deleted.

[x] [P3-05]  Fix OpenAI adapter model filter hardcoded â€” Won't pick up gpt-5;
             excludes embedding/tts models.

[x] [P3-06]  Fix Anthropic listModels() hardcoded array â€” Use real
             /v1/models endpoint.

[x] [P3-07]  Fix Ollama adapter 120s timeout hardcoded â€” Make
             env-configurable.

[x] [P3-08]  Fix Gemini adapter no safety settings â€” Add configurable
             safetySettings per request.

[x] [P3-09]  Fix Gemini functionResponse wraps as {content: JSON} â€” Wrong
             semantics for Gemini API.

### Router Bugs
--------------------------------------------------------------------------------
[x] [P3-10]  Fix Anthropic path only records completion tokens â€” Usage from
             TWO chunks overwrites; must accumulate not overwrite.

[x] [P3-11]  Fix routeAndCollect stream.collect() + stream iteration
             interaction â€” Second iteration returns empty.

[x] [P3-12]  Fix chain model preferred-provider branch â€” Doesn't apply
             `selected.model` (undefined sent to adapter).

[x] [P3-13]  Fix RPM limiter O(n) shift() â€” Use ring buffer or Deque for
             high-RPM providers.

[x] [P3-14]  Fix RPM limiter no tenant/user scoping â€” One noisy user
             exhausts everyone's RPM budget.

[x] [P3-15]  Fix quotaTracker keyed by provider only â€” Should be per-user.

[x] [P3-16]  Fix quotaTracker resetQuota no auth check â€” Document as
             admin-only or add guard.

[x] [P3-17]  Fix OpenRouter :free model daily limits wrong â€” Claims 200
             req/day in config, actual is ~20.

### Ask Route Bugs
--------------------------------------------------------------------------------
[x] [P3-18]  Fix effectiveMembers = [] in direct mode â€” Empty array is
             truthy, doesn't trigger defaults.

[x] [P3-19]  Fix validateAskBody not async â€” Fastify preHandler expects
             async functions.

[x] [P3-20]  Fix userId ?? 0 fallback â€” Can access user 0's data; use null
             and reject anonymous explicitly.

[x] [P3-21]  Fix semantic cache cross-tenant data flow â€” Anonymous user
             populates cache, authenticated users read it.

### Admin Route Bugs
--------------------------------------------------------------------------------
[x] [P3-22]  Fix admin parseInt(id) without NaN check â€” Send 400 on
             non-numeric IDs.

[x] [P3-23]  Fix admin sortBy SQL injection risk â€” Whitelist allowed sort
             columns.

[x] [P3-24]  Fix admin audit export OOM â€” Stream response instead of
             buffering 50k rows.

[x] [P3-25]  Fix admin PATCH /config no key whitelist â€” Validate allowed
             config keys.

[x] [P3-26]  Fix council PUT /config customArchetypes unbounded â€” Add max
             length + systemPrompt cap per archetype.

### Workflow / Other
--------------------------------------------------------------------------------
[x] [P3-27]  Fix workflow loop node eval() on user-controlled expression â€”
             Replace eval() with safe expression parser (expr-eval, jsep).
             This is an RCE vector in the main Node.js process.

[x] [P3-28]  Fix cross-vendor API key leak â€” OpenAI API key sent in
             Authorization header to siliconflow.cn and other third-party
             endpoints. Scope keys per vendor.

================================================================================
## P4 â€” MISSING FEATURES & ENHANCEMENTS
================================================================================

### Security Hardening
--------------------------------------------------------------------------------
[x] [P4-01]  Add CSRF protection plugin â€” @fastify/csrf-protection.

[x] [P4-02]  Add Helmet CSP/HSTS env knobs â€” Configurable content security
             policy per environment.

[x] [P4-03]  Add constant-time comparison + HMAC-SHA256 helpers to crypto.ts
             â€” For webhook signature validation.

[x] [P4-04]  Add Zod validation to all config file loading â€” Replace
             hand-rolled checks in providers.json, archetypes.ts, etc.

[x] [P4-05]  Add per-route rate limit overrides â€” Sandbox needs 1/min, not
             global 10.

[x] [P4-06]  Add multi-tenant/org isolation â€” Currently per-user only;
             enterprises need org boundaries.

[x] [P4-07]  Add threat model document â€” Beyond SECURITY.md, especially for
             sandbox + MCP client attack surfaces.

### Observability
--------------------------------------------------------------------------------
[x] [P4-08]  Add OTEL_EXPORTER_OTLP_ENDPOINT to env â€” Tracer exists but no
             config knob.

[x] [P4-09]  Add SENTRY_DSN or error tracking â€” Pino+Prometheus poor for
             exception triage.

[x] [P4-10]  Add GRACEFUL_SHUTDOWN_MS env â€” BullMQ + Fastify need SIGTERM
             coordination.

[x] [P4-11]  Add Redis memory cap guidance â€” Will OOM under long-running
             artifact streams.

[x] [P4-12]  Add per-tenant Prometheus labels â€” Per-tenant SLO tracking
             impossible without it.

[x] [P4-13]  Add router_exhausted_total Prometheus counter â€” No telemetry
             for “all providers exhausted” case.

### Infrastructure
--------------------------------------------------------------------------------
[x] [P4-14]  Move artifact stream from EventEmitter to Redis Streams â€”
             Multi-replica support.

[x] [P4-15]  Add Redis-backed checkpoints for background agents â€” Currently
             in-memory only; lost on restart.

[x] [P4-16]  Add worker autoscaling signals â€” BullMQ job-lag metrics to
             Prometheus for HPA.

[x] [P4-17]  Add queue priorities â€” Deliberation vs background research
             shouldn't share a lane.

[x] [P4-18]  Add per-source timeout for federated search â€” One hanging
             backend stalls entire call.

### Provider & Routing
--------------------------------------------------------------------------------
[x] [P4-19]  Add more providers â€” Azure OpenAI, Bedrock, Vertex AI, Fireworks,
             Together, DeepInfra.

[x] [P4-20]  Add vector DB adapter abstraction â€” Let Pinecone/Weaviate/Qdrant
             plug in alongside pgvector.

[x] [P4-21]  Add embedding model abstraction â€” Required for RAG pipeline
             flexibility.

[x] [P4-22]  Make provider chain env/config-configurable â€” Currently
             hardcoded; requires code deploy to change chain.

[x] [P4-23]  Add priority/tag system to router â€” Express "prefer fast over
             cheap" or "prefer tool-capable".

[x] [P4-24]  Add per-route rate limit differentiation â€” Rather than global
             knob.

[x] [P4-25]  Add AbortSignal support to route() â€” No cancellation propagation
             currently.

[x] [P4-26]  Add provider health probes endpoint â€” Circuit breaker state
             visible for dashboards.

### API Enhancements
--------------------------------------------------------------------------------
[x] [P4-27]  Add consensus explainability API â€” Expose penalty breakdown
             (claimScore, debateScore, diversityBonus).

[x] [P4-28]  Add per-provider cost ledger endpoint â€” `/api/costs/breakdown`.

[x] [P4-29]  Add reliability score admin panel API â€” Reset/override after
             model upgrades.

[x] [P4-30]  Add deliberation replay endpoint â€”
             `GET /api/deliberations/:id/replay`.

[x] [P4-31]  Add webhook dead-letter inspection API â€” DLQ browser/retry
             endpoint.

[x] [P4-32]  Add pagination & filter standards â€” Cursor vs offset decisions
             documented and enforced.

[x] [P4-33]  Add SOC 2 audit log export endpoint â€” Structured export with
             proper auth.

[x] [P4-34]  Add S3/GCS for artifact storage â€” Current in-memory stream
             won't scale.

### OSS Hygiene
--------------------------------------------------------------------------------
[x] [P4-35]  Add LICENSE file â€” MIT or Apache-2.0 (non-negotiable for OSS
             credibility).

[x] [P4-36]  Rename package from council-project to aibyai â€” Branding
             mismatch in package.json.

[x] [P4-37]  Add keywords to package.json â€” Currently empty; terrible for
             discoverability.

[x] [P4-38]  Add Prettier/format script â€” No formatter = style drift between
             committers.

[x] [P4-39]  Add prepare husky hook â€” Commit-time linting currently skipped.

[x] [P4-40]  Add "packageManager" field to package.json â€” Prevent lockfile
             drift across Node versions.

[x] [P4-41]  Write Perplexity adapter or delete orphan test â€”
             tests/adapters/perplexity.test.ts has no implementation.

[x] [P4-42]  Fix README: 5 archetypes vs actual 14 â€” Documentation drift.

[x] [P4-43]  Fix README: provider table missing NVIDIA, Xiaomi, Cerebras â€”
             Listed in env but not docs.

[x] [P4-44]  Add SMTP/email env variables â€” HITL approvals and webhooks need
             notification delivery.

[x] [P4-45]  Add bench script â€” autocannon installed but no wired benchmark.

[ ] [P4-46]  Add demo URL / video â€” Zero stars because nobody can see it
             work.

### Research-Grade
--------------------------------------------------------------------------------
[ ] [P4-47]  Add calibration curves and Brier score tracking â€” Current
             confidence formula is heuristic with no ground truth.

[ ] [P4-48]  Add counterfactual debate mode â€” Force agent to argue opposite;
             measure robustness.

[ ] [P4-49]  Add ensemble distillation â€” Use council to generate training
             dataset for small local model.

[ ] [P4-50]  Shard pgvector HNSW indexes â€” HNSW doesn't rebuild cheaply;
             partition by user/workspace.

================================================================================
## P5 â€” TECH DEBT & CLEANUP
================================================================================

[x] [P5-01]  Verify TypeScript 6.0.3 compatibility â€” Ahead of stable; may
             have ecosystem breakage.

[x] [P5-02]  Verify ESLint 10.2.0 compatibility â€” Major ahead of v9.x flat
             config era.

[x] [P5-03]  Audit pdf-parse 2.4.5 for CVEs â€” Historically notorious for
             security issues.

[x] [P5-04]  Pin jsonwebtoken 9.0.3 strictly â€” Had algorithm-confusion
             advisory.

[x] [P5-05]  Replace passport-github2 0.1.12 â€” Effectively abandoned; use
             @fastify/oauth2.

[x] [P5-06]  Fix Drizzle ORM 0.45.2 â€” Verify vs latest for HNSW index DDL
             support.

[x] [P5-07]  Fix swagger-jsdoc types-only â€” @types in devDeps but no runtime
             dep; OpenAPI spec may be missing.

[x] [P5-08]  Remove dompurify override â€” Audit all consumers of the
             vulnerable component.

[x] [P5-09]  Fix test:ci --bail=1 â€” Hides downstream failures; won't show
             full failure surface.

[x] [P5-10]  Add topic graph TTL/GC â€” Currently unbounded growth.

[x] [P5-11]  Fix memoryCrons.ts location â€” Should be in queue/, not lib/.

[x] [P5-12]  Add tests for sweeper.ts â€” Cron-based sweepers silently break.

[x] [P5-13]  Fix duplicate archetypes.ts â€” config/archetypes.ts vs
             lib/archetypes.ts.

[x] [P5-14]  Move archetype prompts to structured format â€” YAML + schema
             validation, not TS string literals.

[x] [P5-15]  Fix Gemini default model rolling alias â€” Pin explicit version
             instead of gemini-2.5-flash.

[x] [P5-16]  Fix Mistral model rolling alias â€” Pin mistral-small-2501 not
             mistral-small-latest.

[x] [P5-17]  Fix tokenEstimator dead code â€” Result unused by selectProvider;
             either wire in or remove.

[x] [P5-18]  Fix mask() leaks 25% of key â€” Show only last-4, not
             first-4 + last-4.

[x] [P5-19]  Fix eager env import in crypto.ts â€” Triggers validation
             side-effect in tests.

================================================================================
## P6 â€” TEST SUITE GAPS (from test audit, not in source audit above)
================================================================================

### Critical Test Gaps
--------------------------------------------------------------------------------
[x] [P6-01]  validateSafeUrl is mocked in every test â€” Real SSRF protection
             never exercised. Add integration tests with a real HTTP server
             asserting private IPs are blocked.

[x] [P6-02]  isolated-vm fully mocked in sandbox tests â€” Actual VM escape
             surface never tested. Add at least one test running real
             isolated-vm with known safe/unsafe code.

[x] [P6-03]  Diagnostic scripts inside tests/ make real external API calls â€”
             tests/testGoogleConnection.ts, tests/verifyConnectors.ts,
             tests/verifyMultipleKeys.ts fire live requests in CI. Move to
             scripts/diagnostics/ and exclude from vitest.

[x] [P6-04]  E2E auth.spec.ts tautological assertions â€” Patterns like
             `expect(x || true).toBeTruthy()` always pass. Tests broken auth
             report green. Replace with strict equality on all auth assertions.

[x] [P6-05]  E2E kb-upload.spec.ts uploads nothing â€” FormData built but no
             file appended. Rewrite with real synthetic file and assert
             retrieval by content.

[x] [P6-06]  E2E workflow.spec.ts always-pass assertion â€”
             `expect(['completed','running','failed']).toContain(status)`
             passes for any status. Assert `status === 'completed'`.

### High-Priority Test Gaps
--------------------------------------------------------------------------------
[x] [P6-07]  contradictionResolution service has zero tests â€” Core council
             correctness logic never verified. Add unit tests for detection,
             non-detection, and performance at n=14 archetypes.

[x] [P6-08]  backgroundAgents tests use 8 real setTimeout calls â€” Flaky and
             slow. Replace with vi.useFakeTimers().

[x] [P6-09]  hitlGates tests use real timers for timeout scenarios â€” Same
             risk. Use fake timers; add explicit test for expiry â†’ timeout
             branch transition.

[x] [P6-10]  Webhooks service has no SSRF test coverage â€” No test verifies
             private IP ranges are blocked before delivery.

[x] [P6-11]  vectorStore safeVectorLiteral injection untested â€” Malformed
             embeddings (NaN, Infinity, wrong dim) should be rejected before
             SQL layer.

[x] [P6-12]  Workflow executor has no timeout test â€” Infinite-loop workflow
             should be terminated within configured wall-clock budget.

### Medium-Priority Test Gaps
--------------------------------------------------------------------------------
[x] [P6-13]  SSE streaming tests don't cover split-chunk messages â€” A single
             SSE event spanning two TCP packets is never tested. Real parse
             behavior differs from mocked.

[x] [P6-14]  Three duplicate provider implementations in test helpers â€”
             Consolidate into shared test fixture.

[x] [P6-15]  audioVideo service tests only failure paths â€” No happy-path test
             with synthetic audio fixture.

[x] [P6-16]  RRF scoring formula mathematically unverified â€” Test with known
             inputs and manually computed expected scores.

================================================================================
## P7 â€” ADDITIONAL ITEMS (from deep file-by-file extraction, not in above)
## Source: linear unclustered extraction, batch 1â€“3, file-by-file
================================================================================

### registry.ts â€” Adapter Registry Issues
--------------------------------------------------------------------------------
[x] [P7-01]  Fix side-effect initialization â€” `initBuiltinAdapters()` runs at
             module load; breaks unit tests and makes registry untestable in
             isolation. Make registry lazy via memoized getter.

[x] [P7-02]  Fix “llama” heuristic collision â€” `”llama”` substring matches
             both Ollama and Groq models; Ollama checked first causes wrong
             routing for Groq llama models. Replace with structured model
             prefix/provider table, not string `includes()`.

[x] [P7-03]  Fix Mixtral misrouted to Groq only â€” Registry routes all
             "mixtral" models to Groq, ignoring the Mistral adapter entirely.
             Add explicit Mistral routing rule.

[x] [P7-04]  Add cleanup before re-init â€” No clear/reset before
             `initBuiltinAdapters()` on reload; causes duplicate adapter
             registrations and noisy logs. Clear registry map before
             re-populating.

### adapters/types.ts â€” Core Type Issues
--------------------------------------------------------------------------------
[x] [P7-05]  Fix tool arguments type â€” `arguments: Record<string, unknown>`
             is incompatible across providers (some expect JSON string, some
             object). Change to `string | Record<string, unknown>` with
             explicit serialization boundary.

[x] [P7-06]  Add finish_reason to response type â€” No `finish_reason` field
             in adapter response type. Downstream code cannot distinguish
             `stop` / `length` / `tool_calls` / `content_filter` without it.

[x] [P7-07]  Extend usage metadata â€” Usage type missing `cost`, `latency_ms`,
             and `provider_id` fields. Required for accurate cost accounting
             and per-provider SLO tracking.

[x] [P7-08]  Add completeness check to collect() â€” `collect()` throws on
             stream error but silently accepts incomplete streams (no final
             chunk). Add a `complete` flag; reject if stream ends without it.

[x] [P7-09]  Unify system prompt handling â€” Two parallel mechanisms:
             `system_prompt` field + message with `role: "system"`. Leads to
             prompts being sent twice or one being silently dropped depending
             on adapter. Define a single canonical path.

### lib/providerRegistry.ts â€” Secondary Registry Issues
--------------------------------------------------------------------------------
[x] [P7-10]  Fix __dirname fragile under bundling â€” `__dirname` breaks when
             the module is bundled (esbuild/tsup). Use
             `new URL(import.meta.url)` or embed config as a module import.

[x] [P7-11]  Expand default registry â€” Default registry hardcodes only 3
             providers. New providers added to adapters are invisible until
             manually added here too. Derive from adapter registry instead.

[x] [P7-12]  Add cache invalidation â€” Registry has no mechanism to
             invalidate cached provider configs after hot-reload or config
             file change. Causes stale routing in long-running processes.

### lib/providers.ts â€” Legacy Provider Layer Bugs
--------------------------------------------------------------------------------
[x] [P7-13]  Fix string-based error matching â€” Error handling uses
             `error.message.includes("rate limit")` style matching. Brittle:
             any provider that changes its error wording silently breaks
             fallback logic.

[x] [P7-14]  Fix retry Ã— fallback explosion â€” Retry logic and fallback logic
             are both active simultaneously; a 3-retry Ã— 3-fallback config
             produces 9 total attempts with no cap. Add a max-total-attempts
             guard.

[x] [P7-15]  Fix isFallback manual propagation â€” `isFallback` flag manually
             threaded through call chain; easy to lose when wrapping. Use
             context/metadata object instead.

### lib/providers/factory.ts â€” Dispatch Layer
--------------------------------------------------------------------------------
[x] [P7-16]  Fix error strings tightly coupled to callers â€” Factory throws
             raw strings like `"Unknown provider type"` that callers match
             with `error.message.includes(...)`. Use typed error classes.

[x] [P7-17]  Remove dead branch "openai-compat" â€” Dead dispatch branch in
             factory that was never wired up. Remove to reduce confusion.

### lib/providers/baseProvider.ts
--------------------------------------------------------------------------------
[x] [P7-18]  Add per-request timeout â€” baseProvider has no request-level
             AbortSignal timeout; a hung upstream will hold the connection
             indefinitely. Add `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`.

### lib/providers/types.ts â€” Legacy Type Issues
--------------------------------------------------------------------------------
[x] [P7-19]  Type ContentBlock properly â€” `ContentBlock` defined as
             `[key: string]: unknown`. Add discriminated union:
             `{ type: "text", text: string } | { type: "image", ... }`.

[x] [P7-20]  Fix userId forced as number â€” Legacy type forces `userId:
             number`, incompatible with UUID-based auth. Change to
             `string | number` or migrate to string throughout.

[x] [P7-21]  Add multi-modal typing to legacy layer â€” Legacy provider types
             have no multi-modal content typing; image inputs get silently
             dropped or serialized as `[object Object]`.

### OpenAI Adapter â€” Additional Bugs
--------------------------------------------------------------------------------
[x] [P7-22]  Fix fragile \r\n handling in SSE parser â€” SSE parser handles
             `\n` split but not `\r\n` (Windows-style line endings from some
             proxies). Causes parse failures for proxied OpenAI traffic.

[x] [P7-23]  Fix tool-call parsing edge cases â€” Parallel tool calls where
             delta chunks arrive out of order or with missing `index` fields
             are silently dropped. Add index-based accumulation.

[x] [P7-24]  Fix duplicate usage emission â€” Usage stats emitted twice per
             request (once mid-stream, once at end). Results in double-counted
             cost in metrics.

### Anthropic Adapter â€” Additional Bugs
--------------------------------------------------------------------------------
[x] [P7-25]  Fix weak availability check â€” Anthropic adapter availability
             check only tests that the API key env var is non-empty; doesn't
             validate key format or reachability. A placeholder value silently
             enables the adapter.

[x] [P7-26]  Add tool_call_id validation â€” Anthropic tool-use responses lack
             validation that `tool_call_id` matches a pending tool call.
             Mismatch causes silent result misrouting.

### Gemini Adapter â€” Additional Bugs
--------------------------------------------------------------------------------
[x] [P7-27]  Fix random tool-call IDs â€” Gemini adapter generates random IDs
             for tool calls instead of tracking IDs from request. Breaks
             tool-result correlation in multi-turn conversations.

[x] [P7-28]  Add stream error event handling â€” Gemini SSE stream has no
             `error` event handler; a mid-stream error causes an unhandled
             promise rejection that crashes the worker.

[x] [P7-29]  Fix usage not streamed progressively â€” Gemini usage stats only
             emitted at end of stream, not per-chunk. Breaks real-time cost
             tracking for long responses.

### Groq Adapter â€” Additional Bugs
--------------------------------------------------------------------------------
[x] [P7-30]  Fix inconsistent model listing â€” Groq adapter model list
             includes deprecated/renamed models and misses new releases.
             Pull from `/openai/v1/models` endpoint or add a refresh
             mechanism.

### OpenRouter Adapter â€” Additional Bugs
--------------------------------------------------------------------------------
[x] [P7-31]  Fix hardcoded referer header â€” `HTTP-Referer` header hardcoded
             to a fixed value. Should be configurable via env var for white-
             label deployments.

### Ollama Adapter â€” Additional Bugs
--------------------------------------------------------------------------------
[x] [P7-32]  Fix dual timeout system conflict â€” Ollama adapter has both a
             hardcoded 120s fetch timeout AND a separate AbortController
             timeout; whichever fires first leaves the other dangling and
             causes resource leaks.

[x] [P7-33]  Fix incorrect role mapping â€” Ollama uses `"assistant"` where
             some message chains require `"model"` (Gemini convention leaking
             in); causes API rejection on strict endpoints.

[x] [P7-34]  Add model availability check â€” Ollama adapter sends requests
             to models without first verifying they are pulled locally.
             Should call `/api/tags` and return a clear error if the model
             is absent.

### Custom Adapter â€” Security & Correctness
--------------------------------------------------------------------------------
[x] [P7-35]  Fix API key in query string â€” Custom adapter appends API key
             as a URL query parameter (`?key=...`). Keys appear in server
             access logs, CDN logs, and browser history. Move to
             Authorization header.

[x] [P7-36]  Add tool-call parsing â€” Custom adapter has no tool-call
             parsing; tool-augmented workflows silently produce no tool
             invocations when routed through custom endpoints.

[x] [P7-37]  Add decrypt error handling â€” `decryptApiKey()` call in custom
             adapter has no try/catch; a corrupt ciphertext throws an
             unhandled exception that leaks internal state in the error
             response.

[x] [P7-38]  Fix weak basic auth handling â€” Custom adapter's basic auth
             construction does not validate that username/password are
             non-empty before base64 encoding, producing malformed headers
             silently.

[x] [P7-39]  Fix inconsistent URL validation â€” Custom adapter validates the
             base URL in some code paths but not others (streaming path skips
             validation). Apply `validateSafeUrl()` to all paths uniformly.

### Strategies â€” Additional Issues
--------------------------------------------------------------------------------
[x] [P7-40]  Add recursion depth limit â€” Tool-call recursion in all three
             strategies (OpenAI/Anthropic/Google) has no depth cap. A model
             that repeatedly calls tools can recurse until stack overflow.
             Add `maxDepth` config (default 5).

[x] [P7-41]  Standardize SSRF handling across strategies â€” Strategies apply
             SSRF validation inconsistently; some check before fetch, some
             after URL construction, some not at all. Centralize into a
             shared pre-fetch hook.

### archetypes.ts â€” Design Issues
--------------------------------------------------------------------------------
[x] [P7-42]  Fix SUMMONS list redundant â€” SUMMONS array lists archetypes to
             include in deliberations, but all 14 archetypes are listed;
             the filtering is a no-op. Either remove SUMMONS or implement
             selective summoning per task type.

[x] [P7-43]  Fix inconsistent tool assignment â€” Some archetypes have no
             tools array, some have partial sets, some have all tools. No
             policy document defines which archetypes should have which
             capabilities.

[x] [P7-44]  Unify persona systems â€” Two persona mechanisms coexist:
             `systemPrompt` field on archetype + a separate `PersonaManager`
             class. Behavior differs depending on which code path activates
             each archetype.

### jsSandbox.ts â€” Additional Issues
--------------------------------------------------------------------------------
[x] [P7-45]  Fix blocking console calls â€” `console.log` in sandbox flushes
             synchronously to stdout, blocking the Node event loop during
             high-volume sandbox output. Buffer and flush asynchronously.

[x] [P7-46]  Add stdout/stderr separation â€” Sandbox currently mixes stdout
             and stderr into a single output array. Callers cannot distinguish
             log output from error output. Add separate `stdout` and `stderr`
             arrays to the result.

[x] [P7-47]  Add global whitelist â€” JS sandbox restricts some globals by
             deletion but has no affirmative whitelist of allowed globals.
             Any global added to Node in a future version is automatically
             accessible. Switch to allowlist model: deny everything, permit
             explicitly.

================================================================================
## P8 â€” BATCH 5-6 ADDITIONS (app.ts, index.ts, agents, auth strategies, DB schema,
##      middleware, routes â€” items not covered in prior passes)
================================================================================

### app.ts â€” Server Configuration Issues
--------------------------------------------------------------------------------
[x] [P8-01]  Fix /metrics endpoint security â€” Three issues in one:
             (a) IP spoofing via X-Forwarded-For allows bypass of IP
             allowlist, (b) token comparison is not constant-time (timing
             oracle leaks token validity), (c) no rate limiting on /metrics
             allows brute-force of the metrics token. Fix: constant-time
             compare via `crypto.timingSafeEqual`, add rate limit, validate
             source IP against trusted proxy list only.

[x] [P8-02]  Fix CORS allows localhost in production â€” CORS origin list
             includes `localhost:*` patterns that are not stripped in prod
             builds. A malicious page served locally can make credentialed
             requests to the production API.

[x] [P8-03]  Remove global 200KB bodyLimit â€” Global body limit breaks file
             uploads and causes unintended buffering of large payloads into
             memory before route handlers run. Replace with per-route limits
             sized to each route's actual needs.

[x] [P8-04]  Move static file middleware after API routes â€” Static
             middleware mounted at `/` intercepts API errors and returns HTML
             404s instead of JSON. Mount static after all API route
             registrations.

[x] [P8-05]  Disable Swagger UI in production â€” Swagger/OpenAPI UI currently
             enabled in all environments. In production this exposes full
             API schema, parameter names, and auth flows to attackers.
             Gate behind `NODE_ENV !== "production"` or require auth.

[x] [P8-06]  Add WS/SSE connection limits â€” No maximum on concurrent
             WebSocket or SSE connections per user or globally. A single
             user can exhaust server file descriptors by opening thousands
             of streams.

[x] [P8-07]  Split /live and /ready health endpoints â€” Current health check
             queries DB and Redis. This conflates liveness (process is
             running) with readiness (dependencies available). Kubernetes
             restarts pods on liveness failure; a slow DB causes unnecessary
             restarts. Implement separate `/live` (always 200 if process up)
             and `/ready` (checks DB/Redis).

[x] [P8-08]  Remove runtime createRequire on package.json â€” Server reads
             package.json at runtime via `createRequire` for version info.
             Fragile under Docker layer caching and bundling. Embed version
             at build time via `__VERSION__` replacement.

### index.ts â€” Process Lifecycle Issues
--------------------------------------------------------------------------------
[x] [P8-09]  Fix uncaughtException/unhandledRejection exits â€” Both handlers
             call `process.exit(1)` immediately, killing all in-flight
             requests. Replace with: log the error, attempt graceful drain,
             exit only after timeout. Distinguish fatal startup errors from
             recoverable runtime errors.

[x] [P8-10]  Wrap buildApp() in try/catch with classification â€” Startup
             errors currently propagate uncaught. Wrap in try/catch;
             classify as: config error (exit immediately), DB connection
             error (retry with backoff), port conflict (log and exit).

[x] [P8-11]  Fix SIGTERM/SIGINT double-signal race â€” No guard against
             receiving SIGTERM twice or SIGTERM+SIGINT simultaneously.
             Second signal triggers a second shutdown sequence. Add a
             `isShuttingDown` guard; second signal should force-exit.

[x] [P8-12]  Prevent duplicate signal handler registration â€” Signal
             handlers registered multiple times (e.g., during test restarts)
             stack up and fire multiple times. Use `process.removeAllListeners`
             before re-registering or use a singleton guard.

### agents/orchestrator.ts â€” Logic & Security
--------------------------------------------------------------------------------
[x] [P8-13]  Fix rebuttal classification prompt injection â€” Rebuttal type
             detection uses string/regex matching on LLM output, vulnerable
             to prompt injection: a model can output "AGREE:" prefixes to
             manipulate debate flow. Replace with structured JSON output or
             constrained generation.

[x] [P8-14]  Fix "auto" model â€” hidden cost and no user attribution â€” The
             orchestrator uses model `"auto"` for synthesis calls; these
             LLM invocations are not attributed to the user's quota or cost
             ledger. All LLM calls must be billed to the triggering user.

[x] [P8-15]  Fix sanitizeForPrompt ineffective â€” The prompt sanitization
             function is insufficient to prevent injection; user-controlled
             data (custom instructions, archetype inputs) can still break
             out of intended prompt boundaries. Use a structured prompt
             builder that never interpolates raw user strings.

[x] [P8-16]  Fix bus.reset() not called on failure â€” `messageBus.reset()`
             is only called on success path; on exception it is skipped.
             Use a `finally` block to guarantee reset, preventing message
             state from a failed session leaking into the next.

[x] [P8-17]  Add token budget check before synthesis â€” Orchestrator
             assembles all archetype outputs then synthesizes without
             checking token count. For large councils this can exceed model
             context window mid-request. Add pre-synthesis token estimation;
             truncate or summarize earlier rounds if budget is exceeded.

[x] [P8-18]  Track "auto"-routed models in reliability system â€” When the
             router resolves `"auto"` to a real provider, the resolved
             provider name is not recorded in the reliability/scoring system.
             All reliability metrics for auto-routed requests are lost.

[x] [P8-19]  Persist pendingHumanGates to Redis â€” HITL gate state stored
             only in-process memory. A server restart loses all pending
             approvals, blocking workflows forever. Persist gate state to
             Redis with TTL; restore on startup.

### agents/conflictDetector.ts
--------------------------------------------------------------------------------
[x] [P8-20]  Fix O(nÂ²) LLM calls in conflict detection â€” Every archetype
             pair is compared via a separate LLM call. At n=14 archetypes
             that is 91 LLM calls per deliberation round â€” cost explosion.
             Add embedding-based cosine pre-filter to skip pairs unlikely
             to conflict; only LLM-compare high-similarity pairs.

[x] [P8-21]  Fix JSON parsing via regex â€” Conflict detector parses LLM JSON
             responses using regex extraction rather than `JSON.parse()`.
             Malformed responses silently corrupt conflict scores. Use
             `JSON.parse()` with a try/catch and reject malformed responses.

[x] [P8-22]  Make severity threshold configurable â€” Conflict severity
             threshold hardcoded as a magic number. Should be an env var
             or config value so it can be tuned without code deployment.

### agents/sharedMemory.ts
--------------------------------------------------------------------------------
[x] [P8-23]  Fix non-atomic shared memory updates â€” Shared memory
             read-modify-write is not atomic; concurrent updates from
             multiple archetype agents race and last-writer-wins silently
             drops earlier updates. Use atomic SQL `UPDATE ... SET x = x ||
             $new WHERE id = $id` or a Redis transaction.

[x] [P8-24]  Add ownership validation to sharedMemory â€” Functions that
             read/write shared memory accept a `conversationId` with no
             check that the caller owns that conversation. This is an IDOR:
             any agent can overwrite any conversation's shared facts.

[x] [P8-25]  Bill LLM fact extraction to user â€” LLM calls inside
             `extractFacts()` are not attributed to the user's quota.
             Hidden cost accumulates without limit.

### agents/messageBus.ts
--------------------------------------------------------------------------------
[x] [P8-26]  Cap allMessages array â€” `allMessages` grows unbounded for the
             lifetime of a deliberation. For long council sessions this
             causes significant memory growth. Add a max-size cap with
             drop-oldest semantics.

[x] [P8-27]  Fix subscription race during broadcast â€” Broadcasting to
             subscribers while iterating the subscriber map can cause
             iterator invalidation if a subscriber unsubscribes mid-
             broadcast. Snapshot the subscriber list before iterating.

[x] [P8-28]  Log/error on unknown agent message â€” Messages sent to an
             agent name not in the registry are silently dropped. Add a
             warning log so misconfigured workflows are detectable.

### agents/personas.ts
--------------------------------------------------------------------------------
[x] [P8-29]  Move personas to database â€” Persona definitions hardcoded in
             source; runtime updates require a deployment. Move to DB table
             with admin CRUD API.

[x] [P8-30]  Fix schema mismatch between built-in and custom personas â€”
             Built-in personas and user-defined custom personas have
             different field shapes; custom persona fields silently ignored
             when processed by built-in code paths.

### auth/github.strategy.ts & auth/google.strategy.ts â€” OAuth Security
--------------------------------------------------------------------------------
[x] [P8-31]  Fix GitHub OAuth accepts unverified email â€” GitHub strategy
             accepts the primary email without checking `verified === true`.
             An attacker can register a GitHub account with an unverified
             email matching a victim's address and take over the victim's
             account. Strictly require `email.verified === true`.

[x] [P8-32]  Fix Google OAuth weak verification check â€” Google strategy
             checks `if (verified === false)` which passes when `verified`
             is `undefined` or any truthy non-false value. Change to
             `if (verified !== true)`.

[x] [P8-33]  Add OAuth state parameter validation â€” OAuth callback does not
             validate the `state` parameter against the value stored at
             authorization time. Allows CSRF on the OAuth flow: attacker
             can force a victim to link the attacker's OAuth account.

[x] [P8-34]  Replace passwordHash empty string as auth-type flag â€”
             `passwordHash: ""` used to detect OAuth-only accounts.
             Fragile: empty string can appear from bugs. Add an explicit
             `auth_method: "password" | "github" | "google"` column.

### DB Schema â€” Additional Issues
--------------------------------------------------------------------------------
[x] [P8-35]  Make conversations.userId NOT NULL â€” Nullable userId allows
             orphaned conversations not tied to any user. Breaks quota
             accounting and access control. Add NOT NULL + FK constraint.

[x] [P8-36]  Add missing foreign keys â€” `traces.userId` and
             `sharedFacts.conversationId` have no FK constraints. Orphaned
             rows accumulate silently; cascade delete is impossible.

[x] [P8-37]  Add timezone to all timestamps â€” All timestamp columns use
             `timestamp` (no timezone). Stored values are ambiguous across
             DST changes and deployments in different timezones. Change to
             `timestamptz` throughout.

[x] [P8-38]  Fix nullable email with unique constraint â€” `users.email`
             allows NULL with a unique constraint; PostgreSQL treats each
             NULL as distinct, so multiple NULL emails are permitted. Change
             to NOT NULL.

[x] [P8-39]  Standardize ID types â€” Schema mixes `serial` (integer) and
             `uuid` primary keys across tables. Cross-table joins require
             casts; integer IDs are enumerable. Migrate all to UUID.

[x] [P8-40]  Add missing unique constraints â€” Several tables lack unique
             constraints that are implied by business logic (e.g.,
             one active session per user per device). Missing constraints
             allow duplicates to accumulate.

[x] [P8-41]  Define Drizzle relations â€” No Drizzle `relations()` defined
             for any table. Without relations, Drizzle query builder cannot
             perform type-safe joins; all cross-table queries use raw SQL.

[x] [P8-42]  Move large JSON fields to side tables â€” Several tables store
             large JSON blobs inline (e.g., full conversation history,
             archetype prompts). PostgreSQL TOAST handles this but inline
             storage degrades index scan performance. Move to side tables
             with FK.

[x] [P8-43]  Fix denormalized counters without triggers â€” Vote counts,
             message counts, and similar aggregates stored as denormalized
             columns with no DB trigger to keep them consistent. Concurrent
             increments race; counts drift from reality.

[x] [P8-44]  Enforce or remove org/tenant system â€” `organizations` table
             and `orgId` columns defined in schema but never enforced in
             application logic. Dead weight in schema, or unfinished
             multi-tenant isolation. Either wire up or remove.

### fastifyAuth.ts â€” Middleware Issues
--------------------------------------------------------------------------------
[x] [P8-45]  Add index on revokedTokens â€” No index on `revokedTokens.token`
             column. Every authenticated request does a full table scan for
             revocation check. Add unique index; table will grow
             continuously.

[x] [P8-46]  Sanitize auth logs â€” Auth middleware logs include raw URL
             paths and query strings which may contain tokens, API keys, or
             PII. Strip or hash sensitive fields before logging.

[x] [P8-47]  Add JWT clock skew tolerance â€” `jwt.verify()` called without
             `clockTolerance` option. Legitimate requests fail if client
             clock is a few seconds ahead of server. Add `clockTolerance: 30`
             (seconds).

### quota.ts â€” Additional
--------------------------------------------------------------------------------
[x] [P8-48]  Fix incorrect token accounting in quota headers â€” Response
             headers reporting remaining quota and token counts use wrong
             values (off-by-one or pre-decrement values). Verify header
             values reflect post-deduction state.

### errorHandler.ts
--------------------------------------------------------------------------------
[x] [P8-49]  Sanitize error responses in all environments â€” Error handler
             leaks stack traces and internal error messages even in
             non-production environments (staging, review apps). Only
             expose message for known operational errors; always return
             generic message for unexpected errors.

[x] [P8-50]  Fix weak Zod error detection â€” Zod errors detected via
             `error.name === "ZodError"` string check which can be spoofed.
             Use `error instanceof ZodError`.

[x] [P8-51]  Include request ID in error responses â€” Error responses don't
             include the request ID, making it impossible to correlate a
             client-reported error with server logs. Add `requestId` field
             to all error response bodies.

[x] [P8-52]  Remove dead isOperational flag â€” `isOperational` property on
             error objects is checked but never set anywhere in the codebase.
             Dead code that creates false confidence in error classification.
             Remove or implement properly.

### validate.ts â€” Additional
--------------------------------------------------------------------------------
[x] [P8-53]  Add member count limit â€” No cap on `members` array in ask
             requests. Large member arrays cause cost explosion proportional
             to number of archetypes Ã— member count. Add a configurable max
             (e.g., 10).

[x] [P8-54]  Enforce minimum password length of 12 â€” Current minimum is 6
             characters, far below NIST SP 800-63B recommendations. Change
             to min 12 + require at least one non-alpha character.

### cspNonce.ts â€” Additional CSP Issues
--------------------------------------------------------------------------------
[x] [P8-55]  Remove unsafe-inline from style-src â€” `style-src` includes
             `unsafe-inline` allowing injected `<style>` tags. Remove and
             use nonce-based inline styles instead.

[x] [P8-56]  Add CSP violation reporting endpoint â€” No `report-uri` or
             `report-to` directive in CSP header. CSP violations are silent;
             injection attempts go undetected. Add reporting endpoint.

[x] [P8-57]  Apply CSP only to HTML responses â€” CSP header currently sent
             on all responses including JSON API responses. Wastes header
             bandwidth and can interfere with some API clients. Apply only
             to `Content-Type: text/html` responses.

### prometheusMiddleware.ts â€” Additional
--------------------------------------------------------------------------------
[x] [P8-58]  Fix missing histogram timer cleanup â€” Request duration
             histogram timer not cleaned up on connection abort or early
             close. Timers accumulate as leaked references. Ensure timer
             is ended in `onError` and `onAbort` hooks.

### routes/auth.ts â€” Additional
--------------------------------------------------------------------------------
[x] [P8-59]  Fix in-process rate limit Map memory growth â€” The in-process
             rate limit Map for auth routes grows without eviction. Under
             sustained traffic from many unique IPs, memory grows
             unboundedly. Add periodic cleanup or use Redis with TTL.

[x] [P8-60]  Replace bcryptjs with argon2id â€” bcryptjs is the JS
             implementation (slower, less secure than native). Use `argon2`
             package (native bindings, Argon2id variant) which is the
             current OWASP recommendation for password hashing.

[x] [P8-61]  Fix prototype pollution via arbitrary JSON settings â€” PUT
             /settings merges user-provided JSON object into settings
             without key filtering. A payload with `__proto__` or
             `constructor` key can pollute Object prototype. Use
             `Object.fromEntries(allowedKeys.map(...))` pattern.

### routes/ask.ts â€” Additional
--------------------------------------------------------------------------------
[x] [P8-62]  Fix SSE error handling broken â€” When the upstream provider
             errors mid-stream, the SSE connection is not properly
             terminated with an error event. The client hangs waiting for
             more data. Send a properly formatted `event: error` SSE message
             then close the connection.

[x] [P8-63]  Fix artifacts generated but discarded â€” Artifacts (code
             blocks, images) generated during a response are allocated in
             memory but never stored or returned when the response is cached
             or streamed. Either persist artifacts or don't allocate them.

[x] [P8-64]  Add authorization checks on RAG/file access â€” Routes that
             fetch conversation history or files for RAG context don't
             verify the requesting user owns those resources. Any
             authenticated user can retrieve any conversation's context
             by ID.

[x] [P8-65]  Fix token usage not tracked for all paths â€” Token usage is
             recorded for direct provider calls but not for cache hits,
             fallback paths, or tool-use recursion. Usage reports
             systematically under-count actual tokens consumed.

[x] [P8-66]  Cache hits must not bypass quota â€” Semantic cache hits return
             results without decrementing quota. A user who triggers a cache
             population with one account can serve unlimited requests from
             another account for free.

================================================================================
## P9 â€” CORE LIB (BATCH 7): audit.ts, breaker.ts, cache.ts, CacheBackend.ts,
##      PostgresBackend.ts, RedisBackend.ts, retry.ts, redis.ts, db.ts,
##      drizzle.ts, logger.ts, metrics.ts, prometheusMetrics.ts, cost.ts,
##      realtimeCost.ts, errorMapper.ts, context.ts, history.ts, tracer.ts
================================================================================

### lib/audit.ts
--------------------------------------------------------------------------------
[x] [P9-01]  logRouterDecision stores raw reasoning without sanitization before
             persistence â€” prompt internals and decision chains stored verbatim.

[x] [P9-02]  Risk threshold gap (50â€“69) â†’ silent anonymization with no log entry
             â€” events in this band disappear entirely.

[x] [P9-03]  Double PII scan on same content â†’ high CPU overhead â€” scan runs
             twice per audit record.

[x] [P9-04]  Inconsistent success semantics â€” `undefined` return counted as
             success; only explicit false is failure.

[x] [P9-05]  Fake token estimation uses hardcoded 0.4/0.6 input/output split â€”
             actual token counts available but ignored.

[x] [P9-06]  No index on metadata JSONB queries â†’ full-table O(n) scan on every
             audit search.

[x] [P9-07]  sessionId stored only in metadata JSON, not as a first-class indexed
             column.

### lib/breaker.ts
--------------------------------------------------------------------------------
[x] [P9-08]  No LRU/TTL eviction for circuit breakers â†’ memory leak when provider
             list is dynamic (custom providers created/deleted).

[x] [P9-09]  All error types (including 4xx client errors) increment the failure
             counter â†’ false circuit trips on bad requests.

[x] [P9-10]  Conflicting timeout systems: Opossum's built-in timeout AND external
             AbortController both active â€” whichever fires first leaves the other
             dangling.

[x] [P9-11]  Unsafe generic cast on breaker.fire() return value â€” no runtime type
             guard.

### lib/cache.ts
--------------------------------------------------------------------------------
[x] [P9-12]  embeddingLocks Map unbounded â€” burst traffic creates thousands of
             lock entries never cleaned up.

[x] [P9-13]  Silent degradation when OpenAI embedding key missing â€” semantic cache
             silently disabled with no log warning.

[x] [P9-14]  Prompt `.toLowerCase()` normalization causes cache collisions between
             semantically different prompts that differ only by case.

[x] [P9-15]  History serialization format unstable and bloated â€” full message
             objects serialized; schema changes silently corrupt cached entries.

[x] [P9-16]  Cache cleanup via `Math.random() < 0.01` probabilistic â€” unreliable;
             old entries accumulate under steady load.

[x] [P9-17]  Semantic similarity threshold (0.15) hardcoded â€” needs to be
             externalized to config/env.

[x] [P9-18]  Write-order race: PostgreSQL written first, then Redis â€” if Redis
             write fails, subsequent requests bypass Postgres and miss the entry.

[x] [P9-19]  Dead optional chaining `setSemantic?.()` â€” method always exists;
             optional chain hides a missing implementation.

### lib/cache/CacheBackend.ts
--------------------------------------------------------------------------------
[x] [P9-20]  `opinions` type duplicated across multiple cache files â€” should be
             defined once and imported.

[x] [P9-21]  TTL contract undefined across backends â€” some backends treat missing
             TTL as "no expiry", others as error; no interface contract.

### lib/cache/PostgresBackend.ts
--------------------------------------------------------------------------------
[x] [P9-22]  No enforcement that vector search index (ivfflat/hnsw) exists before
             query â€” falls back to seqscan silently, order-of-magnitude slower.

[x] [P9-23]  Full-table sort performed before threshold filtering â€” should push
             similarity threshold into WHERE clause to reduce sort cost.

[x] [P9-24]  `createdAt` reset to NOW() on cache entry update â€” original creation
             time lost, breaks TTL-based expiry logic.

[x] [P9-25]  Expired rows fetched from DB then filtered in application code â€”
             should filter in SQL with `WHERE expires_at > NOW()`.

[x] [P9-26]  Silent delete failures â€” `DELETE` errors caught and swallowed with
             no log.

[x] [P9-27]  Mixed `opinions` field schema â€” stored as plain string in some rows,
             JSON object in others; no migration.

### lib/cache/RedisBackend.ts
--------------------------------------------------------------------------------
[x] [P9-28]  `ttlMs = 0` treated as "set with no TTL" â†’ unintended infinite
             persistence; should treat 0 as error or require explicit null.

[x] [P9-29]  No payload size guard â€” arbitrarily large values stored in Redis;
             can exhaust Redis memory.

[x] [P9-30]  Semantic cache methods not implemented but implicitly expected â€”
             callers assume semantic ops exist; silent no-ops.

### lib/retry.ts
--------------------------------------------------------------------------------
[x] [P9-31]  AbortError bypasses `shouldRetry` predicate â€” aborted requests retry
             anyway; correct behavior should be: never retry on abort.

[x] [P9-32]  Retry count semantics ambiguous â€” `maxRetries: 3` unclear if it
             means 3 total attempts or 3 additional retries after first.

[x] [P9-33]  No global retry budget â€” each layer (provider, strategy, router)
             retries independently; total attempts multiply.

[x] [P9-34]  Retry events not emitted to metrics system â€” no visibility into retry
             rate per provider.

[x] [P9-35]  No cancellation check during retry delay â€” AbortSignal fired during
             backoff sleep is not noticed until the next attempt begins.

### lib/redis.ts
--------------------------------------------------------------------------------
[x] [P9-36]  `flushAll()` exposed as public method without safeguards â€” can be
             called accidentally in production; should require explicit `DANGER_`
             flag or be removed.

[x] [P9-37]  Reconnect logic unstable after max retries exceeded â€” client enters
             broken state with no recovery path; process restart required.

[x] [P9-38]  EX vs PX option precedence undefined â€” when both EX and PX passed to
             SET, behavior depends on ioredis internals; document or enforce one.

[x] [P9-39]  `KEYS` command used (O(n)) â€” blocks Redis event loop on large
             keyspaces; replace with `SCAN` with cursor.

[x] [P9-40]  Single Redis client for all operations â€” high-throughput paths (rate
             limiting, cache, pub/sub) share one connection; add pooling or
             separate clients per concern.

### lib/db.ts
--------------------------------------------------------------------------------
[x] [P9-41]  No TLS/SSL enforcement on DB connection â€” connection string accepted
             without SSL requirement; credentials sent in plaintext on
             non-localhost setups.

[x] [P9-42]  No `application_name` set on connection pool â€” all connections appear
             as anonymous in pg_stat_activity; impossible to distinguish app
             traffic from migrations.

[x] [P9-43]  Verbose connection-acquire logging on every request â€” pool events
             logged at INFO level creating log noise proportional to QPS.

[x] [P9-44]  `NaN` connection limit fallback bug â€” `parseInt(env.DB_POOL_SIZE)`
             returns `NaN` if value is non-numeric; `NaN` passed to pool silently
             uses driver default.

### lib/drizzle.ts
--------------------------------------------------------------------------------
[x] [P9-45]  No lazy initialization â€” Drizzle ORM client instantiated at module
             load; DB failures during startup crash the process before Fastify
             can report health.

[x] [P9-46]  Eager schema loading causes cold-start delay and circular import risk
             â€” all table definitions imported synchronously.

[x] [P9-47]  No query logging â€” no way to capture slow queries or debug
             ORM-generated SQL without external pg_log setup.

[x] [P9-48]  ORM bypass possible via raw pool reference â€” `db.$client` exposes
             the underlying pool; bypasses all ORM-level validation and hooks.

### lib/logger.ts
--------------------------------------------------------------------------------
[x] [P9-49]  No redaction config â€” API keys, JWT tokens, passwords may appear in
             logs if included in request objects; Pino's `redact` option not
             configured.

[x] [P9-50]  No log transport â€” logs written to stdout only; no structured export
             to Loki, OTLP, or any aggregator.

[x] [P9-51]  No trace/span correlation â€” `traceId` and `spanId` not injected into
             log records; cannot correlate logs with OTEL traces.

[x] [P9-52]  No sampling â€” every request logged at full verbosity; under load this
             creates I/O pressure and cost.

[x] [P9-53]  Pino pretty-print used outside dev â€” `pino-pretty` is synchronous
             and blocks the event loop; must not be used in staging/production.

### lib/metrics.ts
--------------------------------------------------------------------------------
[x] [P9-54]  O(nÂ²) sequential similarity calls â€” archetype response similarity
             computed pairwise in a sequential loop; should be parallelized.

[x] [P9-55]  ML similarity failure crashes the request â€” no fallback if the
             embedding/similarity call throws; entire deliberation fails.

[x] [P9-56]  Weak fallback similarity â€” fallback uses token overlap which is
             unreliable for semantic comparison.

[x] [P9-57]  Consensus threshold hardcoded â€” threshold for “consensus reached” is
             a magic number in source; should be configurable.

[x] [P9-58]  Empty archetype responses treated as full consensus â€” empty string
             responses score high similarity against each other.

[x] [P9-59]  Scale mismatch â€” token-count similarity and embedding cosine
             similarity mixed without normalization in final score.

[x] [P9-60]  No caching of similarity results â€” identical pairs recomputed on
             every deliberation round.

### lib/prometheusMetrics.ts
--------------------------------------------------------------------------------
[x] [P9-61]  Poor histogram bucket sizing for long-running tasks â€” default buckets
             (0.005 to 10s) miss workflow durations of minutes; add [30, 60, 120,
             300] buckets.

[x] [P9-62]  Global Prometheus registry â€” using default global registry means test
             runs and multiple app instances share metric state; use a
             per-instance registry.

[x] [P9-63]  Gauges may never be updated â€” some gauge metrics set at startup but
             never updated by collectors; stale values mislead dashboards.

[x] [P9-64]  Missing `backend` label on cache metrics â€” cache hit/miss metrics
             don't distinguish Redis vs Postgres backend; impossible to diagnose
             which is slow.

### lib/cost.ts
--------------------------------------------------------------------------------
[x] [P9-65]  Static pricing table hardcoded in source â€” model prices change
             frequently; requires code deployment to update; externalize to config
             file or pricing service.

[x] [P9-66]  Token estimator uses static pricing, ignores actual billed tokens â€”
             estimates diverge from reality over time.

[x] [P9-67]  Cost not persisted to DB â€” computed costs exist only in-memory; lost
             on restart; no historical cost ledger.

[x] [P9-68]  `byProvider` and `byModel` aggregation fields populated but never
             read â€” dead code inflating object size.

[x] [P9-69]  Unknown model cost falls back silently to zero â€” unrecognized models
             billed at $0; usage goes unaccounted.

[x] [P9-70]  Broken efficiency metric â€” efficiency formula produces values outside
             [0,1] for some input combinations.

[x] [P9-71]  Float precision errors in cost accumulation â€” JavaScript floating
             point causes penny-level drift over many requests; use integer
             microcents.

[x] [P9-72]  Cost aggregation loses provider/model attribution â€” rolled-up totals
             discard which provider/model incurred the cost.

### lib/realtimeCost.ts
--------------------------------------------------------------------------------
[x] [P9-73]  Entirely in-memory â€” broken in any multi-replica deployment; each
             replica tracks its own users independently.

[x] [P9-74]  No daily/monthly reset â€” cost counters grow forever; no time-window
             semantics.

[x] [P9-75]  State lost on restart â€” all real-time cost data lost on process
             restart or crash.

[x] [P9-76]  Active user sessions evicted by LRU â€” users mid-session can have
             their cost counter evicted, causing under-billing.

[x] [P9-77]  Session double-count bug â€” same session counted twice if session-start
             event fires during reconnect.

[x] [P9-78]  No user-session ownership validation â€” any code can increment any
             user's cost counter by passing an arbitrary userId.

[x] [P9-79]  Memory leaks from stale callbacks and expired sessions not fully
             cleaned up.

[x] [P9-80]  Stats aggregate only current-session data â€” lifetime totals not
             tracked; impossible to compute monthly spend.

[x] [P9-81]  Cost aggregation interval runs globally with no lifecycle control â€”
             interval not cleared on app shutdown; causes test pollution.

### lib/errorMapper.ts
--------------------------------------------------------------------------------
[x] [P9-82]  Mixed `code` field semantics â€” `code` used for both HTTP status code
             and error type string in different places; consumers must guess which.

[x] [P9-83]  Misleading status mappings â€” some provider errors mapped to 403
             Forbidden or 402 Payment Required incorrectly.

[x] [P9-84]  No retry classification â€” error mapper doesn't indicate whether the
             error is retryable; callers duplicate this logic.

[x] [P9-85]  Structured error data dropped â€” provider errors often include helpful
             structured fields (retry-after, rate limit reset); mapper discards
             them.

### lib/context.ts
--------------------------------------------------------------------------------
[x] [P9-86]  Only `requestId` in AsyncLocalStorage context â€” `userId`, `traceId`,
             `tenantId` not carried; downstream code must re-fetch from request
             object.

[x] [P9-87]  No helper for context-wrapped execution â€” consumers must manually
             call `store.run()`; error-prone boilerplate.

[x] [P9-88]  Context object mutable â€” any code in the call stack can modify the
             context; side effects are invisible to callers.

### lib/history.ts
--------------------------------------------------------------------------------
[x] [P9-89]  Fake summarization via string truncation â€” “summaries” are just the
             first N characters of the last message; no semantic compression.

[x] [P9-90]  Keyword-based message retrieval â€” relevant history retrieved by
             keyword match, not semantic similarity; misses paraphrased context.

[x] [P9-91]  Full table scan for conversation history â€” no limit/offset on history
             fetch for long conversations; O(n) query.

[x] [P9-92]  Duplicate summaries accumulate â€” summary generation not idempotent;
             multiple summaries created for the same window on concurrent
             requests.

[x] [P9-93]  History window is fixed message count, not token-aware â€” 20-message
             window can be 100 or 10,000 tokens; no budget enforcement.

[x] [P9-94]  Weak keyword extraction â€” keywords extracted by splitting on spaces;
             misses stemming, stopwords, multi-word phrases.

[x] [P9-95]  Wrong role for injected summaries â€” summary injected as `user` role
             message instead of `system`; confuses model context.

[x] [P9-96]  No validation of stored JSON message structure â€” malformed messages
             stored in DB pass through without error until model call fails.

[x] [P9-97]  Potential cross-tenant history leak â€” history fetch query filters by
             conversationId only; no userId ownership check.

### lib/tracer.ts
--------------------------------------------------------------------------------
[x] [P9-98]  No span hierarchy â€” all tracing steps recorded as flat top-level
             spans; parent-child relationships lost; waterfall view impossible.

[x] [P9-99]  Blocking synchronous DB writes on request path â€” trace persistence
             happens synchronously during request; adds latency to every traced
             call.

[x] [P9-100] Langfuse client reinitialized per request â€” `new LangfuseClient()`
             called on every trace start; should be a module-level singleton.

[x] [P9-101] Silent export failure â€” if Langfuse/OTLP export fails, error is
             caught and silently dropped; no alert, no fallback.

[x] [P9-102] No per-token granularity â€” input vs output tokens not tracked
             separately in spans; only total token count recorded.

[x] [P9-103] Zero-latency default masks missing instrumentation â€” uninstrumented
             steps default to 0ms latency; dashboards appear healthy when
             instrumentation is broken.

[x] [P9-104] Unsafe type casting in span attribute assignment â€” span attributes
             cast with `as any`; type errors silently lost.

[x] [P9-105] Fake cost in traces â€” tracer computes its own cost estimate
             independent of cost.ts, using different formula; two systems
             disagree.

================================================================================
## P10 â€” DELIBERATION CORE + WORKFLOW NODES + CROSS-CUTTING
##       (adversarial.ts, archetypes.ts, configResolver.ts, controller.ts,
##        council.ts, deliberationPhases.ts, evaluation.ts, grounding.ts,
##        memoryCrons.ts, pii.ts, reasoningModes.ts, schemas.ts,
##        workflow/executor.ts, workflow/types.ts, all node handlers,
##        cross-file systemic issues)
================================================================================

### lib/adversarial.ts
--------------------------------------------------------------------------------
[x] [P10-01] Silent failure returns is_robust=true on parse error â€” when the
             adversarial LLM response cannot be parsed, the function returns
             {is_robust: true} instead of failing. Validator is bypassed
             entirely. Fail closed: parsing failure must return is_robust=false
             with an error reason.

[x] [P10-02] Greedy JSON regex extraction â€” response parsed with a regex that
             greedily matches the first {...} block; nested objects or extra
             prose causes silent data corruption. Use JSON.parse with
             try/catch after extracting the last complete JSON block.

[x] [P10-03] No shape validation of parsed output â€” parsed object accepted
             without checking required fields (is_robust, stress_score,
             reasoning). Missing fields silently become undefined downstream.
             Add Zod schema validation after parse.

[x] [P10-04] No enforced timeout â€” adversarial LLM call has no AbortSignal
             timeout; a slow provider hangs the entire deliberation round.
             Add AbortSignal.timeout(ADVERSARIAL_TIMEOUT_MS).

[x] [P10-05] Unclamped stress_score â€” score returned directly from LLM
             without clamping; values outside [0,1] (e.g., 1.5, -0.2) break
             downstream confidence math. Clamp to Math.max(0, Math.min(1, score)).

### lib/archetypes.ts
--------------------------------------------------------------------------------
[x] [P10-06] Unbounded import size â€” bulk archetype import endpoint accepts
             payloads of arbitrary size; a 10MB JSON import bloats the DB
             and causes OOM during parsing. Add max import count (e.g., 50)
             and max payload bytes.

[x] [P10-07] Full table scan for archetype usage stats â€” usage ranking query
             has no LIMIT and scans the entire audit table; expensive at
             scale. Add pagination and pre-aggregated usage counters.

[x] [P10-08] Raw DB row exported without sanitization â€” export endpoint
             returns raw Drizzle row objects including internal fields
             (createdAt, updatedAt, internal IDs). Sanitize to a public
             DTO before export.

[x] [P10-09] Ranking ignores custom archetypes â€” popularity/reliability
             ranking only considers built-in archetypes; user-defined custom
             archetypes never appear in ranked lists regardless of usage.

[x] [P10-10] ID collision via Date.now() â€” custom archetype IDs generated
             as Date.now() strings; two concurrent imports within the same
             millisecond produce identical IDs. Use UUIDs.

[x] [P10-11] Hardcoded tool allowlist per archetype â€” which tools each
             archetype can use is hardcoded in source; adding a new tool
             requires modifying every archetype definition. Externalize to
             a configurable tool registry.

[x] [P10-12] No transaction on bulk import â€” archetype import inserts rows
             one by one outside a transaction; partial failure leaves DB in
             inconsistent state with half the archetypes imported.

### lib/configResolver.ts
--------------------------------------------------------------------------------
[x] [P10-13] Ollama always injected into provider list â€” configResolver
             unconditionally adds localhost Ollama even when no Ollama is
             running; requests silently fail until circuit breaks. Make
             Ollama opt-in via explicit env flag.

[x] [P10-14] Hardcoded model names in resolver â€” resolver hardcodes specific
             model version strings (e.g., “llama3.2”) that become stale as
             providers release new versions. Externalize to config.

[x] [P10-15] Silent truncation of provider list â€” when too many providers
             are configured, resolver silently drops excess providers with
             no log. Emit a warning with the dropped provider names.

[x] [P10-16] Priority inconsistency â€” paid vs free provider priority scoring
             uses different scales in different code paths; the same provider
             can rank differently depending on which path resolves it.

[x] [P10-17] preferLocalMix flag parsed but never used â€” dead code; the
             local-mix routing strategy is never invoked. Remove or implement.

[x] [P10-18] Incomplete duplicate provider filtering â€” deduplication only
             checks provider name, not (name + model) pair; same provider
             with two different models gets deduplicated to one.

[x] [P10-19] Circular dependency: lib/configResolver â†’ services/* â€” lib
             layer imports from services layer creating a circular dependency
             risk. Invert via dependency injection or move shared logic.

### lib/controller.ts
--------------------------------------------------------------------------------
[x] [P10-20] “Discard” round not actually reverted â€” when a deliberation
             round is marked for discard, the controller logs the discard
             but does not remove the round's outputs from state. Subsequent
             synthesis uses the discarded data anyway.

[x] [P10-21] Hardcoded convergence tolerance â€” tolerance threshold for
             “consensus reached” is a magic number in source. Should be
             configurable per council config.

[x] [P10-22] Empty rounds accepted silently â€” rounds with zero archetype
             responses are accepted and advance the council state machine
             without error. Add minimum response count validation.

[x] [P10-23] Silent filtering in selectTopK â€” selectTopK drops responses
             below quality threshold without emitting any count or reason;
             callers cannot distinguish “no good responses” from
             “no responses at all”.

[x] [P10-24] Dead state: peakConsensusScore â€” field tracked and updated
             but never read by any consumer. Remove or expose via API.

### lib/council.ts
--------------------------------------------------------------------------------
[x] [P10-25] Prototype pollution guard incomplete â€” object construction
             guards against __proto__ injection but not constructor or
             prototype property key attacks. Use Object.create(null) for
             all dynamic key maps.

[x] [P10-26] Cost always 0 in council response â€” council assembles cost
             across all archetype calls but the aggregation is broken;
             final cost field always returns 0. Wire up real cost from
             router/adapter usage events.

[x] [P10-27] hallucinationCount always 0 â€” hallucination detection is
             called but its result is never aggregated into the council
             response object. The metric is always 0 regardless of actual
             detections.

[x] [P10-28] Single-member council broken â€” when council has exactly one
             archetype, minRequired logic produces NaN or 0 causing
             immediate false consensus. Add explicit single-member fast path.

[x] [P10-29] Best outputs overwritten â€” when multiple rounds produce
             responses, the council stores the latest round's output
             regardless of quality; a round with lower consensus overwrites
             a better earlier round. Preserve the best-scoring round.

[x] [P10-30] Non-integer round index â€” round numbers computed via division
             produce float values (e.g., 1.5) in edge cases; used as array
             indices this causes silent off-by-one access. Floor/ceil explicitly.

[x] [P10-31] Direct access to private controller state â€” council.ts accesses
             controller internals via property access rather than public API;
             breaks encapsulation and will silently break on controller
             refactors.

[x] [P10-32] Wrong consensus signal for skip logic â€” skip condition checks
             the wrong field (raw score instead of normalized consensus
             flag); rounds that should be skipped proceed and rounds that
             should proceed get skipped.

[x] [P10-33] Prompt mutation across calls â€” system prompt object mutated
             in-place between archetype calls; later archetypes receive
             partially-modified prompts from earlier ones. Clone before
             each mutation.

[x] [P10-34] No AbortSignal check between rounds â€” long-running councils
             don't check for cancellation between rounds; a cancelled
             request continues running for the full round duration.

### lib/deliberationPhases.ts
--------------------------------------------------------------------------------
[x] [P10-35] Fake outputs injected on JSON parse failure â€” when LLM returns
             unparseable JSON, a hardcoded fake response object is injected
             as if the call succeeded. Downstream scoring treats it as a
             real response. Fail with a retry instead.

[x] [P10-36] Schema validation bypassed â€” schema is imported and defined but
             the parse result is never passed through it before use; invalid
             shapes proceed silently.

[x] [P10-37] Validation function result ignored â€” `validateResponse()` is
             called but its return value discarded; invalid responses
             continue through the pipeline regardless.

[x] [P10-38] Peer review fallback is garbage data â€” on peer review LLM
             failure, a fake review object with empty arrays and zero scores
             is used as the fallback. Invalid peer reviews inflate quality
             scores.

[x] [P10-39] 26-agent anonymization label limit â€” anonymization logic uses
             A-Z single-letter labels; councils with more than 26 archetypes
             wrap around and agents share labels, breaking anonymization.

[x] [P10-40] Validator not independent from generator â€” the same provider/
             model used for response generation is reused for validation;
             systematic biases are not caught. Use a separate validator
             provider.

[x] [P10-41] Fake "cold validator" â€” the cold validator path that is
             supposed to use a fresh model context actually reuses a
             pre-warmed context. Label is misleading; independence not
             achieved.

[x] [P10-42] Unchecked confidence arithmetic â€” confidence values from
             multiple phases are averaged without checking they are in [0,1];
             out-of-range inputs produce out-of-range averages silently.

[x] [P10-43] Hardcoded phase timeouts â€” each deliberation phase has a
             hardcoded timeout constant in source. Should be configurable
             per deployment.

[x] [P10-44] Node.js version-dependent behavior â€” one parsing path uses
             Array.at() (Node 16.6+) without a compatibility check or
             polyfill; silently fails on older runtimes.

[x] [P10-45] Validator failure poisons output â€” when validator throws, the
             unvalidated response is still used downstream rather than
             being quarantined. Treat validator exception as validation
             failure.

[x] [P10-46] No result caching â€” identical deliberation prompts rerun all
             phases with no caching; exponential cost for repeated queries.
             Add prompt-hash-keyed cache with configurable TTL.

### lib/evaluation.ts
--------------------------------------------------------------------------------
[x] [P10-47] Length-based quality scoring â€” response quality scored
             primarily by character count; longer responses score higher
             regardless of actual content quality. Replace with semantic
             quality metrics.

[x] [P10-48] Hardcoded efficiency baselines â€” efficiency calculated against
             hardcoded token-per-second baselines that don't reflect actual
             provider performance. Externalize or measure dynamically.

[x] [P10-49] Fake diversity formula â€” diversity score computed as
             1 - average_similarity but similarity values not normalized;
             diversity scores are meaningless across different council sizes.

[x] [P10-50] Wrong percentile calculation â€” percentile rank computed with
             an off-by-one error; 50th percentile returns the median-minus-one
             element.

[x] [P10-51] userSatisfaction always 0 â€” field exists in schema but no code
             path ever sets it to a non-zero value. Either implement or
             remove from schema.

[x] [P10-52] Inconsistent scoring baselines â€” some metrics normalized to
             [0,1], others to [0,100]; mixed into the same aggregation
             without unit conversion.

[x] [P10-53] Keyword extraction broken â€” keyword extraction used for
             relevance scoring splits on whitespace only; multi-word
             keywords, punctuation-attached words, and stopwords all
             produce incorrect relevance scores.

[x] [P10-54] Single datapoint bias â€” rolling averages computed on single
             data points produce unstable values; require minimum sample
             size before emitting a metric.

[x] [P10-55] Silent DB failure â€” evaluation metrics persistence failure
             caught and silently dropped; metrics are lost without any alert.

### lib/grounding.ts
--------------------------------------------------------------------------------
[x] [P10-56] Silent success on grounding failure â€” when the grounding LLM
             call fails or returns unparseable output, is_grounded defaults
             to true. A failed grounding check should fail closed
             (is_grounded=false).

[x] [P10-57] Penalizes novel correct answers â€” grounding logic penalizes
             responses that cannot be matched to a source document, even
             if the response is factually correct but draws on the model's
             training data. Redesign to distinguish "unsupported" from
             "contradicted".

[x] [P10-58] Greedy JSON parsing â€” same greedy regex issue as adversarial.ts;
             malformed LLM JSON responses silently corrupt grounding scores.

[x] [P10-59] No result caching â€” grounding check re-runs for every archetype
             response against every source document; quadratic cost for large
             source sets. Cache by (response_hash, source_hash).

[x] [P10-60] Weak output validation â€” grounding check result accepted
             without validating required fields; missing confidence field
             silently becomes undefined.

### lib/memoryCrons.ts
--------------------------------------------------------------------------------
[x] [P10-61] No distributed locking â€” memory compaction cron runs on every
             replica simultaneously; multiple processes compact the same
             user's memory concurrently, causing data loss. Use Redis SETNX
             lock before processing.

[x] [P10-62] Unbounded query â€” cron fetches ALL users needing compaction
             in a single query; at scale this is an OOM risk. Add LIMIT
             with cursor-based pagination.

[x] [P10-63] Repeated summarization â€” no tracking of which memory windows
             have already been summarized; cron re-summarizes the same
             windows on every run, accumulating duplicate summaries.

[x] [P10-64] Hardcoded compaction thresholds â€” min messages before
             compaction, max memory age, etc. all hardcoded. Externalize
             to env/config.

[x] [P10-65] setInterval misuse â€” cron implemented with raw setInterval;
             if the job takes longer than the interval, invocations stack
             up. Use a job queue or ensure single-concurrent execution.

[x] [P10-66] No jitter on cron schedule â€” all replicas start their
             intervals at the same time; thundering-herd on DB at each
             interval tick. Add random startup jitter.

### lib/pii.ts
--------------------------------------------------------------------------------
[x] [P10-67] Poor regex accuracy â€” PII regexes match common false positives
             (e.g., version numbers as phone numbers, hex hashes as credit
             cards). High false positive rate degrades audit log usefulness.

[x] [P10-68] Overlapping patterns â€” multiple patterns match the same text;
             PII type assigned to whichever pattern matches last rather than
             most specific. Resolve overlaps explicitly.

[x] [P10-69] No algorithmic validation â€” email, credit card, and phone
             patterns match syntactically but don't validate checksum (Luhn
             for cards) or format (E.164 for phones); many false positives.

[x] [P10-70] High false positive rate degrades signal â€” false positives
             cause legitimate data to be over-redacted, breaking
             downstream audit queries. Needs precision/recall tuning.

[x] [P10-71] Weak normalization â€” detected PII not normalized before
             redaction (e.g., phone numbers with/without dashes both
             detected but redacted differently); inconsistent redaction
             format.

### lib/reasoningModes.ts
--------------------------------------------------------------------------------
[x] [P10-72] Ignores provider config, always uses "auto" â€” reasoning mode
             selector ignores the provider preference configured per council;
             all reasoning calls go through the auto router regardless of
             cost/capability requirements.

[x] [P10-73] Fragile parsing logic â€” structured reasoning output parsed with
             string splitting rather than structured JSON; any deviation in
             LLM output format silently produces empty reasoning.

[x] [P10-74] Debate mode forced even when conditions are invalid â€” debate
             reasoning mode activated for single-archetype councils where
             debate is impossible; produces garbage output silently.

[x] [P10-75] Silent truncation of reasoning output â€” long reasoning chains
             truncated without any log or indicator in the response; callers
             receive incomplete reasoning with no warning.

[x] [P10-76] No AbortSignal propagation â€” reasoning mode LLM calls don't
             propagate the upstream abort signal; cancelled requests continue
             running until natural completion.

[x] [P10-77] Confidence override bug â€” when switching between reasoning
             modes, a stale confidence value from the previous mode is
             used instead of the new mode's output confidence.

[x] [P10-78] No cost/usage tracking â€” reasoning mode LLM calls not billed
             to user quota; hidden cost accumulates outside the normal
             accounting path.

### lib/schemas.ts
--------------------------------------------------------------------------------
[x] [P10-79] Schema defined but bypassed â€” deliberationPhases.ts injects
             fake output objects that don't pass through schema validation;
             the schema exists but provides no enforcement guarantee.

[x] [P10-80] key_points min(1) violated by fallback outputs â€” fallback
             objects used on LLM failure have key_points: [] (empty array)
             which violates the .min(1) constraint, but bypass means this
             is never caught.

[x] [P10-81] No .strict() mode â€” all schemas allow extra fields silently;
             unknown fields from LLM responses pass through undetected.
             Add .strict() to catch schema drift.

[x] [P10-82] No confidence bounds refinement â€” confidence field defined
             as z.number() with no .min(0).max(1) refinement; out-of-range
             values accepted.

[x] [P10-83] No schema versioning â€” schema changes are backwards-
             incompatible with no version field; cached responses from
             prior schema versions silently fail to parse.

[x] [P10-84] No discriminated unions â€” different output types (debate,
             synthesis, validation) use the same schema shape; type-specific
             fields not enforced per variant.

### workflow/executor.ts
--------------------------------------------------------------------------------
[x] [P10-85] In-memory gate state â€” HITL gate approvals stored in a Map
             in process memory; lost on restart, broken in multi-replica.
             Persist to Redis or DB with TTL.

[x] [P10-86] LLM self-healing is RCE/SSRF vector â€” self-healing feature
             allows LLM to generate and execute "fix" code for failed nodes;
             this is arbitrary code execution via prompt injection. Disable
             or strictly sandbox with no network access.

[x] [P10-87] Broken retry logic â€” retry on node failure re-runs the node
             with the same inputs and state; for non-idempotent nodes
             (HTTP POST, DB write) this causes duplicate side effects.
             Add retry-safe node classification.

[x] [P10-88] No timeout on HITL gates â€” a workflow waiting for human
             approval blocks indefinitely with no timeout. Add configurable
             expiry; route to timeout-handler branch on expiry.

[x] [P10-89] Mutates workflow definition object â€” executor modifies the
             workflow definition in-place (adds runtime state to node
             objects); breaks re-runs and concurrent executions of the same
             workflow. Deep clone before execution.

[x] [P10-90] Skip logic flawed â€” condition for skipping a node checks
             the wrong field; nodes that should be skipped execute and
             nodes that should execute are skipped.

[x] [P10-91] Timer leaks on execution abort â€” timers set for HITL timeout
             and step delays not cleared when execution is cancelled;
             fire after cancellation and attempt to advance a dead execution.

### workflow/types.ts
--------------------------------------------------------------------------------
[x] [P10-92] No Zod schema validation for workflow definitions â€” workflow
             JSON accepted from user without runtime type validation;
             malformed workflows fail with cryptic errors deep in execution.
             Add Zod parse at ingestion time.

[x] [P10-93] Weak typing â€” several node types typed as Record<string,unknown>
             instead of discriminated unions; type narrowing not possible
             without runtime checks.

[x] [P10-94] Inconsistent userId type â€” userId typed as number in some
             workflow type definitions and string in others; causes runtime
             type errors when workflows reference user context.

[x] [P10-95] No version field â€” workflow definition has no schema version;
             old stored workflows silently break when execution engine is
             updated.

### workflow/nodes/code.handler.ts
--------------------------------------------------------------------------------
[x] [P10-96] Ignores upstream node inputs â€” code node executes its script
             without injecting upstream node outputs into the execution
             context; inter-node data flow is broken for code nodes.

[x] [P10-97] Unsafe language validation â€” language field used to select
             sandbox (JS/Python) accepted without strict whitelist; unknown
             language values cause unhandled errors.

[x] [P10-98] No output size limit â€” code node output collected into memory
             with no cap; a script that prints a large string can exhaust
             Node heap.

### workflow/nodes/http.handler.ts
--------------------------------------------------------------------------------
[x] [P10-99] SSRF via DNS rebinding in http node â€” http node validates URL
             at request time but DNS rebinding can change the resolved IP
             after validation. Pin resolved IP and use it for the actual
             fetch.

[x] [P10-100] No response size limit â€” HTTP response body streamed into
             memory with no cap; a response of arbitrary size exhausts
             worker memory.

[x] [P10-101] Unsafe redirect following â€” http node follows redirects by
             default; a redirect from a safe URL to an internal address
             bypasses SSRF protection. Set redirect: "error".

[x] [P10-102] Header injection â€” user-supplied headers not validated;
             newline characters in header values allow HTTP header injection.
             Strip or reject headers containing \r or \n.

### workflow/nodes/llm.handler.ts
--------------------------------------------------------------------------------
[x] [P10-103] Prompt injection via template interpolation â€” upstream node
             outputs interpolated directly into LLM prompt without escaping;
             a malicious node output can hijack the prompt.

[x] [P10-104] Weak variable substitution â€” template engine uses simple
             string replace; no support for escaping, conditionals, or
             missing variable handling. Missing variables silently become
             "undefined" in the prompt.

[x] [P10-105] No variable validation â€” template variables not validated
             against declared input schema before substitution; type
             mismatches produce malformed prompts.

[x] [P10-106] No LLM cost tracking â€” llm node calls not attributed to
             workflow owner's quota; cost invisible in usage reports.

### workflow/nodes/loop.handler.ts
--------------------------------------------------------------------------------
[x] [P10-107] Heavy isolate creation per iteration â€” a new isolated-vm
             isolate created for every loop iteration; at 100 iterations
             this creates 100 isolates with 100Ã— startup overhead. Reuse
             a single isolate across iterations.

[x] [P10-108] O(n²) context copying â€” loop state copied to each iteration
             context using deep clone; for large state objects and many
             iterations this is quadratic in time and memory.

[x] [P10-109] Silent iteration failures â€” if a single iteration fails, the
             loop continues without recording the failure; final output
             appears complete with missing data. Emit per-iteration error
             events.

[x] [P10-110] No global loop timeout â€” loop enforces per-iteration timeout
             but not a total loop execution budget; a loop with many short-
             but-slow iterations can run indefinitely.

### workflow/nodes/merge.handler.ts
--------------------------------------------------------------------------------
[x] [P10-111] Prototype pollution in merge â€” merge uses object spread or
             Object.assign without sanitizing keys; __proto__ or constructor
             in input data pollutes the merged object prototype.

[x] [P10-112] Non-deterministic merge on key conflict â€” when two inputs
             have the same key, last-write-wins based on iteration order
             which is not guaranteed in all JS environments. Define explicit
             precedence rules.

[x] [P10-113] Data loss on conflict â€” on key collision only one value is
             kept; no option for array-append or deep merge semantics.
             Add merge strategy configuration per node.

### workflow/nodes/split.handler.ts
--------------------------------------------------------------------------------
[x] [P10-114] Input order dependency â€” split node behavior depends on the
             order inputs arrive, which is not guaranteed in parallel
             execution. Use named inputs, not positional.

[x] [P10-115] Broken output model â€” split produces outputs that don't
             match the executor's expected output format; downstream nodes
             receive null or undefined instead of split values.

[x] [P10-116] Prototype pollution risk â€” same Object.assign without key
             sanitization as merge node.

### workflow/nodes/tool.handler.ts (additional)
--------------------------------------------------------------------------------
[x] [P10-117] Returns {error} object instead of throwing â€” on tool
             execution failure the handler returns {error: message} rather
             than throwing; executor checks for thrown exceptions and treats
             the {error} return as a successful result, propagating failure
             as success.

[x] [P10-118] No timeout on tool execution â€” tool calls have no timeout;
             a slow or hung tool blocks the workflow indefinitely.

[x] [P10-119] No output size limit on tool results â€” tool results stored
             in workflow state without size cap; large tool outputs exhaust
             state storage.

[x] [P10-120] Tool execution not sandboxed at handler level â€” tool handler
             executes tool logic without additional sandboxing beyond what
             the tool itself provides; a compromised tool can access handler
             scope.

[x] [P10-121] No audit log of tool invocations â€” tool name, inputs, and
             outputs not recorded in audit trail; impossible to reconstruct
             what a workflow did in a security incident.

### workflow/nodes/template.handler.ts
--------------------------------------------------------------------------------
[x] [P10-122] No conditionals, loops, or filters â€” template engine is
             basic string interpolation only; complex templates require
             workarounds via LLM nodes. Replace with Handlebars or Liquid.

[x] [P10-123] Cannot escape special characters â€” no escape mechanism for
             template delimiters; data containing {{ }} breaks rendering
             silently.

[x] [P10-124] No validation for malformed templates â€” templates with
             unclosed tags, invalid syntax, or missing variable declarations
             fail at render time with cryptic errors rather than at
             definition time.

### Cross-cutting: Deliberation System
--------------------------------------------------------------------------------
[x] [P10-125] Same LLM for generation, validation, and adversarial â€” no
             independence between roles; systematic model bias appears as
             valid responses, passes validation, and survives adversarial
             testing. Use different providers for each role.

[x] [P10-126] Failure modes inflate scores â€” adversarial parse failure
             â†’ is_robust=true; grounding failure â†’ is_grounded=true;
             systematic failures make council appear more reliable, not less.

[x] [P10-127] No cost tracking across full deliberation pipeline â€” total
             cost of a deliberation (all phases, all archetypes, all
             validators) never aggregated; impossible to enforce per-query
             cost limits.

[x] [P10-128] No prompt-level caching across phases â€” identical sub-prompts
             regenerated at each phase; no deduplication. Exponential token
             cost for large councils.

[x] [P10-129] Prompt mutation across phases â€” prompt objects shared by
             reference across phases and mutated in-place; phase N modifies
             the prompt that phase N+1 reads, causing unpredictable behavior.

[x] [P10-130] No deterministic reproducibility â€” no seed or determinism
             config; same inputs produce different outputs on every run;
             impossible to reproduce reported bugs.

### Cross-cutting: Workflow Engine
--------------------------------------------------------------------------------
[x] [P10-131] Entire system assumes single process â€” gate state, execution
             context, and timer state all in-process; horizontal scaling
             is impossible without re-architecting persistence.

[x] [P10-132] No execution state persistence â€” workflow execution state
             not written to DB/Redis during execution; a mid-run crash
             loses all progress with no recovery path.

[x] [P10-133] Unsafe node composition chain â€” LLM node can call HTTP node
             which can call Code node; a prompt injection in LLM output
             becomes an SSRF or RCE in the downstream node. Add inter-node
             data sanitization.

[x] [P10-134] No global execution budget â€” workflows have no time or cost
             ceiling; a runaway workflow can consume unbounded resources.
             Add per-workflow max_duration_ms and max_cost_usd limits.

[x] [P10-135] No DAG validation beyond cycle detection â€” missing: unreachable
             node detection, disconnected subgraph detection, invalid edge
             type validation (e.g., split output connected to wrong node type).

### Cross-cutting: Security
--------------------------------------------------------------------------------
[x] [P10-136] Multiple injection surfaces not centrally defended â€” prompt
             injection, template injection, and tool input override each
             defended ad-hoc; a central input sanitization layer is absent.

[x] [P10-137] SSRF TOCTOU still exploitable via redirect chains â€” SSRF
             validation happens at URL resolution time but redirects can
             chain to internal addresses after validation. Block redirects
             at the fetch level across all HTTP-making nodes.

[x] [P10-138] Prototype pollution in merge/split propagates through state â€”
             polluted state object passed to downstream nodes; all nodes
             in a workflow share the pollution.

[x] [P10-139] Sandbox escape via chained node execution â€” isolated-vm
             sandbox can be escaped by crafting output that is interpreted
             as code by a downstream LLM or template node. Add output
             sanitization between sandbox and LLM nodes.

### Missing Execution Guarantees
--------------------------------------------------------------------------------
[x] [P10-140] No idempotency keys â€” workflow executions have no idempotency
             key; duplicate submissions (network retry, user double-click)
             create duplicate executions. Add idempotency key validation
             at submission time.

[x] [P10-141] No retry safety classification â€” nodes not classified as
             idempotent vs non-idempotent; all nodes retried on failure
             regardless of side effects (HTTP POST, DB write, email send).

[x] [P10-142] No exactly-once execution guarantee â€” without distributed
             locking and idempotency, nodes may execute more than once
             on failure recovery.

[x] [P10-143] No partial failure recovery â€” if a workflow fails at node N,
             there is no way to resume from node N; must re-run from
             the beginning losing all prior node outputs.

[x] [P10-144] No observability correlation â€” workflow execution ID not
             propagated to logs, traces, and metrics; impossible to
             correlate a failed workflow execution with its spans and
             cost records.

================================================================================
## P11 â€” TEST SUITE GAPS (pt6/pt7/pt8 deep re-extraction)
##       Adapter tests, E2E specs, middleware tests, service tests
##       (items not already captured in P6 or P8)
================================================================================

### Global Adapter Test Issues (across all adapter test files)
--------------------------------------------------------------------------------
[x] [P11-01] Tool-call JSON parse failures silently swallowed in tests â€”
             no test verifies that malformed tool-call JSON from the provider
             causes a logged error; failures are invisible. Add negative tests
             asserting error is emitted on malformed tool JSON.

[x] [P11-02] Cost/billing tracking entirely mocked â€” no test verifies that
             token counts and costs are correctly accumulated from real stream
             chunks; billing correctness is completely untested. Add tests
             with known token counts and assert accumulated cost.

[x] [P11-03] Secret/decrypt path never tested â€” `decryptApiKey()` is mocked
             in every test; real decryption failures, wrong-key errors, and
             corrupted ciphertext never exercised. Add tests for decrypt
             success and failure paths.

[x] [P11-04] OpenAI-compatible adapter hides capability loss â€” tests treat
             all providers as OpenAI-compatible; provider-specific features
             (citations, safety ratings, function-call formats) never tested.
             Add per-provider capability test matrix.

### anthropic.test.ts
--------------------------------------------------------------------------------
[x] [P11-05] Wrong SSE format in test fixtures â€” test SSE fixtures use
             single `\n` separators instead of `\n\n`; real Anthropic stream
             uses `\n\n`. Tests pass against wrong format and will not catch
             parser regressions.

[x] [P11-06] Weak API key format validation â€” test only checks key is
             non-empty; does not verify `sk-ant-` prefix or minimum length.
             A misconfigured key passes validation silently.

[x] [P11-07] Malformed tool JSON silently accepted â€” test for tool-call
             response with invalid JSON in `arguments` field does not assert
             that an error is thrown or logged; malformed input passes through.

[x] [P11-08] No error SSE event tests â€” no test for SSE stream that
             contains an `event: error` message mid-stream; error handling
             in the parser is untested.

[x] [P11-09] Hardcoded model list assertions â€” tests assert against a
             fixed model list; adding or removing a model breaks tests for
             the wrong reason. Use snapshot or schema-based assertion.

### custom.test.ts
--------------------------------------------------------------------------------
[x] [P11-10] Decrypt mocked â€” real secret validation never tested â€” all
             `decryptApiKey` calls mocked to return a fixed string; corrupt
             keys, wrong master key, and re-encrypted values never tested.

[x] [P11-11] No malformed auth config tests â€” tests don't cover: missing
             auth header config, both bearer and basic auth set simultaneously,
             auth config with empty credentials.

[x] [P11-12] No base URL validation tests â€” custom adapter accepts arbitrary
             base URLs; tests don't verify that `file://`, `gopher://`, or
             internal IP URLs are rejected.

[x] [P11-13] No streaming format mismatch test â€” when a custom endpoint
             returns non-SSE content-type for a streaming request, behavior
             is untested; likely silent hang or parse error.

[x] [P11-14] Usage normalization fragile and untested â€” different custom
             endpoints return usage in different field names (tokens_used vs
             usage.total_tokens); normalization logic has no dedicated tests.

[x] [P11-15] providerId not sanitized in tests â€” tests pass arbitrary strings
             as providerId without verifying sanitization; SQL/log injection
             via providerId untested.

[x] [P11-16] Tool-call capability untested for custom adapters â€” no test
             verifies that tool definitions are forwarded to custom endpoints
             or that tool-call responses are parsed correctly.

### gemini.test.ts
--------------------------------------------------------------------------------
[x] [P11-17] image_urlâ†’text degradation not tested as failure â€” test accepts
             silent image-to-text conversion; should assert that image content
             is preserved as image type, not downgraded.

[x] [P11-18] SSE-only streaming assumption â€” test only covers SSE streaming;
             Gemini also supports server-sent JSON (non-SSE) format which is
             untested and likely broken.

[x] [P11-19] Tool role fallback not tested â€” when Gemini returns a tool call
             with an unexpected role field, fallback behavior is untested;
             likely maps to wrong role silently.

[x] [P11-20] No temperature/parameter clamping test â€” Gemini has strict
             bounds on temperature (0â€“1) and top_p; no test verifies
             out-of-range values are clamped or rejected.

[x] [P11-21] No safety rating or finishReason tests â€” Gemini responses
             include safety ratings and finish_reason (STOP, SAFETY, etc.)
             that affect downstream behavior; none tested.

### groq.test.ts
--------------------------------------------------------------------------------
[x] [P11-22] No Groq-specific feature tests â€” test is a copy of OpenAI test
             with provider name swapped; Groq-specific behaviors (speed SLA,
             model availability, 429 format) never tested.

[x] [P11-23] No 429 rate-limit retry test â€” Groq has aggressive rate limits;
             no test verifies that a 429 response triggers correct retry with
             backoff.

[x] [P11-24] Weak schema validation in tests â€” response schema assertions
             use loose checks (`toBeDefined()` instead of exact shape);
             structural regressions pass undetected.

### ollama.test.ts
--------------------------------------------------------------------------------
[x] [P11-25] SSRF localhost bypass tested as valid â€” test explicitly passes
             `http://localhost:11434` and asserts it succeeds; this should
             be a negative test asserting rejection, not acceptance.

[x] [P11-26] Tool role mapped to "user" â€” test accepts tool-call response
             with role "user" when it should be "tool"; semantic corruption
             silently accepted.

[x] [P11-27] No auth header tests â€” Ollama supports Bearer token auth for
             protected instances; no test covers authenticated Ollama requests.

[x] [P11-28] NDJSON fragmentation not tested â€” Ollama streams NDJSON
             (one JSON object per line); tests use complete single-line
             responses; split-line responses (partial JSON across chunks)
             never tested.

[x] [P11-29] Tool call support missing in tests â€” Ollama supports tool
             calls since v0.3; no test verifies tool definitions are sent
             or responses parsed.

### openai.test.ts
--------------------------------------------------------------------------------
[x] [P11-30] Tool-call parse errors hidden in tests â€” test for malformed
             `arguments` JSON in tool call does not assert that error is
             propagated; silently discards parse failure.

[x] [P11-31] Unknown content block coerced to text â€” test accepts silent
             coercion of unrecognized content block types to text strings;
             should assert unsupported types throw or are skipped explicitly.

[x] [P11-32] Cost accumulation not tested end-to-end â€” usage fields from
             stream chunks are mocked; no test accumulates usage from a
             multi-chunk stream and asserts final cost.

[x] [P11-33] No function-call-only response test â€” responses containing
             only tool calls (no text content) not tested; likely fails or
             returns empty string.

[x] [P11-34] Provider ID ambiguity â€” test uses "openai" and "openai-compat"
             interchangeably; no test verifies routing behavior differs
             between them.

[x] [P11-35] No reasoning/thinking token tracking test â€” o1/o3 models
             return reasoning_tokens in usage; no test verifies these are
             tracked separately.

### openrouter.test.ts
--------------------------------------------------------------------------------
[x] [P11-36] Multimodal content lost in tests â€” test passes image_url in
             message content and does not assert it reaches the API; likely
             JSON.stringify flattens it silently.

[x] [P11-37] Double JSON stringify risk untested â€” tool arguments already
             serialized as JSON string, then stringified again by the adapter;
             no test detects double-encoding.

[x] [P11-38] Weak error response parsing â€” OpenRouter error format differs
             from OpenAI; test uses OpenAI error structure and doesn't cover
             OpenRouter-specific error shapes.

### perplexity.test.ts
--------------------------------------------------------------------------------
[x] [P11-39] Citations field dropped and untested â€” Perplexity returns a
             `citations` array in responses; no test verifies it is preserved
             or surfaced to callers.

[x] [P11-40] Search parameters not forwarded â€” Perplexity-specific params
             (search_domain_filter, search_recency_filter) not tested.

[x] [P11-41] Tools incorrectly enabled â€” test doesn't assert that tool
             definitions are rejected (Perplexity doesn't support function
             calling); sending tools causes API error in production.

### registry.test.ts
--------------------------------------------------------------------------------
[x] [P11-42] Empty API keys accepted by registry â€” registry test does not
             verify that registering an adapter with an empty or whitespace
             API key is rejected.

[x] [P11-43] No OpenRouter prefix routing test â€” OpenRouter uses model
             names with provider prefixes (e.g., "anthropic/claude-3");
             no test verifies prefix-aware routing works correctly.

[x] [P11-44] Global mutable singleton not isolated between tests â€” registry
             is a module-level singleton; tests that register adapters pollute
             state for subsequent tests. No reset/isolation between tests.

[x] [P11-45] No concurrency safety test â€” no test verifies that concurrent
             adapter registration and lookup don't produce race conditions.

### Global E2E Issues (pt7)
--------------------------------------------------------------------------------
[x] [P11-46] Conditional UI flows mean tests may execute zero assertions â€”
             `if (await element.isVisible())` pattern means tests silently
             pass when UI elements don't exist; zero assertions = vacuously
             passing test.

[x] [P11-47] Weak CSS selectors cause false positives â€” tests use generic
             selectors (e.g., `button`, `.submit`) that match multiple
             elements; clicks/assertions land on wrong elements silently.

[x] [P11-48] No backend state validation in E2E tests â€” E2E tests assert
             UI state only; no test queries the DB or API to verify backend
             state matches what the UI shows.

[x] [P11-49] Real LLM calls in E2E tests â€” deliberation E2E tests make
             real LLM API calls; tests are slow, flaky on rate limits, and
             incur cost. Mock LLM at the network level.

### auth.spec.ts (additional E2E gaps)
--------------------------------------------------------------------------------
[x] [P11-50] Conditional logout may skip entire test â€” logout flow wrapped
             in `if (isLoggedIn)` check; if auth state is unexpected, entire
             logout test body is silently skipped.

[x] [P11-51] Conditional clicks throughout â€” most interactions use
             `if (await btn.isVisible()) btn.click()` pattern; test passes
             whether or not the button was actually clicked.

[x] [P11-52] DB pollution via Date.now() usernames â€” test users created
             with `user_${Date.now()}` names accumulate in the DB across
             runs; no cleanup causes eventual unique constraint violations.

[x] [P11-53] No assertion on real error message text â€” error cases assert
             that "some error" is visible but not the specific message;
             wrong error messages pass the test.

[x] [P11-54] No backend DB verification after auth actions â€” after login,
             logout, and registration, no test checks the DB to verify
             sessions were created/destroyed correctly.

### deliberation.spec.ts
--------------------------------------------------------------------------------
[x] [P11-55] Hardcoded credentials in E2E test â€” test uses hardcoded
             username/password strings in source; if credentials change,
             test fails silently or exposes credentials in logs.

[x] [P11-56] No validation of deliberation output â€” test asserts that
             "some response appeared" but doesn't validate response
             structure, archetype attribution, or confidence scores.

[x] [P11-57] Real LLM dependency makes test non-deterministic â€” outputs
             vary per run; flaky assertions based on response content.

[x] [P11-58] Weak streaming selectors â€” streaming text validated by checking
             if a container is non-empty; partial renders and empty error
             states both pass.

### marketplace.spec.ts
--------------------------------------------------------------------------------
[x] [P11-59] Test is entirely conditional â€” entire test body inside
             `if (items.length > 0)` check; when marketplace is empty (e.g.,
             fresh DB), zero assertions run and test passes vacuously.

[x] [P11-60] No data assertions â€” test checks that items render but doesn't
             assert item count, correct titles, prices, or author attribution.

### workflow.spec.ts (additional)
--------------------------------------------------------------------------------
[x] [P11-61] No workflow save/persist verification â€” test creates a workflow
             and navigates away; no assertion that workflow appears in the
             list or is persisted to the DB.

[x] [P11-62] No workflow execution test â€” test validates workflow creation
             UI but never triggers execution; execution engine path entirely
             untested by E2E suite.

### Middleware Test Gaps (from pt7)
--------------------------------------------------------------------------------
[x] [P11-63] JWT fully mocked â€” no real auth path tested â€” middleware tests
             mock `jwt.verify()` to return a fixed payload; real JWT
             signature verification, expiry, and claim validation never
             exercised.

[x] [P11-64] Redis and DB fully mocked in middleware tests â€” no integration
             test verifies that rate limiting, session revocation, or quota
             checks work against real Redis/DB state.

[x] [P11-65] CSP nonce is a constant in tests â€” nonce middleware tested
             with a fixed string; no test verifies that a new random nonce
             is generated per request, or that entropy is sufficient.

[x] [P11-66] Error handler tested with fake error objects â€” error handler
             tests pass plain objects `{message: "..."}` instead of real
             Error instances; `instanceof Error` checks and stack traces
             never tested.

### Global Service Test Issues (pt8)
--------------------------------------------------------------------------------
[x] [P11-67] Service logic not actually tested â€” heavy mock usage means
             tests verify that mocks were called, not that business logic
             is correct. Add at least one real-path integration test per
             service.

[x] [P11-68] No large-scale / performance tests â€” no service test exercises
             inputs of realistic production size (large documents, many users,
             long conversations); performance regressions invisible.

[x] [P11-69] No concurrency tests across services â€” no test exercises two
             concurrent operations on the same resource (same user, same
             conversation, same workflow); race conditions untested.

[x] [P11-70] No failure cascade tests â€” no test verifies behavior when a
             downstream dependency (DB, Redis, LLM) fails mid-operation;
             partial failure behavior completely untested.

### agentSpecialization.test.ts
--------------------------------------------------------------------------------
[x] [P11-71] Keyword-based domain detection not stress-tested â€” tests use
             single clean keywords; ambiguous inputs, multi-domain inputs,
             and contradictory signals not covered.

[x] [P11-72] No multi-domain classification test â€” test only covers
             single-domain inputs; inputs spanning multiple domains (e.g.,
             "medical billing software") not tested.

[x] [P11-73] DB mock returns only expected shape â€” mock always returns
             a well-formed archetype; DB returning null, partial data, or
             archived archetype never tested.

### artifacts.test.ts
--------------------------------------------------------------------------------
[x] [P11-74] Boundary conditions for detection thresholds untested â€”
             tests use inputs clearly above or below threshold; values at
             exactly the boundary (e.g., exactly 500 chars) not tested.

[x] [P11-75] Weak HTML artifact detection â€” HTML detection tested only
             with `<div>` tags; SVG, template literals containing HTML,
             and partial HTML not tested.

[x] [P11-76] No DB write failure tests â€” artifact persistence tested only
             on success path; DB constraint violations and connection errors
             not covered.

[x] [P11-77] JSON artifact validity not checked â€” test asserts artifact type
             is "json" but never calls `JSON.parse()` on the stored content
             to verify it's actually valid JSON.

### artifactStreaming.test.ts
--------------------------------------------------------------------------------
[x] [P11-78] No stream timeout test â€” no test verifies that a stream that
             never completes (producer hangs) times out and releases
             resources; timeout path untested.

[x] [P11-79] No multi-subscriber concurrency test â€” no test subscribes
             multiple consumers to the same artifact stream; race conditions
             in fan-out logic untested.

[x] [P11-80] Cleanup verification is a no-op â€” test calls cleanup() and
             asserts no error thrown; doesn't verify that the stream is
             actually removed from memory or that subsequent reads fail.

[x] [P11-81] No backpressure test â€” no test verifies behavior when a
             subscriber is slow to consume; unbounded buffer growth not
             detected.

### audioVideo.test.ts (additional)
--------------------------------------------------------------------------------
[x] [P11-82] Weak output assertions â€” success path (if added) should assert
             transcription text is non-empty, language detected, timestamps
             present; current assertions only check status code.

[x] [P11-83] No large media input tests â€” no test with a file near or at
             the size limit; OOM and timeout behavior on large inputs
             untested.

### backgroundAgents.test.ts (additional)
--------------------------------------------------------------------------------
[x] [P11-84] No pause/resume lifecycle test â€” no test verifies that a
             running agent can be paused, its state preserved, and execution
             resumed correctly from the same point.

[x] [P11-85] Cleanup verification weak â€” `stopAgent()` asserts no error
             but doesn't verify the agent is actually removed from memory or
             that its resources (timers, DB connections) are released.

### chunker.test.ts
--------------------------------------------------------------------------------
[x] [P11-86] No Unicode/multi-byte character tests â€” chunker tested only
             with ASCII; multi-byte UTF-8 (CJK, emoji, RTL text) may produce
             incorrect chunk boundaries.

[x] [P11-87] Code block handling untested â€” chunker may split code blocks
             at arbitrary positions; no test verifies code blocks are kept
             intact or split at logical boundaries.

[x] [P11-88] Chunk overlap correctness not precisely validated â€” test
             asserts overlap "exists" but doesn't verify the exact overlapping
             tokens match the end of the previous chunk.

### conversationService.test.ts
--------------------------------------------------------------------------------
[x] [P11-89] No user isolation / access control test â€” no test verifies
             that user A cannot read or modify user B's conversation; IDOR
             risk untested.

[x] [P11-90] Orphaned test block â€” one `it()` block is defined outside any
             `describe()` scope; may not run in all test configurations.

[x] [P11-91] Weak semantic threshold validation â€” test asserts a semantic
             similarity score is "high" but uses arbitrary threshold; same
             assertion passes with very different model quality.

### councilService.test.ts
--------------------------------------------------------------------------------
[ ] [P11-92] Unsafe env mutation in tests â€” tests set `process.env.*`
             directly without restoring after test; pollutes environment for
             subsequent tests in the same process.

[ ] [P11-93] Wrong key mapping assumption â€” test assumes council config
             keys follow a specific naming convention that may not hold
             for custom providers; brittle.

[ ] [P11-94] Missing function coverage â€” several councilService methods
             have no corresponding tests (e.g., updateConfig, deleteCouncil,
             listArchetypes).

### embeddings.test.ts
--------------------------------------------------------------------------------
[ ] [P11-95] No performance regression test â€” embedding generation time
             not measured; a 10Ã— slowdown from a dependency upgrade would
             not be caught.

[ ] [P11-96] Batch embedding inefficiency untested â€” test sends items
             one-by-one; no test verifies that batch embedding actually
             reduces API calls vs individual requests.

### goalDecomposition.test.ts
--------------------------------------------------------------------------------
[ ] [P11-97] LLM output parsing fragile and untested for variations â€”
             test uses a single well-formed LLM response; malformed JSON,
             missing required fields, and extra unknown fields not tested.

[ ] [P11-98] No large DAG test â€” goal decomposition with many sub-goals
             (20+) not tested; cycle detection and performance at scale
             untested.

### imageAware.test.ts
--------------------------------------------------------------------------------
[ ] [P11-99] Filename-based image detection only â€” test verifies image
             detection by filename extension (.jpg, .png); no test inspects
             actual byte content (magic bytes) to confirm format.

[ ] [P11-100] No base64 validation â€” test passes base64 image strings
              without verifying the decode is valid; truncated or corrupted
              base64 silently accepted.

### ingestion.test.ts
--------------------------------------------------------------------------------
[ ] [P11-101] Timer masking hides async errors â€” fake timers advance clock
              before error can propagate; error is swallowed and test passes
              when it should fail.

[ ] [P11-102] Error swallowing in ingestion pipeline â€” test for failed
              ingestion doesn't verify the error is surfaced to the caller;
              silent swallow makes pipeline appear healthy on failure.

### livePresence.test.ts
--------------------------------------------------------------------------------
[ ] [P11-103] No real WebSocket protocol tests â€” presence tests use mocked
              WS connections; actual WebSocket handshake, ping/pong, and
              reconnect behavior never tested.

================================================================================
END OF MASTER TASK LIST
Total: 700 tasks
  P0 Critical:               46
  P1 High:                   42
  P2 Architectural:          30
  P3 Correctness Bugs:       28
  P4 Missing Features:       50
  P5 Tech Debt:              19
  P6 Test Suite Gaps (orig): 16
  P7 Deep Extraction:        47
  P8 Batch 5-6:             66
  P9 Core Lib (Batch 7):    105
  P10 Deliberation+Workflow: 149
  P11 Test Suite Deep:       103
================================================================================
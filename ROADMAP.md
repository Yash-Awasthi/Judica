<div align="center">

# AIBYAI Roadmap

### Future Plan

[![Now](https://img.shields.io/badge/Now-Production_Hardening-3B82F6?style=for-the-badge)](#phase-1-production-hardening-q2-2026)
[![Next](https://img.shields.io/badge/Next-Intelligence-8B5CF6?style=for-the-badge)](#phase-2-intelligence-layer-q3-2026)
[![Then](https://img.shields.io/badge/Then-Autonomy-F59E0B?style=for-the-badge)](#phase-3-autonomous-operations-q4-2026)
[![Scale](https://img.shields.io/badge/2027-Platform_%26_Enterprise-22C55E?style=for-the-badge)](#phase-4-platform--ecosystem-q1-2027)

</div>

---

## Phase 1: Production Hardening (Q2 2026)

> **Status: In Progress** — Security remediation complete. Testing, performance, and observability remain.

### Remaining Work

**Testing**
- E2E tests with Playwright — 5 critical user flows (signup → deliberation → KB upload → workflow → marketplace)
- Rewrite route-level integration tests to use `fastify.inject()` against the real app instead of local mocks
- Expand statement coverage from current baseline to 80%+ across all services
- Contract tests for SSE streaming format (verify event shapes for all deliberation stages)
- Load testing with autocannon: target 200 concurrent deliberations, < 2s p95 latency

**Performance**
- PostgreSQL connection pooling via `pg-pool` (currently one connection per request)
- Frontend bundle splitting — lazy load Workflow Editor, Marketplace, Analytics views
- CDN configuration for static assets (Vite build output)
- Redis pipeline batching for rate limit checks (currently one round-trip per check)
- Debounce ECharts re-renders on window resize

**Observability**
- Grafana alert rules: error rate > 5%, p99 latency > 5s, queue backlog > 100, provider failure rate > 20%
- Structured error tracking with correlation IDs across request lifecycle
- Provider health dashboard — per-provider availability, latency distribution, cost per 1K tokens
- Dead letter queue monitoring panel in Grafana

**Known Limitations**
- Python code sandbox uses process-level isolation (ulimit + socket monkey-patching) only. Kernel-level namespace isolation (nsjail, bubblewrap, or container-per-execution) is needed for untrusted code in production.
- User settings (autoCouncil, debateRound, coldValidator, piiDetection) are stored client-side in localStorage only. Backend persistence requires a new endpoint and DB table.

---

## Phase 2: Intelligence Layer (Q3 2026)

> Building the brain that learns.

### Agentic Memory v2

The current 3-layer memory (active context → session summary → long-term vector) works per-conversation but has no cross-session intelligence.

- **Cross-conversation topic linking** — When a user discusses "React performance" in one session and "frontend optimization" in another, the system connects them via embedding similarity and builds a topic graph
- **Preference adaptation** — Track which archetypes produce responses the user engages with most. Auto-tune council composition: if a user consistently favors the Empiricist over the Strategist, weight accordingly
- **Temporal decay** — Memories lose relevance over time using exponential decay. Frequently accessed memories refresh their TTL. One-off facts fade within 30 days unless reinforced
- **Contradiction resolution** — When new information contradicts stored memory, create a versioned resolution record with both perspectives rather than silent overwrite. Surface contradictions to the user when relevant

### Advanced RAG Pipeline

- **Cohere reranking** — Integrate `rerank-english-v3.0` as a post-retrieval step for hybrid search. RRF handles initial fusion; Cohere reranks the top-50 for the final context window
- **Parent-child chunking** — Store documents as hierarchical chunks. When a child chunk matches, inject the parent chunk into context for better coherence
- **HyDE (Hypothetical Document Embeddings)** — Generate a hypothetical answer to the query, embed it, and use that embedding for retrieval. Dramatically improves recall for abstract questions
- **Multi-index federated search** — Single query searches across knowledge bases, indexed repos, and conversation history simultaneously. Results merged with source-type weighting
- **Adaptive k selection** — Estimate query complexity (simple factual vs. multi-faceted analytical) and dynamically choose retrieval depth (k=3 for simple, k=20 for complex)

### Agent Specialization

- **Domain-specific reasoning profiles** — Pre-configured archetypes for legal (precedent analysis, statutory interpretation), medical (differential diagnosis, evidence grading), financial (risk modeling, regulatory compliance), and engineering (architecture review, failure mode analysis)
- **Self-improving personas** — Each agent tracks its agreement rate with the final consensus. Agents that consistently diverge from accepted verdicts get automatic reasoning prompt adjustments
- **Dynamic delegation** — Agents can spawn sub-agents for specialized tasks during deliberation. A Strategist can delegate a financial calculation to a Finance specialist mid-debate
- **Confidence calibration** — Train agents to produce well-calibrated confidence scores by comparing historical confidence vs. actual accuracy. Overconfident agents get penalized in synthesis weighting

---

## Phase 3: Autonomous Operations (Q4 2026)

> From answering questions to completing missions.

### Autonomous Agent Mode

- **Goal decomposition engine** — User provides a high-level objective ("Analyze our competitor's pricing strategy and recommend adjustments"). A planning agent breaks this into a directed acyclic graph of subtasks: research competitor pricing → analyze our cost structure → model margin impact → draft recommendation
- **Tool chains** — Agents autonomously sequence tools: web search → data extraction → spreadsheet analysis → chart generation → report writing. No human intervention between steps
- **Long-running background agents** — Tasks that run for hours. Research agents that scrape 50+ sources, code agents that refactor entire modules, analysis agents that process GB-scale datasets. Progress checkpoints stored in Redis
- **Human-in-the-loop gates** — Configurable approval points before irreversible actions (sending emails, making API calls, publishing content). Agents pause and notify via WebSocket, resume on approval
- **Intermediate artifact streaming** — Real-time SSE updates with partial results: draft outlines, preliminary findings, work-in-progress code. Users see progress, not just final output

### Code Generation & Review

- **Full-stack scaffolding** — Describe an app in natural language. Council generates project structure, React components, API routes, database schema, and deployment config. Multi-agent review catches issues before output
- **PR review agent** — Three-perspective automated code review: Security agent (OWASP top 10, injection risks), Performance agent (N+1 queries, memory leaks, bundle size), Style agent (consistency, naming, patterns)
- **Test generation** — Given a function or module, generate comprehensive test suites. Council debates edge cases: "What if the input is null? What if the array is empty? What about Unicode?" Each agent suggests different failure modes
- **Refactoring assistant** — Council analyzes a codebase module and proposes refactoring with full before/after diffs. Debate identifies which changes are safe and which need integration tests first

### Multi-Modal Council

- **Image-aware agents** — Council members can analyze uploaded images, screenshots, charts, and diagrams as part of deliberation. "Is this architecture diagram consistent with the code?" becomes answerable
- **Audio/video input** — Transcribe audio, extract video keyframes, and feed them into council context. Meeting recordings become council input for action item extraction
- **Visual output generation** — Agents produce Mermaid diagrams, data visualizations, and annotated screenshots as part of their responses. Not just text verdicts — visual evidence
- **Cross-modal reasoning** — "The chart shows declining revenue but the text report says growth is strong" — agents detect contradictions across modalities

---

## Phase 4: Platform & Ecosystem (Q1 2027)

> From product to platform.

### MCP Integration (Model Context Protocol)

- **Server mode** — Expose AIBYAI's deliberation engine as an MCP tool. Any MCP-compatible agent (Cursor, Claude Desktop, custom) can invoke a council deliberation as a tool call
- **Client mode** — AIBYAI agents can call external MCP servers during deliberation. Database queries, file system access, API calls — all via MCP protocol
- **Tool federation** — Browse the MCP ecosystem's tool directory. One-click install of MCP tools into AIBYAI workflows. Community-contributed tool packs

### Plugin SDK

- **Custom tool packages** — NPM packages that register tools in the tool registry. `npm install aibyai-plugin-jira` and Jira becomes available as a tool in workflows and deliberations
- **Custom workflow nodes** — Third-party node types with React UI components and server-side handlers. A "Slack Notify" node, a "GitHub Issue" node, a "Stripe Charge" node
- **Webhook triggers** — Fire webhooks on deliberation events: verdict reached, conflict detected, confidence below threshold, long-running task completed
- **Middleware hooks** — Intercept the deliberation pipeline at any stage. Pre-process queries (PII redaction, language detection), post-process verdicts (formatting, compliance checks), custom scoring functions

### Real-time Collaboration

- **Multi-user deliberation** — 2–10 users join a shared council session. Everyone sees the same debate, same streaming responses
- **Live presence** — See who's viewing, who's typing, cursor positions in shared workflow editor
- **User annotations** — Highlight and comment on specific parts of agent responses. "This claim needs a source" or "This contradicts our Q3 data"
- **Synthesis voting** — When agents disagree, users vote on which direction the synthesis should favor. Democratic consensus layered on top of AI consensus

---

## Phase 5: Scale & Enterprise (Q2 2027)

> From startup to platform company.

### Infrastructure

- **Kubernetes deployment** — Helm charts with horizontal pod autoscaling based on queue depth, request latency, and active WebSocket connections
- **Multi-region** — PostgreSQL primary in US-East with read replicas in EU-West and AP-South. Redis Cluster spanning regions. Health-based routing fails over automatically
- **Cost optimization** — Spot instances for batch processing (research jobs, embedding generation). Reserved capacity for real-time deliberation. Per-tenant cost tracking and billing

### Enterprise Features

- **SSO** — SAML 2.0 and OpenID Connect for enterprise identity providers (Okta, Azure AD, Google Workspace)
- **Workspace isolation** — Complete data separation per tenant. Separate databases, separate Redis namespaces, separate encryption keys. No data leakage possible between tenants
- **Per-tenant quotas** — Token limits, storage caps, concurrent deliberation limits, API rate limits. Configurable by plan tier, enforceable in real-time
- **Audit compliance** — SOC 2 Type II logging format. Every deliberation, every API call, every data access logged with immutable audit trail. GDPR data export and right-to-deletion support
- **Data residency** — Pin tenant data to specific geographic regions. EU customers' data never leaves EU infrastructure
- **SLA monitoring** — 99.9% uptime target with automated alerting. Latency SLOs per endpoint. Incident response runbooks

### Marketplace v2

- **Revenue sharing** — Creators set prices for premium marketplace items. AIBYAI takes 20% platform fee. Monthly payouts via Stripe Connect
- **Verified publishers** — Application process, code review, trust badges. Verified items get priority placement and higher visibility
- **Usage analytics** — Creators see installs, daily active usage, retention curves, rating trends. Data-driven iteration on marketplace items
- **Collections** — Curated bundles: "Legal Practice Pack" (5 personas + 3 workflows + 10 prompts), "Code Review Kit", "Research Assistant Suite"
- **Dependency resolution** — Marketplace items can declare dependencies. Installing a workflow that needs a custom tool auto-installs the tool

### Mobile App

- **React Native** — Shared API layer with web. Native navigation, gesture support
- **Push notifications** — Research job complete, workflow finished, background agent needs approval, new marketplace item from followed creator
- **Voice-first mode** — STT input by default, TTS output. Hands-free deliberation while driving/walking
- **Offline mode** — IndexedDB sync. Queue deliberation requests offline, execute when connected
- **Haptic feedback** — Subtle vibration on verdict delivery, conflict detection, confidence milestones

---

## Business Milestones

| Milestone | Target | Success Metric |
|---|---|---|
| **Production Launch** | Q2 2026 | Zero critical vulnerabilities, 80%+ test coverage, < 2s p95 |
| **Open Source Traction** | Q3 2026 | 1,000 GitHub stars, 100 monthly active self-hosted instances |
| **Enterprise Pilot** | Q4 2026 | 3 enterprise customers on paid pilot ($5K/mo each) |
| **SaaS GA** | Q1 2027 | Self-serve signup, usage-based billing, 500 registered users |
| **Series A Ready** | Q2 2027 | $100K ARR, 10+ enterprise accounts, 5K GitHub stars |
| **Platform Maturity** | Q3 2027 | 50+ marketplace items, 20+ MCP integrations, mobile app shipped |

---

## Why AIBYAI Wins

**No one else does multi-agent deliberation at production grade.**

1. **Consensus, not guesswork** — 4+ agents debate with mathematical scoring. You get a peer-reviewed verdict with a confidence number, not a single model's best guess

2. **Provider freedom** — 7 adapters, automatic failover, mix-and-match per query. Use GPT-4o for creativity, Claude for analysis, Gemini for speed — in the same deliberation

3. **Enterprise evidence trail** — Cold validation, hallucination detection, conflict resolution logs, confidence calibration. The audit trail compliance teams need

4. **Open core** — Self-host for free, forever. Pay for managed hosting and enterprise features. No bait-and-switch licensing

5. **Extensible by design** — Workflow engine, marketplace, plugin SDK, MCP integration. AIBYAI is the orchestration layer, not a walled garden

---

## Revenue Model

| Tier | Price | Target Customer | Includes |
|---|---|---|---|
| **Community** | Free / OSS | Developers, researchers | Self-hosted, unlimited deliberations, all providers, community support |
| **Pro** | $49/user/mo | Power users, freelancers | Managed hosting, 10K deliberations/mo, priority support, analytics |
| **Team** | $29/user/mo (5+) | Startups, small teams | Shared workspaces, collaboration, SSO, 50K deliberations/mo |
| **Enterprise** | Custom | Large organizations | Multi-region, SLA, dedicated support, data residency, unlimited usage |

---

<div align="center">

**[Back to README](./README.md)**

</div>

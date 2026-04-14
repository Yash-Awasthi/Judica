<div align="center">

# AIBYAI Roadmap

### What's Next

[![Now](https://img.shields.io/badge/Now-Production_Hardening-3B82F6?style=for-the-badge)](#phase-1-production-hardening-q2-2026)
[![Next](https://img.shields.io/badge/Next-Intelligence-8B5CF6?style=for-the-badge)](#phase-2-intelligence-layer-q3-2026)
[![Then](https://img.shields.io/badge/Then-Autonomy-F59E0B?style=for-the-badge)](#phase-3-autonomous-operations-q4-2026)
[![Scale](https://img.shields.io/badge/2027-Platform_%26_Enterprise-22C55E?style=for-the-badge)](#phase-4-platform--ecosystem-q1-2027)

</div>

---

## Phase 1: Production Hardening (Q2 2026)

> **Status: In Progress** — Security remediation complete. 86%+ test coverage achieved. Remaining: E2E, perf, observability.

### Testing

- [ ] E2E tests with Playwright — 5 critical user flows (signup → deliberation → KB upload → workflow → marketplace)
- [ ] Rewrite route-level integration tests to use `fastify.inject()` against the real app instead of local mocks
- [ ] Contract tests for SSE streaming format (verify event shapes for all deliberation stages)
- [ ] Load testing with autocannon: target 200 concurrent deliberations, < 2s p95 latency

### Performance

- [ ] PostgreSQL connection pooling via `pg-pool` (currently one connection per request)
- [ ] Frontend bundle splitting — lazy load Workflow Editor, Marketplace, Analytics views
- [ ] CDN configuration for static assets (Vite build output)
- [ ] Redis pipeline batching for rate limit checks (currently one round-trip per check)

### Observability

- [ ] Grafana alert rules: error rate > 5%, p99 latency > 5s, queue backlog > 100, provider failure rate > 20%
- [ ] Structured error tracking with correlation IDs across request lifecycle
- [ ] Provider health dashboard — per-provider availability, latency distribution, cost per 1K tokens
- [ ] Dead letter queue monitoring panel in Grafana

### Technical Debt

- [ ] Complete Express-to-Fastify migration (11 remaining middleware files use Express compat layer)
- [ ] Python sandbox: upgrade from process-level to kernel-level isolation (nsjail, bubblewrap, or container-per-execution)
- [ ] Migrate auth tokens from localStorage to httpOnly cookies
- [ ] Move API key storage server-side; reference by ID, not value in frontend
- [ ] Verify SerpAPI auth mechanism (header vs query param) — current fix may break integration
- [ ] Accessibility (a11y) pass: ARIA attributes, focus trapping, keyboard navigation throughout frontend
- [ ] Persist user settings server-side (autoCouncil, debateRound, coldValidator, piiDetection currently localStorage-only)

---

## Phase 2: Intelligence Layer (Q3 2026)

> Building the brain that learns.

### Agentic Memory v2

- [ ] **Cross-conversation topic linking** — Connect related sessions via embedding similarity; build topic graph
- [ ] **Preference adaptation** — Track archetype engagement; auto-tune council composition per user
- [ ] **Temporal decay** — Exponential memory decay with refresh on access; 30-day TTL for one-off facts
- [ ] **Contradiction resolution** — Versioned resolution records instead of silent overwrite; surface contradictions

### Advanced RAG Pipeline

- [ ] **Cohere reranking** — `rerank-english-v3.0` as post-retrieval step; top-50 rerank after RRF fusion
- [ ] **Parent-child chunking** — Hierarchical chunks; inject parent when child matches
- [ ] **HyDE** — Hypothetical Document Embeddings for improved recall on abstract queries
- [ ] **Multi-index federated search** — Single query across KBs, repos, and conversation history
- [ ] **Adaptive k selection** — Dynamic retrieval depth based on query complexity

### Agent Specialization

- [ ] **Domain-specific reasoning** — Pre-configured profiles for legal, medical, financial, engineering
- [ ] **Self-improving personas** — Track agreement rate with consensus; auto-adjust prompt on divergence
- [ ] **Dynamic delegation** — Agents spawn sub-agents for specialized tasks mid-deliberation
- [ ] **Confidence calibration** — Historical confidence vs accuracy tracking; penalize overconfidence

---

## Phase 3: Autonomous Operations (Q4 2026)

> From answering questions to completing missions.

### Autonomous Agent Mode

- [ ] **Goal decomposition engine** — Break high-level objectives into DAG of subtasks
- [ ] **Tool chains** — Autonomous sequencing: web search → extraction → analysis → charts → reports
- [ ] **Long-running background agents** — Hours-long tasks with Redis checkpoints
- [ ] **Human-in-the-loop gates** — Configurable approval points; WebSocket notifications
- [ ] **Intermediate artifact streaming** — Real-time SSE with partial results

### Code Generation & Review

- [ ] **Full-stack scaffolding** — Natural language → project structure, components, APIs, schema
- [ ] **PR review agent** — Security + Performance + Style triple review
- [ ] **Test generation** — Council debates edge cases; generates comprehensive test suites
- [ ] **Refactoring assistant** — Before/after diffs with safety analysis

### Multi-Modal Council

- [ ] **Image-aware agents** — Analyze images, screenshots, diagrams in deliberation
- [ ] **Audio/video input** — Transcribe and extract keyframes for council context
- [ ] **Visual output generation** — Mermaid diagrams, data visualizations in responses
- [ ] **Cross-modal reasoning** — Detect contradictions across text, images, charts

---

## Phase 4: Platform & Ecosystem (Q1 2027)

> From product to platform.

### MCP Integration

- [ ] **Server mode** — Expose deliberation as MCP tool for Cursor, Claude Desktop, etc.
- [ ] **Client mode** — Agents call external MCP servers during deliberation
- [ ] **Tool federation** — Browse and install MCP ecosystem tools

### Plugin SDK

- [ ] **Custom tool packages** — NPM packages registering tools: `npm install aibyai-plugin-jira`
- [ ] **Custom workflow nodes** — Third-party nodes with React UI + server handlers
- [ ] **Webhook triggers** — Fire on deliberation events (verdict, conflict, confidence threshold)
- [ ] **Middleware hooks** — Intercept pipeline at any stage (PII redaction, compliance checks)

### Real-time Collaboration

- [ ] **Multi-user deliberation** — 2–10 users in shared council session
- [ ] **Live presence** — Cursor positions, typing indicators in shared workflow editor
- [ ] **User annotations** — Highlight and comment on agent responses
- [ ] **Synthesis voting** — Democratic consensus on top of AI consensus

---

## Phase 5: Scale & Enterprise (Q2 2027)

> From startup to platform company.

### Infrastructure

- [ ] **Kubernetes** — Helm charts with HPA based on queue depth, latency, WebSocket connections
- [ ] **Multi-region** — PostgreSQL primary + read replicas (EU-West, AP-South); Redis Cluster
- [ ] **Cost optimization** — Spot instances for batch jobs; reserved capacity for real-time

### Enterprise Features

- [ ] **SSO** — SAML 2.0 + OIDC (Okta, Azure AD, Google Workspace)
- [ ] **Workspace isolation** — Separate DBs, Redis namespaces, encryption keys per tenant
- [ ] **Per-tenant quotas** — Token limits, storage caps, concurrency limits by plan tier
- [ ] **Audit compliance** — SOC 2 Type II logging; GDPR export + right-to-deletion
- [ ] **Data residency** — Pin tenant data to geographic regions
- [ ] **SLA monitoring** — 99.9% uptime with automated alerting; latency SLOs per endpoint

### Marketplace v2

- [ ] **Revenue sharing** — Creator pricing + 20% platform fee via Stripe Connect
- [ ] **Verified publishers** — Application process, trust badges, priority placement
- [ ] **Usage analytics** — Installs, DAU, retention, rating trends for creators
- [ ] **Collections** — Curated bundles ("Legal Practice Pack", "Code Review Kit")
- [ ] **Dependency resolution** — Auto-install tool dependencies when installing workflows

### Mobile App

- [ ] **React Native** — Shared API layer, native navigation + gestures
- [ ] **Push notifications** — Job complete, workflow finished, agent needs approval
- [ ] **Voice-first mode** — STT input + TTS output for hands-free deliberation
- [ ] **Offline mode** — IndexedDB sync; queue requests offline
- [ ] **Haptic feedback** — Vibration on verdict delivery, conflict detection

---

## Business Milestones

| Milestone | Target | Success Metric |
|---|---|---|
| **Production Launch** | Q2 2026 | Zero critical vulns, 80%+ coverage, < 2s p95 |
| **Open Source Traction** | Q3 2026 | 1,000 stars, 100 monthly active self-hosted instances |
| **Enterprise Pilot** | Q4 2026 | 3 enterprise customers ($5K/mo each) |
| **SaaS GA** | Q1 2027 | Self-serve signup, usage-based billing, 500 users |
| **Series A Ready** | Q2 2027 | $100K ARR, 10+ enterprise accounts, 5K stars |
| **Platform Maturity** | Q3 2027 | 50+ marketplace items, 20+ MCP integrations, mobile shipped |

---

## Revenue Model

| Tier | Price | Target | Includes |
|---|---|---|---|
| **Community** | Free / OSS | Developers, researchers | Self-hosted, unlimited, all providers |
| **Pro** | $49/user/mo | Power users | Managed hosting, 10K deliberations/mo, analytics |
| **Team** | $29/user/mo (5+) | Startups | Shared workspaces, SSO, 50K deliberations/mo |
| **Enterprise** | Custom | Large orgs | Multi-region, SLA, data residency, unlimited |

---

<div align="center">

**[Back to README](./README.md)**

</div>

<div align="center">

# AIBYAI Roadmap

### What's Next

[![Now](https://img.shields.io/badge/Now-Remaining_Hardening-3B82F6?style=for-the-badge)](#phase-1-remaining-hardening)
[![Next](https://img.shields.io/badge/Next-Autonomous_Ops-F59E0B?style=for-the-badge)](#phase-3-autonomous-operations--remaining)
[![Then](https://img.shields.io/badge/Then-Platform-8B5CF6?style=for-the-badge)](#phase-4-platform--ecosystem--remaining)
[![Scale](https://img.shields.io/badge/2027-Enterprise-22C55E?style=for-the-badge)](#phase-5-scale--enterprise-q2-2027)

</div>

---

## Completed

> Phases 1 (most), 2, and most of 3–4 are done. See git history for details.

| Phase | Highlights |
|---|---|
| **Phase 1** | E2E tests, CI, integration test templates, load test scaffold, Redis auth pipelining, observability |
| **Phase 2** | HyDE, parent-child chunking, federated search, adaptive k, topic graph, temporal decay, contradiction resolution, Cohere reranking, agent specialization, confidence calibration, dynamic delegation |
| **Phase 3** | Goal decomposition, tool chains, test generation, refactoring assistant, PR review agent, full-stack scaffolding, image-aware agents, visual output generation, cross-modal reasoning |
| **Phase 4** | MCP server + client, plugin SDK, webhook triggers, middleware hooks |

---

## Phase 1: Remaining Hardening

- [/] Rewrite route-level integration tests to use `fastify.inject()` against the real app (templates, auth guard, archetypes done; more routes ongoing)
- [/] Load testing with autocannon — scaffold ready (`npm run test:load`), target 200 concurrent deliberations, < 2s p95
- [ ] Python sandbox: add seccomp-bpf syscall filter
- [ ] Accessibility: screen reader testing (VoiceOver/NVDA) — manual verification needed

---

## Phase 3: Autonomous Operations — Remaining

- [ ] **Long-running background agents** — Hours-long tasks with Redis checkpoints *(needs running Redis)*
- [ ] **Human-in-the-loop gates** — Configurable approval points; WebSocket notifications *(needs running server)*
- [ ] **Intermediate artifact streaming** — Real-time SSE with partial results *(needs running server)*
- [ ] **Audio/video input** — Transcribe and extract keyframes for council context *(needs external transcription service)*

---

## Phase 4: Platform & Ecosystem — Remaining

- [ ] **Tool federation** — Browse and install MCP ecosystem tools *(needs package registry/marketplace UI)*
- [ ] **Custom workflow nodes** — Third-party nodes with React UI + server handlers *(needs running frontend)*

### Real-time Collaboration

- [ ] **Multi-user deliberation** — 2–10 users in shared council session *(needs WebSocket infrastructure)*
- [ ] **Live presence** — Cursor positions, typing indicators in shared workflow editor *(needs WebSocket infrastructure)*
- [ ] **User annotations** — Highlight and comment on agent responses *(needs running frontend)*
- [ ] **Synthesis voting** — Democratic consensus on top of AI consensus *(needs running frontend)*

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

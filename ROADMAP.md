<div align="center">

# AIBYAI Roadmap

### What's Next

[![Now](https://img.shields.io/badge/Now-Final_Hardening-3B82F6?style=for-the-badge)](#phase-1-remaining-hardening)
[![Next](https://img.shields.io/badge/Next-Enterprise-22C55E?style=for-the-badge)](#phase-5-scale--enterprise-q2-2027)

</div>

---

## Completed

> Phases 1–4 service layers are complete. See git history for details.

| Phase | Highlights |
|---|---|
| **Phase 1** | E2E tests, CI, integration test templates, load test scaffold, Redis auth pipelining, observability |
| **Phase 2** | HyDE, parent-child chunking, federated search, adaptive k, topic graph, temporal decay, contradiction resolution, Cohere reranking, agent specialization, confidence calibration, dynamic delegation |
| **Phase 3** | Goal decomposition, tool chains, test generation, refactoring assistant, PR review agent, full-stack scaffolding, image-aware agents, visual output generation, cross-modal reasoning, HITL gates, background agents, artifact streaming, audio/video input |
| **Phase 4** | MCP server + client, plugin SDK, webhook triggers, middleware hooks, tool federation, custom workflow nodes, user annotations, synthesis voting, multi-user deliberation, live presence |

---

## Phase 1: Remaining Hardening

- [/] Rewrite route-level integration tests to use `fastify.inject()` against the real app (templates, auth guard, archetypes done; more routes ongoing)
- [/] Load testing with autocannon — scaffold ready (`npm run test:load`), target 200 concurrent deliberations, < 2s p95
- [x] Python sandbox: add seccomp-bpf syscall filter
- [ ] Accessibility: screen reader testing (VoiceOver/NVDA) — manual verification needed

---

## Phase 3–4: Remaining

> All service layers for Phase 3 & 4 are implemented with in-memory stores and full test coverage. Items below require infrastructure (Redis, WebSocket server, frontend) to become fully operational.

- [x] ~~Long-running background agents~~ — Service layer done (checkpointing, pause/resume, progress tracking)
- [x] ~~Human-in-the-loop gates~~ — Service layer done (4 gate types, multi-approver, auto-timeout)
- [x] ~~Intermediate artifact streaming~~ — Service layer done (EventEmitter pub/sub, SSE formatting, replay)
- [x] ~~Audio/video input~~ — Service layer done (multi-provider transcription, keyframe extraction)
- [x] ~~Tool federation~~ — Service layer done (registry, search, install/uninstall, toggle)
- [x] ~~Custom workflow nodes~~ — Service layer done (registry, execution, validation)
- [x] ~~Multi-user deliberation~~ — Service layer done (rooms, roles, phases, turn management)
- [x] ~~Live presence~~ — Service layer done (cursors, heartbeat, awareness)
- [x] ~~User annotations~~ — Service layer done (threads, reactions, resolution)
- [x] ~~Synthesis voting~~ — Service layer done (weighted scoring, quorum, delegation)

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

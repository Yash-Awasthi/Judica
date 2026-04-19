<div align="center">

# AIBYAI — Development Roadmap

**Multi-Agent Deliberative Intelligence Platform**

[![Phase 14](https://img.shields.io/badge/Phase_14-Planned-3B82F6?style=flat-square)](#phase-14-enterprise-deployment--sso)
[![Phase 15](https://img.shields.io/badge/Phase_15-Planned-3B82F6?style=flat-square)](#phase-15-agent-observability--evaluation)
[![Phase 16](https://img.shields.io/badge/Phase_16-Planned-3B82F6?style=flat-square)](#phase-16-multi-tenant-saas)

</div>

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete |
| 🔄 | In Progress |
| 🔵 | Planned |

---

## Completed Phases

Phases 1–13 are complete and shipped. Highlights from the most recent phases:

- **Phase 10 — Multi-Modal Input** ✅: File attachments, inline image rendering, audio transcription (Whisper), multi-modal conflict detection.
- **Phase 11 — Agent Marketplace & Sharing** ✅: Archetype builder UI, one-click publish, council template export/import, ratings and usage stats.
- **Phase 12 — Workspace Roles & Audit Logs** ✅: Owner/Admin/Member/Viewer roles, role-based route guards, JSONL audit export, role management UI.
- **Phase 13 — Advanced Reasoning Modes** ✅: Socratic dialogue, Red Team / Blue Team, iterative hypothesis refinement, confidence calibration.

---

## Phase 14: Enterprise Deployment & SSO 🔵

> Production-ready features for team and enterprise adoption.

| Feature | Status |
|---------|--------|
| **SAML / OIDC SSO** — federated login for enterprise identity providers (Okta, Azure AD, Auth0) | 🔵 |
| **Org-level API Keys** — scoped API keys with per-key rate limits and audit trails | 🔵 |
| **Self-hosted Helm Chart** — Kubernetes deployment with horizontal scaling and health probes | 🔵 |
| **Data Residency Controls** — configurable regions for vector storage and conversation data | 🔵 |

---

## Phase 15: Agent Observability & Evaluation 🔵

> Measure, compare, and improve deliberation quality over time.

| Feature | Status |
|---------|--------|
| **Evaluation Harness** — automated benchmarking of council accuracy against labeled datasets | 🔵 |
| **Deliberation Replay** — step-through replay of past councils with claim-level diff view | 🔵 |
| **Provider Cost Dashboard** — per-provider, per-model cost breakdown with budget alerts | 🔵 |
| **A/B Council Configs** — run two SUMMONS configs side-by-side and compare consensus quality | 🔵 |

---

## Phase 16: Multi-Tenant SaaS 🔵

> Hosted offering with billing, onboarding, and tenant isolation.

| Feature | Status |
|---------|--------|
| **Tenant Isolation** — per-tenant database schemas, encryption keys, and vector namespaces | 🔵 |
| **Usage-Based Billing** — Stripe integration with metered billing per deliberation and per token | 🔵 |
| **Onboarding Wizard** — guided setup flow: provider keys, first council, sample deliberation | 🔵 |
| **Admin Super-Dashboard** — cross-tenant usage metrics, health checks, and feature flags | 🔵 |

---

<div align="center">

**[Back to README](./README.md)** · [Report a Bug](https://github.com/Yash-Awasthi/aibyai/issues) · [Request a Feature](https://github.com/Yash-Awasthi/aibyai/issues)

</div>

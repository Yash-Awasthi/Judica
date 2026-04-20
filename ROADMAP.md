<div align="center">

# AIBYAI — Development Roadmap

**Multi-Agent Deliberative Intelligence Platform**

[![Phase 1](https://img.shields.io/badge/Phase_1-Planned-3B82F6?style=flat-square)](#phase-1-enterprise-deployment--sso)
[![Phase 2](https://img.shields.io/badge/Phase_2-Planned-3B82F6?style=flat-square)](#phase-2-agent-observability--evaluation)
[![Phase 3](https://img.shields.io/badge/Phase_3-Planned-3B82F6?style=flat-square)](#phase-3-multi-tenant-saas)

</div>

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔵 | Planned |

---

## Phase 1: Enterprise Deployment & SSO 🔵

> Production-ready features for team and enterprise adoption.

| # | Feature | Status |
|---|---------|--------|
| 1 | **SAML / OIDC SSO** — federated login for enterprise identity providers (Okta, Azure AD, Auth0) | 🔵 |
| 2 | **Org-level API Keys** — scoped API keys with per-key rate limits and audit trails | 🔵 |
| 3 | **Self-hosted Helm Chart** — Kubernetes deployment with horizontal scaling and health probes | 🔵 |
| 4 | **Data Residency Controls** — configurable regions for vector storage and conversation data | 🔵 |

---

## Phase 2: Agent Observability & Evaluation 🔵

> Measure, compare, and improve deliberation quality over time.

| # | Feature | Status |
|---|---------|--------|
| 1 | **Evaluation Harness** — automated benchmarking of council accuracy against labeled datasets | 🔵 |
| 2 | **Deliberation Replay** — step-through replay of past councils with claim-level diff view | 🔵 |
| 3 | **Provider Cost Dashboard** — per-provider, per-model cost breakdown with budget alerts | 🔵 |
| 4 | **A/B Council Configs** — run two council configs side-by-side and compare consensus quality | 🔵 |

---

## Phase 3: Multi-Tenant SaaS 🔵

> Hosted offering with billing, onboarding, and tenant isolation.

| # | Feature | Status |
|---|---------|--------|
| 1 | **Tenant Isolation** — per-tenant database schemas, encryption keys, and vector namespaces | 🔵 |
| 2 | **Usage-Based Billing** — Stripe integration with metered billing per deliberation and per token | 🔵 |
| 3 | **Onboarding Wizard** — guided setup flow: provider keys, first council, sample deliberation | 🔵 |
| 4 | **Admin Super-Dashboard** — cross-tenant usage metrics, health checks, and feature flags | 🔵 |

---

<div align="center">

**[Back to README](./README.md)** · [Report a Bug](https://github.com/Yash-Awasthi/aibyai/issues) · [Request a Feature](https://github.com/Yash-Awasthi/aibyai/issues)

</div>

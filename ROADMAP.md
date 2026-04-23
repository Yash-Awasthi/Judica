<div align="center">

# AIBYAI — Development Roadmap

**Multi-Agent Deliberative Intelligence Platform**

[![Phase 0](https://img.shields.io/badge/Phase_0-In_Progress-22C55E?style=flat-square)](#phase-0-frontend-polish--core-ux)
[![Phase 1](https://img.shields.io/badge/Phase_1-Planned-3B82F6?style=flat-square)](#phase-1-enterprise-deployment--sso)
[![Phase 2](https://img.shields.io/badge/Phase_2-Planned-3B82F6?style=flat-square)](#phase-2-agent-observability--evaluation)
[![Phase 3](https://img.shields.io/badge/Phase_3-Planned-3B82F6?style=flat-square)](#phase-3-multi-tenant-saas)
[![Phase 4](https://img.shields.io/badge/Phase_4-Planned-3B82F6?style=flat-square)](#phase-4-connected-ai-accounts--advanced-interaction)

</div>

---

## What's Already Built

The following features are fully implemented and shipped in the current codebase (`v1.0.0`):

### Core Deliberation
- Multi-agent council deliberation (4–7 concurrent agents via different LLM providers)
- 14 built-in agent archetypes (Architect, Contrarian, Empiricist, Ethicist, Futurist, Pragmatist, Historian, Empath, Outsider, Strategist, Minimalist, Creator, Judge, Devil's Advocate)
- Pairwise conflict detection with severity scoring (1–5 scale)
- Structured debate: critique → rebuttal → concession tracking
- Reliability scoring per model, persisted across sessions and weighted at synthesis
- 5 deliberation modes: Standard, Socratic, Red/Blue, Hypothesis, Confidence
- Bloom Gate (prevents round degradation)
- Cold validator for final hallucination check
- SSE streaming for real-time deliberation progress

### Intelligence
- 5-stage RAG pipeline: HyDE, parent-child chunking, federated search, adaptive k selection, Cohere reranking + RRF
- Three-layer agentic memory: active context, session summaries, long-term pgvector HNSW
- Cross-conversation topic graph with LLM-extracted topic linking
- Temporal decay (14-day half-life) + contradiction resolution with versioned audit trails
- Deep research mode: autonomous multi-step research with web search, scraping, and synthesis
- Semantic response caching (LRU + pgvector similarity)

### Agent Capabilities
- Goal decomposition engine with DAG, cycle detection, topological sort, failure cascading
- Long-running background agents with checkpointing, pause/resume, progress streaming
- Human-in-the-loop gates (4 gate types: approval, review, confirmation, escalation)
- Tool chains: 6 tool types, sequential execution with output piping
- Visual workflow engine: 12 node types, drag-and-drop canvas, server-side topological execution
- Built-in tools: web search (Tavily + SerpAPI), calculator, datetime, Wikipedia, read_webpage
- User-defined Python skills

### Providers & Routing
- 13+ LLM provider adapters (OpenAI, Anthropic, Gemini, Groq, Ollama, OpenRouter, Mistral, Cerebras, NVIDIA, Perplexity, Fireworks, Together, DeepInfra, Azure)
- Custom OpenAI-compatible provider support (EMOF, UI-configurable)
- Smart routing: complexity classification, free/paid tier chains, Opossum circuit breaker
- Per-query token and cost tracking

### Data & Storage
- PostgreSQL 16 + pgvector HNSW indexes
- Redis 7 + BullMQ with dead-letter queue (4 queues: ingestion, research, repo-indexing, compaction)
- Knowledge base management with document ingestion (PDF, DOCX, XLSX, CSV, images, audio)
- GitHub repository indexing and semantic code search
- File uploads with MIME-type validation and path traversal protection

### Platform
- React 19 + Vite 7 + Tailwind CSS frontend with 18 views
- JWT + OAuth2 (Google, GitHub) authentication
- RBAC (admin, member, viewer)
- Community marketplace (prompts, workflows, personas, tools)
- Prompt IDE with versioning
- Analytics dashboard + execution trace viewer
- Audio transcription (Whisper + Google Speech-to-Text) and TTS
- Real-time multi-user deliberation (2–10 users, roles, phases, presence, annotations, voting)
- MCP server + client (bidirectional Model Context Protocol)
- Plugin SDK (custom tools, webhooks, middleware hooks, tool federation)
- Multi-modal council (image-aware agents, visual output generation)
- Code generation: scaffolding, PR review, test generation, refactoring assistant
- Code sandbox: JS (isolated-vm) + Python (bubblewrap + seccomp-bpf)
- Prometheus + Grafana observability (auto-provisioned dashboards)
- Docker Compose + multi-stage Dockerfile + GitHub Actions CI/CD

---

## Phase 0: Frontend Polish & Core UX

> Immediate fixes and improvements to make the existing UI interactive and complete.

| # | Feature | Status |
|---|---|---|
| 1 | **Marketplace Interactivity** — Star toggle, install/uninstall toggle, and publish dialog all fully functional with state management | Completed |
| 2 | **Marketplace Download as JSON** — Export any marketplace item as a JSON file for offline use or sharing | Completed |
| 3 | **Marketplace Filter Layout** — Starred, My Items, and Installed filter toggles on the LEFT side of the category tabs row with a visual divider | Completed |
| 4 | **Always-Visible Action Buttons** — Star, Download, and Install/Uninstall buttons visible on every card without requiring hover | Completed |
| 5 | **Publish to Marketplace Dialog** — Full publish form with name, description, type, content, and tags fields | Completed |

---

## Phase 1: Enterprise Deployment & SSO

> Production-ready features for team and enterprise adoption.

| # | Feature | Priority |
|---|---|---|
| 1 | **SAML / OIDC SSO** — Federated login for enterprise identity providers (Okta, Azure AD, Auth0) | High |
| 2 | **Org-level API Keys** — Scoped API keys with per-key rate limits and full audit trails | High |
| 3 | **MFA for Admin Accounts** — TOTP or hardware key required for `role: admin` users | High |
| 4 | **Self-hosted Helm Chart** — Kubernetes deployment with horizontal scaling and health probes | Medium |
| 5 | **Data Residency Controls** — Configurable regions for vector storage and conversation data | Medium |

---

## Phase 2: Agent Observability & Evaluation

> Measure, compare, and improve deliberation quality over time.

| # | Feature | Priority |
|---|---|---|
| 1 | **Evaluation Harness** — Automated benchmarking of council accuracy against labeled datasets | High |
| 2 | **Deliberation Replay** — Step-through replay of past councils with claim-level diff view | High |
| 3 | **Provider Cost Dashboard** — Per-provider, per-model cost breakdown with budget alerts and spend caps | Medium |
| 4 | **A/B Council Configs** — Run two council configurations side-by-side and compare consensus quality | Medium |
| 5 | **Confidence Calibration Reports** — Per-archetype confidence accuracy over time | Low |

---

## Phase 3: Multi-Tenant SaaS

> Hosted offering with billing, onboarding, and tenant isolation.

| # | Feature | Priority |
|---|---|---|
| 1 | **Tenant Isolation** — Per-tenant database schemas, encryption keys, and pgvector namespaces | High |
| 2 | **Usage-Based Billing** — Stripe integration with metered billing per deliberation and per token | High |
| 3 | **Onboarding Wizard** — Guided setup: provider keys, first council, sample deliberation | Medium |
| 4 | **Admin Super-Dashboard** — Cross-tenant usage metrics, health checks, feature flags | Medium |
| 5 | **Audit Log Export** — Compliance-ready export of all actions per tenant | Medium |

---

## Phase 4: Connected AI Accounts & Advanced Interaction

> Connected multi-provider AI sessions, live controls, and rich interaction patterns.

| # | Feature | Priority |
|---|---|---|
| 1 | **Google SSO + Connected AI Accounts** — Sign up via Google, connect OpenAI/Claude/Gemini accounts. Connected APIs visible in council panel. Each connected service sees user prompts, replies independently, responses used in consensus. Services cannot see each other's responses, only consensus + user messages. Conversations stored in user's actual accounts on those platforms. | High |
| 2 | **Live AI Toggle** — Toggle any AI on/off during a chat session. Off → AI finishes current response then stops. On → AI catches up by reading user messages + consensus summaries from missed rounds. Warning: toggling on for long chats costs significant context. Warning: toggling off then on again costs credits regardless of usage. | High |
| 3 | **Comment & Quote System** — Select text in any message to attach inline comments. Multiple quotes can be accumulated before sending. Comments appear as an overlay above the prompt box with an apostrophe icon listing all quoted lines + annotations. Final prompt can reference comments ("look into all my comments" / "do sequentially"). Inspired by Antigravity-style quoting. | Medium |
| 4 | **Themes & Customization** — Custom theme editor, high contrast mode, and theme marketplace for sharing color schemes | Medium |

---

## Continuous Improvements

These items don't belong to a specific phase but are tracked as ongoing work:

- **DNS rebinding protection** — check SSRF target IP at connection time, not just validation time
- **Per-tool rate limiting** in MCP client
- **Field-level encryption** for conversation content (PII in chat messages)
- **SBOM generation** and `npm audit` enforcement in CI
- **JWT refresh token single-use enforcement** (prevent parallel refresh race)
- **Reduce `any` types** in adapter layer (ongoing lint debt)

---

<div align="center">

**[Back to README](./README.md)** · [Documentation](./DOCUMENTATION.md) · [Report a Bug](https://github.com/Yash-Awasthi/aibyai/issues) · [Request a Feature](https://github.com/Yash-Awasthi/aibyai/issues)

</div>

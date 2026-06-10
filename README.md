<div align="center">

# Judica

### Multi-Model AI Deliberation Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com/)

<br />

**Send one question. Get independent answers from 3 to 51 AI models simultaneously.
Judica runs a council, scores each response, and synthesizes a verdict.**

[Quick Start](#quick-start) · [Architecture](#architecture) · [Features](#features) · [API](#api-reference) · [Deploy](#deployment)

</div>

---

## What Is Judica?

Judica is a self-hosted AI orchestration platform. You configure a **council** — any combination of AI models via API key or browser-connected accounts — and every question you ask is sent to all of them simultaneously. The council deliberates, each member responds, and a designated synthesizer writes the final verdict.

It goes well beyond a simple compare-view. Judica includes:

- **Agentic tools** — code execution, web search, RAG over your own documents
- **50+ data connectors** — Slack, Notion, GitHub, Jira, Google Drive, and more
- **Memory** — long-term memory with pluggable backends (local, Pinecone, Weaviate, pgvector)
- **Workflows** — visual node-editor for multi-step AI pipelines
- **ULTRAPLINIAN** — fire 10–51 models in parallel, score by quality + latency + token efficiency, crown a winner
- **Deep Research** — multi-step research loops with source citation and synthesis
- **Evaluation** — automatic quality/coherence/consensus scoring on every session

---

## Quick Start

### Docker (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Yash-Awasthi/Judica/main/install.sh | bash
```

Or manually:

```bash
git clone https://github.com/Yash-Awasthi/Judica.git
cd Judica
cp .env.example .env          # fill in your keys
docker compose up -d
```

App runs at **http://localhost:5173**. The first-run wizard guides you through council configuration.

### Manual (dev)

**Prerequisites:** Node.js 22+, npm 10+, PostgreSQL 16, Redis 7

```bash
git clone https://github.com/Yash-Awasthi/Judica.git
cd Judica

# Backend
npm install
cp .env.example .env          # fill in DATABASE_URL, REDIS_URL, etc.
npm run db:migrate
npm run dev                   # Fastify on :3000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                   # Vite on :5173
```

---

## Architecture

```
judica/
├── src/                        # Fastify backend (Node.js + TypeScript)
│   ├── routes/                 # 140+ API route plugins
│   ├── services/               # Business logic (80+ services)
│   ├── lib/                    # Core libraries
│   │   ├── deepResearch/       # Multi-step research engine
│   │   ├── ultraplinian.ts     # Mass-parallel model orchestration
│   │   ├── evaluation.ts       # Session scoring (quality, coherence, consensus)
│   │   └── redis.ts / drizzle.ts
│   ├── agents/                 # Agent loop + tool execution
│   ├── connectors/             # 50+ data source connectors
│   ├── workflow/               # Node-based workflow executor
│   ├── kg/                     # Knowledge graph
│   └── db/                     # Drizzle ORM schema + migrations
│
├── frontend/                   # React Router 7 SPA
│   └── app/
│       ├── routes/             # Page routes (chat, workflows, KB, admin, …)
│       ├── components/         # UI components (shadcn/ui based)
│       └── lib/                # Client libs (deliberate, council, etc.)
│
├── extensions/                 # Chrome extension
├── tests/
│   ├── e2e/                    # Playwright end-to-end tests
│   ├── integration/            # Backend integration tests
│   └── load/                   # autocannon load tests
│
├── docker-compose.yml
├── install.sh                  # One-command installer
└── .env.example                # All 200+ config options documented
```

### Request Flow

```
Browser → React Router SPA
         → POST /api/deliberate (SSE stream)
              → Council members queried in parallel
              → Opinions streamed back as SSE events
              → Synthesizer writes verdict
              → Session saved to PostgreSQL
              → Memory chunks stored (pgvector / external)
              → Evaluation scores computed
```

---

## Features

### Core Deliberation

| Feature | Description |
|---|---|
| **Council** | 3–51 AI models deliberate simultaneously |
| **Streaming** | SSE-streamed opinions + verdict in real time |
| **Verdict rotation** | Each round a different member synthesizes |
| **Compaction** | Old rounds compressed after N rounds (configurable) |
| **Blind Council** | Members answer without seeing each other |
| **Debate mode** | Models argue opposing positions before verdict |
| **Expert Panel** | Each member assumes a specialist persona |

### G0DM0D3 Features

| Feature | Description |
|---|---|
| **ULTRAPLINIAN** | Fire 10/24/36/45/51 models, score by composite metric, crown winner |
| **GODMODE CLASSIC** | Raw parallel compare — no scoring, just speed |
| **Parseltongue** | Code-aware deliberation with syntax analysis |
| **AutoTune** | Auto-optimize system prompts via feedback loops |
| **STM** | Short-term memory modules: hedge reducer, direct mode, curiosity bias — with full session injection history at `/stm` |

### Data & Knowledge

| Feature | Description |
|---|---|
| **Knowledge Bases** | Upload PDFs, Markdown, CSV, DOCX — indexed via pgvector |
| **50+ connectors** | Slack, Notion, GitHub, Jira, Confluence, Google Drive, … |
| **Connector sync** | Load / Poll / Slim sync modes with scheduling |
| **Knowledge Graph** | Entity/relation extraction over ingested docs |
| **Deep Research** | Multi-step research with source citations |

### Platform

| Feature | Description |
|---|---|
| **Workflows** | Visual node editor — chain LLM calls, tools, branching |
| **Agents** | Browser agent, code agent, A2A protocol |
| **Evaluation** | Auto-scoring: quality, coherence, consensus, diversity |
| **Memory** | Long-term memory with local / Pinecone / Weaviate backends |
| **Marketplace** | Share and install prompts, archetypes, workflows |
| **Multi-tenant** | Workspaces, SCIM, SSO (Google OAuth + GitHub OAuth) |
| **Observability** | Prometheus metrics, Grafana dashboards, trace logs |
| **Billing** | Stripe integration with per-seat and usage-based plans |

### Chrome Extension

`extensions/chrome/` — Manifest V3 extension that puts the council everywhere:

| Component | Description |
|---|---|
| **Sidebar** | Full deliberation panel anchored to any page via `Cmd/Ctrl+Shift+A` |
| **Popup** | Quick-ask a single question from the toolbar |
| **Context menu** | Right-click selected text → send to council |
| **Content script** | Injects council replies inline on supported sites |
| **Options page** | Set backend URL, API key, default council preset |

---

## API Reference

The backend exposes a fully documented OpenAPI spec at `/api/docs` (Swagger UI).

Key endpoints:

```
POST /api/deliberate              — start a deliberation session (SSE)
POST /api/ultraplinian/stream     — ULTRAPLINIAN mass-parallel (SSE)
GET  /api/analytics/overview      — usage stats
GET  /api/kb                      — list knowledge bases
POST /api/kb/:id/upload           — upload document to KB
GET  /api/workflows               — list workflows
POST /api/workflows               — create workflow
POST /api/workflows/:id/run       — execute workflow
GET  /api/evaluation/metrics      — evaluation stats
GET  /api/memory/stats            — memory stats
POST /api/memory/compact          — trigger compaction
GET  /api/connectors              — list connectors
POST /api/connectors              — create connector
POST /api/connectors/:id/sync     — trigger sync
POST /api/parseltongue/analyze    — code-aware specialist review (SSE)
POST /api/autotune/run            — run AutoTune parameter benchmark
GET  /api/stm/active              — get active STM modules
POST /api/stm/active              — set active STM modules
GET  /api/stm/history             — session injection history
DELETE /api/stm/history           — clear injection history
POST /api/research                — create deep research job
GET  /api/research/:id/stream     — stream research progress (SSE)
GET  /api/admin/users             — user management (admin)
GET  /api/admin/audit-logs        — audit log (admin)
GET  /api/system/info             — deployment info
```

---

## Configuration

Copy `.env.example` and fill in the values you need. Minimal required set:

```env
DATABASE_URL=postgresql://judica:judica@localhost:5432/judica
REDIS_URL=redis://localhost:6379
JWT_SECRET=<random 32+ chars>
SESSION_SECRET=<random 32+ chars>
```

Everything else is optional — API keys, OAuth, Stripe, Pinecone, Weaviate, SMTP, etc. See `.env.example` for the full annotated reference.

---

## Deployment

### Docker Compose (self-hosted)

```bash
docker compose up -d
```

Includes: Judica backend + frontend, PostgreSQL, Redis, Prometheus, Grafana.

### Kubernetes

Helm chart in `helm/`. See `k8s/` for raw manifests.

```bash
helm install judica ./helm --values helm/values.yaml
```

### Render / Railway / Fly

`render.yaml` is included. One-click deploy on Render:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

### Cloudflare Workers (frontend only)

```bash
wrangler deploy
```

---

## Development

```bash
npm run dev:all          # backend + frontend concurrently
npm run test             # Vitest unit tests
npm run test:e2e         # Playwright E2E tests
npm run test:load        # autocannon load tests
npm run db:studio        # Drizzle Studio (DB browser)
npm run typecheck        # TypeScript check
```

---

## Privacy

- **Self-hosted.** Your data stays on your infrastructure.
- **No telemetry.** Nothing is sent to Judica servers.
- **Keys stay local.** API keys are stored in your `.env` / database, never transmitted.

---

## License

MIT © [Yash Awasthi](https://github.com/Yash-Awasthi)

---

<div align="center">

*Judica — Latin: "Judge. Vindicate. Decide."*

[Releases](https://github.com/Yash-Awasthi/Judica/releases) · [Issues](https://github.com/Yash-Awasthi/Judica/issues) · [API Docs](http://localhost:3000/api/docs)

</div>

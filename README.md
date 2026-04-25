<div align="center">

# AIBYAI

### Multi-Agent Orchestration Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Tests](https://img.shields.io/badge/Tests-4300+-22C55E?style=for-the-badge)](./tests/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-8B5CF6?style=for-the-badge)](https://modelcontextprotocol.io/)

<br />

**Instead of trusting one model's best guess, AIBYAI runs a council — 4+ agents argue, critique each other's claims, and produce a scored consensus with a confidence number you can actually trust.**

[Quick Start](#quick-start) · [Architecture](#architecture) · [Features](#features) · [Documentation](./docs/DOCUMENTATION.md) · [Roadmap](./docs/ROADMAP.md) · [Security](./docs/SECURITY.md)

</div>

---

## The Problem with Single-Model AI

You ask GPT a question. It sounds confident. But is it right? There's no second opinion, no peer review, no scoring. AIBYAI fixes this by making AI models **debate each other**.

| | Single Model | AIBYAI Council |
|---|---|---|
| **Perspectives** | 1 | 4–7 agents running concurrently |
| **Quality Check** | None | Peer critique + cold validation |
| **Scoring** | Trust the output | `0.6 × Agreement + 0.4 × PeerRanking` |
| **Contradictions** | Invisible | Detected, debated, resolved |
| **Confidence** | Unknown | Numeric score with penalty breakdown |
| **Memory** | Stateless | Cross-conversation topic graph, temporal decay, adaptive recall |
| **Provider Lock-in** | One vendor | 13+ providers, automatic failover |
| **Cost Visibility** | Bill at the end | Per-query cost tracking |

---

## How It Works

```mermaid
sequenceDiagram
    participant U as User
    participant R as Router
    participant RAG as RAG Engine
    participant A1 as Empiricist
    participant A2 as Strategist
    participant A3 as Historian
    participant A4 as Skeptic
    participant CD as Conflict Detector
    participant S as Synthesizer
    participant V as Cold Validator

    U->>R: Query
    R->>R: Classify complexity + select archetypes
    R->>RAG: Retrieve context (HyDE + federated search)
    RAG-->>R: Ranked context chunks

    par Parallel Generation
        R->>A1: Prompt + context → OpenAI
        R->>A2: Prompt + context → Anthropic
        R->>A3: Prompt + context → Gemini
        R->>A4: Prompt + context → Groq
    end

    A1-->>CD: Response + 3–5 claims + confidence
    A2-->>CD: Response + 3–5 claims + confidence
    A3-->>CD: Response + 3–5 claims + confidence
    A4-->>CD: Response + 3–5 claims + confidence

    CD->>CD: Pairwise claim comparison → severity 1–5

    alt Contradiction severity ≥ 3
        CD->>A1: Critique prompt
        CD->>A2: Critique prompt
        A1-->>S: Concede or defend (updates reliability score)
        A2-->>S: Concede or defend (updates reliability score)
    end

    S->>S: Reliability-weighted merge at temp 0.3
    S->>V: Draft verdict
    V->>V: Independent hallucination check
    V-->>U: Verdict + Confidence + Per-claim breakdown + Cost
```

**The 7 steps under the hood:**

1. Each agent generates a response with 3–5 extracted factual claims
2. Claims are compared pairwise — contradictions scored on a 1–5 severity scale
3. Conflicts above severity 3 trigger structured debate (critique → rebuttal → concession)
4. Agents that concede get their reliability score updated and persisted across sessions
5. Synthesis uses reliability-weighted merging at temperature 0.3
6. Confidence formula: `claimScore × 0.6 + debateScore × 0.3 + diversityBonus × 0.1`
7. Cold validator independently checks the verdict for hallucinations before returning

---

## Architecture

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        FE["React 19 · Vite 7 · Tailwind CSS\nWorkflow canvas · SSE streaming · WebSocket"]
    end

    subgraph Gateway["API Gateway"]
        GW["Fastify 5 — 62 route plugins\nJWT · RBAC · Rate-limit · CSRF · CSP · Helmet"]
    end

    subgraph Engine["Deliberation Engine"]
        direction LR
        RT["Smart Router\nQuery classification\nArchetype selection"] --> AG["Agent Pool\n4–7 concurrent\n14 archetypes"]
        AG --> CD["Conflict Detector\nPairwise · Severity 1–5"]
        CD --> DE["Debate Engine\nCritique · Rebuttal\nConcession tracking"]
        DE --> SY["Synthesizer\nReliability-weighted\nConfidence scoring"]
        SY --> CV["Cold Validator\nHallucination check"]
    end

    subgraph Intel["Intelligence Layer"]
        RAG["5-Stage RAG\nHyDE · Federated · Parent-child\nReranker · RRF"]
        MEM["Agentic Memory\nTopic graph · HNSW · Temporal decay\nContradiction resolution"]
    end

    subgraph Providers["LLM Providers — 13+"]
        P["OpenAI · Anthropic · Gemini · Groq\nOllama · Mistral · Cerebras · +7 more"]
    end

    subgraph Data["Data Layer"]
        PG[("PostgreSQL 16\npgvector HNSW")]
        RD[("Redis 7\nBullMQ DLQ")]
    end

    subgraph Sandbox["Code Execution"]
        JS["JavaScript\nV8 isolate · 128 MB · 5s"]
        PY["Python\nbubblewrap · seccomp-bpf · ulimit"]
    end

    Client <-->|HTTPS / WebSocket| Gateway
    Gateway --> Engine
    Engine --> Intel
    Engine <-->|circuit-breaker failover| Providers
    Intel <--> Data
    Engine --> Sandbox
    Engine --> Data
```

---

## Features

### Multi-Agent Deliberation
The core of AIBYAI. An orchestrator dispatches your query to 4+ agents running on different LLMs — each with a distinct archetype (14 built-in: Architect, Contrarian, Empiricist, Ethicist, Futurist, Pragmatist, Historian, Empath, Outsider, Strategist, Minimalist, Creator, Judge, Devil's Advocate). Agents don't just generate answers in parallel — they **extract claims, detect contradictions pairwise, and argue through structured debate rounds**. Concessions are tracked and fed back into per-model reliability scores that persist across sessions.

### Advanced RAG Pipeline
Five-stage retrieval: **HyDE** generates hypothetical answers to improve recall, **parent-child chunking** (1536/512 chars) retrieves child chunks and enriches with parent context, **federated search** queries KBs + repos + conversations + council facts in parallel, **adaptive k selection** picks result count by query complexity (simple k=3, moderate k=7, complex k=12), and optional **Cohere reranking** reorders results post-retrieval. All stages merge via Reciprocal Rank Fusion.

### Agentic Memory
Three-layer memory with intelligence: active conversation context, auto-generated session summaries, and long-term vector memory with HNSW indexing. **Cross-conversation topic graph** links related discussions through LLM-extracted topics and embedding similarity. **Temporal decay** (14-day half-life) keeps fresh memories relevant while expiring stale one-off facts. **Contradiction resolution** tracks conflicting agent claims with versioned audit trails.

### Agent Specialization
Domain-specific reasoning profiles (legal, medical, financial, engineering) with weighted archetype selection. **Self-improving personas** adjust agent prompts based on performance metrics. **Confidence calibration** flags over/underconfident agents by comparing stated confidence to actual agreement rates. **Dynamic delegation** routes subtasks to the best archetype via keyword matching.

### Autonomous Operations
**Goal decomposition engine** breaks complex objectives into a DAG of subtasks with cycle detection, topological sort, and cascading failure handling. **Tool chains** execute 6 tool types sequentially with output piping between steps. Three pre-built templates: research reports, competitive analysis, data pipelines. **Long-running background agents** handle hours-long tasks with checkpointing, pause/resume, and progress tracking. **Human-in-the-loop gates** provide configurable approval points with 4 gate types (approval, review, confirmation, escalation), multi-approver support, and auto-timeout.

### Audio/Video Input
**Multi-provider transcription** supports OpenAI Whisper and Google Speech-to-Text with graceful fallback. **Video keyframe extraction** captures frames at configurable intervals with LLM-generated scene descriptions. Transcripts and visual elements are formatted as structured council context for multi-modal deliberation.

### Code Generation & Review
**Full-stack scaffolding** turns natural language into PostgreSQL schemas + Drizzle ORM + API routes + React components. **PR review agent** runs security, performance, and style analysis in parallel with weighted scoring. **Test generation** uses 4 council perspectives (boundary, error, security, usability) for edge case discovery. **Refactoring assistant** detects 10 refactoring types and generates safe diffs with behavior-preservation analysis.

### MCP Integration
**Server mode** exposes AIBYAI as an MCP-compatible tool server (JSON-RPC 2.0) with deliberation, knowledge search, and test generation tools. **Client mode** connects to external MCP servers with tool discovery, caching, and auth header forwarding. Full bidirectional MCP support makes AIBYAI composable with the broader AI tool ecosystem.

### Plugin SDK & Webhooks
**Custom tool packages** with manifest-driven lifecycle (onLoad/onUnload) and config validation. **Webhook triggers** for 8 event types with retry logic and HMAC-SHA256 signing. **Middleware hooks** at 8 pipeline stages — includes built-in PII redaction, audit logging, and content length guards. **Tool federation** lets users browse, install, and manage MCP ecosystem tools from a registry with search, ratings, and per-user enable/toggle.

### Multi-Modal Council
**Image-aware agents** analyze images and extract elements for council deliberation. **Visual output generation** produces Mermaid diagrams (8 types), chart specs, deliberation mindmaps, and confidence tables. **Cross-modal reasoning** detects contradictions between text and image inputs.

### Real-time Collaboration
**Multi-user deliberation** supports 2–10 users in shared council sessions with role-based participation (moderator, contributor, observer), phase management (open, deliberating, voting, closed), and turn-based speaking. **Live presence** tracks cursor positions, typing indicators, and user activity with heartbeat-based cleanup. **User annotations** let participants highlight and comment on agent responses with threaded replies, reactions, and resolution tracking. **Synthesis voting** adds democratic consensus on top of AI consensus with quorum thresholds, delegation, and automatic result tallying.

### Smart Provider Routing
Queries are classified by complexity and routed through provider chains. Free tier: Gemini → Groq → OpenRouter → Cerebras → Ollama. Paid tier: OpenAI → Anthropic → Gemini → Mistral. If a provider fails, the circuit breaker (Opossum) trips and traffic shifts to the next in chain — no user-visible downtime.

### Visual Workflow Engine
A drag-and-drop canvas (React Flow) with 12 node types: LLM, Tool, Condition, Loop, HTTP, Code, Human Gate, Split, Merge, Template, Input, Output. Workflows execute server-side with topological ordering. HTTP nodes go through SSRF validation. Human Gate nodes pause execution for up to 5 minutes waiting for user input.

### Deep Research Mode
Autonomous multi-step research: an LLM breaks your query into 3–5 sub-questions, searches the web (Tavily → SerpAPI fallback), scrapes up to 2000 chars per source, synthesizes cited answers per sub-question, then compiles a final Markdown report with executive summary and references.

### Code Sandbox
JavaScript runs in a V8 isolate (isolated-vm, 128MB cap, 5s timeout). Python runs in a subprocess with **bubblewrap** namespace isolation + **seccomp-bpf syscall filter** (blocks 30+ dangerous syscalls: ptrace, mount, bpf, unshare, kexec, etc.), **ulimit constraints** (256MB memory, 10s CPU, 32 processes), **socket-level network blocking**, and **import restrictions** (ctypes, subprocess, signal, etc. blocked). A safe math evaluator uses a recursive descent parser — no `eval()` or `Function()`.

### Community Marketplace
Publish and install prompts, workflows, personas, and custom tools. Star ratings, reviews, download tracking, one-click import into your workspace.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 22+, TypeScript 6.0 (strict) |
| **API** | Fastify 5 — 62 route plugins, Swagger UI at `/api/docs` |
| **Frontend** | React 19, Vite 7, Tailwind CSS, React Flow |
| **Database** | PostgreSQL 16 + pgvector HNSW indexes, Drizzle ORM |
| **Cache / Queues** | Redis 7, BullMQ with dead-letter queue |
| **Realtime** | Native WebSocket (ws) + SSE streaming |
| **Auth** | JWT (HS256, 15 min TTL) + Passport OAuth2 (Google, GitHub) |
| **Encryption** | AES-256-GCM (per-record IV), argon2id password hashing |
| **Observability** | Pino, Prometheus, Grafana, LangFuse, OpenTelemetry |
| **Sandbox** | isolated-vm (JS), bubblewrap + seccomp-bpf + ulimit (Python) |
| **Resilience** | Opossum circuit breaker, exponential backoff, dead-letter queue |
| **Intelligence** | HyDE, RRF, Cohere reranker, pgvector HNSW |
| **Protocols** | MCP (server + client), JSON-RPC 2.0 |
| **Infrastructure** | Docker Compose, Kubernetes-ready, GitHub Actions CI/CD |

### LLM Providers

| Provider | Models | Tier |
|---|---|---|
| OpenAI | GPT-4o, o1, o3, o4-mini | Paid — 500 RPM |
| Anthropic | Claude 3.5 Sonnet, Claude 4 | Paid — 50 RPM |
| Google | Gemini 2.0 Flash, 2.5 Pro | Free/Paid — 15 RPM |
| Groq | LLaMA 3.x, LLaMA 4, Mixtral | Free — 30 RPM |
| Ollama | Any local model | Self-hosted — unlimited |
| OpenRouter | Multi-model gateway | Free — 20 RPM |
| Mistral | Mistral Small, Large | Paid — 60 RPM |
| Cerebras | LLaMA 3.3 70B | Free — 30 RPM |
| NVIDIA NIM | NIM models | Paid — varies |
| Perplexity | Sonar (search-augmented) | Paid — varies |
| Fireworks | Fast inference | Paid — varies |
| Together | Open-source models | Paid — varies |
| DeepInfra | Open-source models | Paid — varies |
| Azure OpenAI | GPT-4o (Azure-hosted) | Paid — varies |
| Custom | Any OpenAI-compatible API | Configurable via UI |

All adapters include circuit breaker protection, request timeouts, SSRF validation, and tool-call depth limiting.

---

## Quick Start

```bash
git clone https://github.com/Yash-Awasthi/aibyai.git
cd aibyai

npm install
cd frontend && npm install && cd ..

cp .env.example .env
# Required: DATABASE_URL, JWT_SECRET (min 32 chars), MASTER_ENCRYPTION_KEY (64-char hex)
# At least one AI key: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY

npm run db:push
npm run dev:all
```

Open **http://localhost:5173**

### Docker (recommended for full stack)

```bash
cp .env.example .env  # fill in required values
docker compose up -d
# App  → http://localhost:3000
# Grafana dashboards → http://localhost:3001 (auto-provisioned)
# Prometheus → http://localhost:9090
```

> **Full setup guide, environment variables, and API reference:** [DOCUMENTATION.md](./docs/DOCUMENTATION.md)

---

## Example

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"question": "Microservices vs monolith?", "mode": "auto", "rounds": 2}'
```

The endpoint streams SSE events in order:

| Event | Payload | Description |
|---|---|---|
| `status` | `{ message }` | Progress updates |
| `member_chunk` | `{ name, chunk }` | Streaming tokens per agent |
| `opinion` | `{ name, opinion, confidence }` | Complete agent response |
| `peer_review` | `{ round, reviews }` | Structured critiques |
| `scored` | `{ opinions, scores }` | ML-ranked responses |
| `validator_result` | `{ valid, issues }` | Cold validation result |
| `metrics` | `{ tokens, cost, latency }` | Usage and cost |
| `done` | `{ verdict, confidence, opinions }` | Final synthesis |

> **Full API reference:** [DOCUMENTATION.md](./docs/DOCUMENTATION.md#api-reference) | **Interactive docs:** `/api/docs`

---

## Project Structure

```
aibyai/
├── src/
│   ├── adapters/           # 16 LLM provider adapters + registry
│   ├── agents/             # Orchestrator, conflict detector, shared memory, message bus
│   ├── auth/               # OAuth strategies (Google, GitHub)
│   ├── config/             # Zod-validated environment config
│   ├── db/schema/          # Drizzle ORM tables + HNSW indexes
│   ├── lib/                # Core engine: council, deliberation phases, scoring,
│   │                       # crypto, cache, cost tracking, SSRF, tools registry
│   ├── connectors/         # 51 data source connectors (Slack, GitHub, Confluence, Notion…)
│   ├── integrations/       # Discord + Slack bot integrations
│   ├── ee/                 # Enterprise features (RBAC, SSO, admin)
│   ├── mcp/                # MCP server + client (Model Context Protocol)
│   ├── kg/                 # Knowledge graph layer
│   ├── evals/              # RAG evaluation + benchmarking
│   ├── middleware/         # Auth, RBAC, rate limiting, CSP, quota, validation
│   ├── observability/      # OpenTelemetry tracer + LangFuse export
│   ├── processors/         # File ingestion (PDF, DOCX, XLSX, CSV, images, audio)
│   ├── queue/              # BullMQ workers + dead-letter queue
│   ├── router/             # Smart routing, token estimation, quota tracking
│   ├── routes/             # 62 Fastify route plugins
│   ├── sandbox/            # V8 isolate (JS) + bubblewrap/seccomp-bpf (Python)
│   ├── services/           # 77 business logic services:
│   │                       # council, RAG, memory, reliability, specialization,
│   │                       # goal decomposition, tool chains, code gen, MCP,
│   │                       # plugins, HITL gates, background agents, audio/video,
│   │                       # multi-user, live presence, annotations, voting
│   ├── types/              # TypeScript declarations
│   └── workflow/           # Executor + 12 node types
├── frontend/src/
│   ├── components/         # React components + workflow node UIs
│   ├── context/            # Auth + Theme + Store contexts
│   ├── hooks/              # Council stream, deliberation, member hooks
│   ├── views/              # 25 page views (Chat, Debate, Workflows, Marketplace…)
│   └── router.tsx          # React Router 7
├── tests/                  # 264 test files, 4300+ tests (Vitest)
├── cli/                    # CLI tool (@aibyai/cli) — terminal interface
├── desktop/                # Tauri 2 desktop app (macOS, Windows, Linux)
├── helm/                   # Helm chart for Kubernetes deployment
├── k8s/                    # Raw Kubernetes manifests
├── grafana/                # Auto-provisioned dashboards
├── migrations/             # Drizzle ORM migration files
├── scripts/                # Setup, load tests, provider diagnostics
├── docs/                   # Project documentation
│   ├── DOCUMENTATION.md    #   Complete technical reference and API docs
│   ├── CONTRIBUTING.md     #   Development guide and contribution workflow
│   ├── SECURITY.md         #   Vulnerability reporting and security policy
│   ├── THREAT_MODEL.md     #   Attack surface analysis and trust boundaries
│   └── ROADMAP.md          #   Planned features by phase
├── .github/workflows/      # CI: lint, typecheck, test, security audit, CodeQL
├── docker-compose.yml      # PostgreSQL + Redis + Prometheus + Grafana
├── Dockerfile              # Multi-stage build with HEALTHCHECK
└── README.md               # This file
```

---

## Security

| Layer | Implementation |
|---|---|
| **Authentication** | JWT (HS256-pinned, 15 min TTL) + rotating httpOnly refresh tokens + argon2id |
| **OAuth2** | Google + GitHub with verified email enforcement |
| **Authorization** | RBAC (member/admin), per-route guards, per-tenant quota enforcement |
| **Rate Limiting** | Redis-backed: 10/min auth, 60/min API, 10/min sandbox, 20/min voice |
| **Input Validation** | Zod on all payloads; safe math parser (no eval); LIKE wildcard escaping |
| **SSRF Protection** | DNS-level validation on all outbound HTTP — adapters, tools, workflow nodes |
| **Code Sandbox** | JS: V8 isolate (128MB, 5s). Python: bubblewrap + seccomp-bpf + ulimit + import restrictions |
| **Encryption** | AES-256-GCM with per-record IV; scrypt key derivation; argon2id for passwords |
| **Resilience** | Circuit breaker on provider calls, exponential backoff, dead-letter queue |
| **Headers** | CSP with nonce, HSTS, X-Frame-Options, request ID correlation |
| **HTML Sanitization** | Loop-based script/style stripping preventing nested-tag bypass |
| **Path Safety** | Canonicalization + boundary checks on all file operations (no TOCTOU) |

See [SECURITY.md](./docs/SECURITY.md) for the vulnerability reporting policy and [THREAT_MODEL.md](./docs/THREAT_MODEL.md) for the full attack surface analysis.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes and ensure they pass:
   ```bash
   npm run typecheck
   npm run lint
   npm test
   ```
4. Commit with conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`
5. Push and open a pull request

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for the full development guide, architecture overview, and instructions for adding new providers, archetypes, and workflow nodes.

---

<div align="center">

**Built with deliberation, not hallucination.**

[Report a Bug](https://github.com/Yash-Awasthi/aibyai/issues) · [Request a Feature](https://github.com/Yash-Awasthi/aibyai/issues) · [Roadmap](./docs/ROADMAP.md) · [Documentation](./docs/DOCUMENTATION.md)

</div>

<div align="center">

# AIBYAI

### Multimodal Multi-Agent Deliberative Intelligence Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-5.2-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-ISC-22C55E?style=for-the-badge)](./LICENSE)

<br />

**4+ AI agents debate, critique, and synthesize answers through structured deliberation — producing mathematically validated consensus instead of single-model guesswork.**

[Quick Start](#-quick-start) · [How It Works](#-how-it-works) · [Features](#-features) · [Documentation](./docs/DOCUMENTATION.md) · [Roadmap](./ROADMAP.md)

</div>

---

## Why AIBYAI?

Single-model AI gives you one perspective. AIBYAI gives you a **council**.

| | Single Model | AIBYAI Council |
|---|---|---|
| **Perspectives** | 1 | 4+ concurrent agents |
| **Quality Check** | None | Peer review + cold validation |
| **Scoring** | Trust the output | Deterministic ML scoring |
| **Bias Detection** | Hope for the best | Cross-agent contradiction detection |
| **Confidence** | Unknown | Mathematical consensus metric |

---

## How It Works

```mermaid
sequenceDiagram
    participant U as User
    participant R as Router
    participant A1 as Agent 1
    participant A2 as Agent 2
    participant A3 as Agent 3
    participant CD as Conflict Detector
    participant S as Synthesizer
    participant V as Cold Validator

    U->>R: Query
    R->>R: Classify + Select Archetypes

    par Parallel Generation
        R->>A1: Generate (Empiricist)
        R->>A2: Generate (Strategist)
        R->>A3: Generate (Historian)
    end

    A1-->>CD: Response
    A2-->>CD: Response
    A3-->>CD: Response

    CD->>CD: Detect Contradictions

    alt Conflicts Found
        CD->>A1: Debate Round
        CD->>A2: Debate Round
        A1-->>S: Refined Response
        A2-->>S: Refined Response
    end

    A3-->>S: Response
    S->>S: Reliability-Weighted Synthesis
    S->>V: Verdict
    V->>V: Hallucination Check
    V-->>U: Final Verdict + Confidence Score
```

The pipeline scores each agent using `0.6 × Agreement + 0.4 × PeerRanking`, targets `≥ 0.85` consensus (cosine similarity), and weights synthesis by model reliability scores tracked across sessions.

---

## Architecture

```mermaid
flowchart TB
    subgraph CLIENT["Frontend — React 18 + Vite"]
        direction LR
        UI["Chat UI"]
        WF["Workflow Canvas"]
        DB_UI["Debate Dashboard"]
        MK["Marketplace"]
    end

    subgraph API["Express 5 API Layer"]
        direction LR
        AUTH["Auth\nJWT + OAuth2"]
        RATE["Rate Limiter\nRedis-backed"]
        ROUTES["33 Route\nHandlers"]
    end

    subgraph ENGINE["Deliberation Engine"]
        direction TB
        ROUTER["Query Router\nAuto-classify"]
        PARALLEL["Parallel Agents\n4+ concurrent"]
        DEBATE["Debate Rounds\nPeer Review"]
        CONFLICT["Conflict\nDetector"]
        SYNTH["Synthesis\nReliability-weighted"]
        COLD["Cold Validator\nFresh Eyes"]
    end

    subgraph PROVIDERS["Provider Adapters"]
        direction LR
        OAI["OpenAI"]
        ANT["Anthropic"]
        GEM["Gemini"]
        GRQ["Groq"]
        OLL["Ollama"]
        OR["OpenRouter"]
        CUSTOM["Custom\nProviders"]
    end

    subgraph DATA["Data Layer"]
        direction LR
        PG["PostgreSQL 16\npgvector"]
        RD["Redis 7\nCache + Queues"]
        BQ["BullMQ\nAsync Jobs"]
    end

    CLIENT --> API
    API --> ENGINE
    ENGINE --> PROVIDERS
    ENGINE --> DATA
    BQ --> DATA

    style CLIENT fill:#1e293b,stroke:#3b82f6,color:#e2e8f0
    style API fill:#1e293b,stroke:#8b5cf6,color:#e2e8f0
    style ENGINE fill:#1e293b,stroke:#f59e0b,color:#e2e8f0
    style PROVIDERS fill:#1e293b,stroke:#10b981,color:#e2e8f0
    style DATA fill:#1e293b,stroke:#ef4444,color:#e2e8f0
```

---

## Features

### Multi-Agent Deliberation
4+ AI agents with distinct archetypes (Empiricist, Strategist, Historian, Architect, Skeptic) debate in structured rounds with peer review, adversarial critique, and deterministic consensus scoring. A cold validator independently checks the final verdict for hallucinations.

### 9 LLM Provider Adapters
Unified interface for OpenAI, Anthropic, Gemini, Groq, Ollama (local), OpenRouter, Mistral, Cerebras, and NVIDIA NIM. Add custom providers via UI — zero code changes.

### RAG Knowledge Bases
pgvector embeddings, hybrid search (vector + BM25), document chunking, and multi-format ingestion (PDF, DOCX, XLSX, CSV, TXT, images). Attach knowledge bases to conversations for grounded responses.

### Visual Workflow Engine
Drag-and-drop builder with React Flow — 10+ node types (LLM, Tool, Condition, Loop, HTTP, Code, Human Gate). Server-side execution with real-time streaming.

### Deep Research Mode
Autonomous multi-step research: breaks queries into sub-questions, searches the web, scrapes sources, synthesizes answers, and produces cited reports. Async via BullMQ.

### Code Sandbox
Isolated execution — JavaScript in `isolated-vm` (V8 isolate), Python in subprocess with timeout. Artifacts auto-detected from AI responses.

### Community Marketplace
Publish and install prompts, workflows, personas, and tools. Star ratings, reviews, download tracking, one-click import.

### User Skills Framework
Write Python functions that become tools during council deliberation. Sandboxed execution, dynamic registration.

### Observability + LLMOps
Execution tracing with LangFuse export, model reliability scoring, analytics dashboard, per-query cost tracking with color-coded tiers.

### GitHub Intelligence
Index repositories into the vector store. Code snippets are injected into council context for code-aware conversations.

### 3-Layer Memory
Active context, auto-generated session summaries, and long-term vector memory with compaction. Pluggable backends (pgvector, Qdrant, GetZep).

### Auth + RBAC + Sharing
JWT + OAuth2 (Google, GitHub), role-based access control, shareable conversations with expiry, admin dashboard.

### PWA + Offline
Workbox service worker, IndexedDB conversation caching, NetworkFirst API strategy.

---

## Tech Stack

```mermaid
mindmap
  root((AIBYAI))
    Backend
      Express 5
      TypeScript 5.9
      Prisma 7.6
      BullMQ
      Socket.IO
    Frontend
      React 18
      Vite 6
      Tailwind CSS
      React Flow
      Monaco Editor
      Recharts
    AI Providers
      OpenAI
      Anthropic
      Google Gemini
      Groq
      Ollama
      OpenRouter
      Mistral
      Cerebras
      NVIDIA NIM
    Data
      PostgreSQL 16
      pgvector
      Redis 7
      IndexedDB
    Infrastructure
      Docker
      PM2 Cluster
      GitHub Actions
      Workbox PWA
    Security
      Helmet
      JWT + OAuth2
      AES-256-GCM
      RBAC
      Rate Limiting
```

**178 backend files · 57 frontend files · 39 database models · 33 API routes · 9 LLM providers**

---

## Quick Start

```bash
git clone https://github.com/Yash-Awasthi/aibyai.git
cd aibyai

npm install
cd frontend && npm install && cd ..

cp .env.example .env
# Add DATABASE_URL, JWT_SECRET, and at least one AI provider key

npx prisma generate && npx prisma migrate dev --name init
npm run dev:all
```

Open **http://localhost:5173**

### Or with Docker

```bash
docker compose up -d
# → http://localhost:3000
```

> **Full setup guide, all environment variables, and API reference:** [docs/DOCUMENTATION.md](./docs/DOCUMENTATION.md)

---

## Example

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"question": "Microservices vs monolith?", "mode": "auto", "rounds": 2}'
```

Returns an SSE stream: `opinion` → `peer_review` → `scored` → `done` (verdict + confidence score)

> **Full API reference with all 33 endpoints:** [docs/DOCUMENTATION.md](./docs/DOCUMENTATION.md#api-reference)

---

## Documentation

| Document | Description |
|---|---|
| **[Documentation](./docs/DOCUMENTATION.md)** | Setup, env vars, API reference, project structure, deployment, security |
| **[API Reference](./docs/API.md)** | Detailed endpoint documentation |
| **[Roadmap](./ROADMAP.md)** | Future plans — testing, collaboration, plugins, scaling |

---

## License

[ISC](./LICENSE) — Yash Awasthi

---

<div align="center">

**Built with deliberation, not hallucination.**

[Report a Bug](https://github.com/Yash-Awasthi/aibyai/issues) · [Request a Feature](https://github.com/Yash-Awasthi/aibyai/issues)

</div>

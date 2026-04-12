<div align="center">

# AIBYAI Roadmap

### What's Next

[![Status](https://img.shields.io/badge/Core_Platform-Complete-22C55E?style=for-the-badge)](./README.md)
[![Status](https://img.shields.io/badge/Next_Phase-Quality_%26_Scale-3B82F6?style=for-the-badge)](#-testing--quality-assurance)

</div>

---

All 22 original roadmap phases and all 12 Master Execution Plan tiers are **complete**. This document tracks future work — quality improvements, new capabilities, and scaling targets.

---

## Current Architecture

```mermaid
flowchart LR
    subgraph COMPLETE["Implemented"]
        direction TB
        A["Multi-Agent Deliberation\n4+ agents, peer review, debate"]
        B["9 LLM Providers\nOpenAI, Anthropic, Gemini, Groq, Ollama..."]
        C["RAG Pipeline\npgvector, hybrid search, KB management"]
        D["Workflow Engine\n10+ node types, visual canvas"]
        E["Research Mode\nMulti-step web research"]
        F["Code Sandbox\nisolated-vm + Python"]
        G["Marketplace\nPrompts, workflows, personas, tools"]
        H["Observability\nTracing, LangFuse, reliability scoring"]
        I["Auth + RBAC\nOAuth2, roles, sharing"]
        J["Infrastructure\nDocker, BullMQ, CI, PWA"]
    end

    style COMPLETE fill:#022c22,stroke:#22c55e,color:#bbf7d0
```

---

## Future Roadmap

```mermaid
timeline
    title AIBYAI Development Timeline
    section Quality
        Testing Suite : Unit tests (vitest) : Integration tests (supertest) : E2E tests (Playwright)
        API Documentation : ✅ Swagger/OpenAPI live at /api/docs
    section Intelligence
        Agentic Memory v2 : Cross-conversation learning : Topic clustering : Automatic forgetting
        Advanced Reranking : Cohere rerank integration : Custom reranker training
        Multi-turn Research : Iterative research with follow-ups : Source quality scoring
    section Platform
        Real-time Collaboration : Multi-user deliberation : Live cursors : Shared councils
        Plugin SDK : Third-party tool integration : Webhook triggers : Custom node types
        Mobile App : React Native client : Push notifications : Voice-first interface
    section Scale
        Kubernetes : Horizontal auto-scaling : Multi-region : Health-based routing
        Multi-tenant : Workspace isolation : Per-tenant quotas : SSO (SAML)
        Enterprise : Audit compliance : Data residency : SLA monitoring
```

---

## ~~API Documentation~~ — Complete

> **Status: Done** — Swagger/OpenAPI docs are live at `/api/docs`.

All 35 route handlers have `@openapi` JSDoc annotations. Interactive Swagger UI is mounted at `/api/docs` with OpenAPI 3.0 spec available at `/api/docs/spec.json`.

---

## Testing & Quality Assurance

> **Priority: High** — Test suite exists (7 test files, 97 passing tests) but coverage can expand.

### Unit Tests

Target **70% statement coverage** across all services.

| Area | Files | Framework |
|---|---|---|
| Services | `src/services/*.ts` | vitest + mocked Prisma |
| Adapters | `src/adapters/*.ts` | vitest + nock (HTTP mocking) |
| Middleware | `src/middleware/*.ts` | vitest |
| Workflow nodes | `src/workflow/nodes/*.ts` | vitest |
| Lib utilities | `src/lib/*.ts` | vitest |

### Integration Tests

Every API route: happy path + 401 + invalid input = minimum 3 tests per route.

| Area | Approach |
|---|---|
| 35 API routes | supertest against Express app |
| Database operations | Test Prisma against real PostgreSQL |
| Queue processing | BullMQ job lifecycle testing |
| SSE streaming | Event stream validation |

### E2E Tests

Critical user flows with Playwright (already installed in the project).

| Flow | Description |
|---|---|
| Authentication | Sign up, login, OAuth redirect |
| Council deliberation | Ask question, receive streamed debate + verdict |
| Knowledge base | Create KB, upload document, query with RAG |
| Workflow builder | Create workflow, add nodes, execute |
| Marketplace | Browse, install item, verify in account |

---

## Agentic Memory v2

> **Priority: Medium** — Current memory works but doesn't learn across conversations.

```mermaid
flowchart TB
    subgraph CURRENT["Current (Implemented)"]
        direction LR
        L1["Layer 1\nActive Context\nLast N messages"]
        L2["Layer 2\nSession Summary\nAuto-generated"]
        L3["Layer 3\nLong-term\npgvector + compaction"]
    end

    subgraph FUTURE["Future (Planned)"]
        direction LR
        F1["Cross-conversation\nTopic linking"]
        F2["Automatic forgetting\nDecay + relevance"]
        F3["User preference\nlearning"]
        F4["Contradiction\nresolution memory"]
    end

    CURRENT --> FUTURE

    style CURRENT fill:#022c22,stroke:#22c55e,color:#bbf7d0
    style FUTURE fill:#1e1b4b,stroke:#818cf8,color:#c7d2fe
```

### Goals

- **Cross-conversation learning**: Link related topics across separate conversations. When a user discusses "React performance" in one chat and "frontend optimization" in another, the system should connect these.
- **Automatic forgetting**: Implement decay functions so stale memories lose relevance over time. Frequently accessed memories persist; one-off facts fade.
- **Preference learning**: Track which agent archetypes the user prefers, which response styles they engage with, and adapt council composition over time.
- **Contradiction resolution**: When new information contradicts stored memory, create a resolution record rather than silently overwriting.

---

## Advanced Reranking

> **Priority: Medium** — Currently using RRF (Reciprocal Rank Fusion) only.

### Planned

- **Cohere rerank**: Integration with `rerank-english-v3.0` for hybrid search results (code exists in vectorStore.service.ts but needs the Cohere API key path)
- **Cross-encoder reranking**: Fine-tuned model for domain-specific relevance scoring
- **Dynamic k selection**: Automatically choose how many chunks to retrieve based on query complexity

---

## Real-time Collaboration

> **Priority: Medium** — Currently single-user per session.

### Vision

```mermaid
flowchart LR
    U1["User A"] --> WS["WebSocket Hub\nSocket.IO"]
    U2["User B"] --> WS
    U3["User C"] --> WS
    WS --> COUNCIL["Shared Council\nSession"]
    COUNCIL --> STREAM["Shared SSE\nStream"]
    STREAM --> U1
    STREAM --> U2
    STREAM --> U3

    style WS fill:#1e293b,stroke:#f59e0b,color:#e2e8f0
    style COUNCIL fill:#1e293b,stroke:#3b82f6,color:#e2e8f0
```

- Multiple users join a shared deliberation session
- Live cursors showing who's viewing what
- Shared council configuration (collaborative archetype selection)
- Per-user annotations on agent responses
- Voting on which synthesis direction to take

---

## Plugin SDK

> **Priority: Low** — For third-party extensibility.

### Planned Capabilities

- **Custom tool types**: NPM package that registers new tools in the tool registry
- **Custom workflow nodes**: Third-party node handlers with UI components
- **Webhook triggers**: Fire webhooks on deliberation events (verdict, conflict, etc.)
- **Provider plugins**: Package-based provider adapters (beyond current EMOF UI approach)

---

## Mobile App

> **Priority: Low** — PWA covers basic mobile usage.

### Planned

- React Native client with shared API
- Push notifications for research job completion, workflow results
- Voice-first interaction mode (STT input, TTS output by default)
- Offline mode with syncing (extending current IndexedDB approach)

---

## Kubernetes & Multi-Region

> **Priority: Low** — Docker Compose covers current scale.

```mermaid
flowchart TB
    LB["Load Balancer"] --> N1["Node 1\nUS-East"]
    LB --> N2["Node 2\nEU-West"]
    LB --> N3["Node 3\nAP-South"]

    N1 --> PG1["PostgreSQL\nPrimary"]
    N2 --> PG2["PostgreSQL\nReplica"]
    N3 --> PG3["PostgreSQL\nReplica"]

    PG1 --> PG2
    PG1 --> PG3

    N1 --> RD["Redis Cluster"]
    N2 --> RD
    N3 --> RD

    style LB fill:#1e293b,stroke:#f59e0b,color:#e2e8f0
    style N1 fill:#1e293b,stroke:#3b82f6,color:#e2e8f0
    style N2 fill:#1e293b,stroke:#3b82f6,color:#e2e8f0
    style N3 fill:#1e293b,stroke:#3b82f6,color:#e2e8f0
    style PG1 fill:#1e293b,stroke:#22c55e,color:#e2e8f0
    style RD fill:#1e293b,stroke:#ef4444,color:#e2e8f0
```

### Goals

- Helm charts for Kubernetes deployment
- Horizontal pod auto-scaling based on queue depth and request latency
- Multi-region PostgreSQL with read replicas
- Redis Cluster for distributed caching and rate limiting
- Health-based routing (route away from degraded regions)

---

## Multi-Tenant & Enterprise

> **Priority: Low** — Single-tenant architecture is sufficient for current use.

### Planned

- **Workspace isolation**: Separate data, configs, and billing per tenant
- **Per-tenant quotas**: Token limits, storage limits, concurrent deliberation limits
- **SSO**: SAML 2.0 and OpenID Connect for enterprise identity providers
- **Audit compliance**: SOC 2 logging format, data retention policies
- **Data residency**: Ensure data stays in specific geographic regions
- **SLA monitoring**: Uptime tracking, latency SLOs, automated alerting

---

<div align="center">

**[Back to README](./README.md)**

</div>

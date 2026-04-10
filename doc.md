# AIbyAI Architecture & Business Audit

## 1. Executive Summary

AIbyAI is a multi-agent deliberation engine designed to eliminate hallucination and sycophancy in Large Language Models (LLMs) through adversarial compute, deterministic scoring, and cryptographic validation. The system does not route user queries to a single model; it orchestrates a "Council" of distinct AI archetypes running on different provider backends (OpenAI, Anthropic, Google, Ollama).

The output is not determined by LLM consensus, but by a deterministic mathematical scoring engine (Cosine Similarity via local ML models). The architecture enforces peer review, anti-convergence safeguards (Bloom Gate), and independent zero-context validation (Cold Validator).

This document serves as an exhaustive, objective audit of the entire repository, detailing the technology stack, the exact request lifecycle, current project status, and a comprehensive file-by-file breakdown including the repository tree.

---

## 2. Current Project Status

Based on the explicit tracking in `ROADMAP.md`, the platform is currently at **Milestone 3 (Observability & Production Stabilization)**.

**Completed Phases:**
*   Phase 1-3: Parallel Execution, Structured Output Contracts, Failure Isolation.
*   Phase 4-9: The Deterministic Deliberation Engine is fully online. Peer Review, Anonymized Ranking, Math-based Scoring Engine, and Multi-Round Refinement (Debate) are complete. The Consensus Metric (Cosine Similarity) is active.
*   Phase 12: Router (Auto-Council selection) is completed.
*   Phase 13, 16, 17: PII Detection, Audit Logging, and Token/Cost Tracking are fully operational.
*   Phase 21: Cold Validator / "Fresh Eyes" independent verification is complete.
*   Phase 22: Local AI Connectors (Ollama, LM Studio via OpenAI-compatible endpoints) are active.

**Pending / In-Progress Phases:**
*   Phase 10: Tool Execution Layer (Planned).
*   Phase 11: Memory + Context System (Planned implementation into agents, though pgvector infrastructure is present).
*   Phase 19-20: Advanced UI Enhancements and Real-Time Cost Ledger visualization are In Progress.

---

## 3. Technology Stack

### Frontend Application
*   **React & Vite:** Single Page Application utilizing rapid HMR.
*   **Tailwind CSS:** Strict utility-first CSS framework enforcing a dark-mode, high-density professional aesthetic (inspired by Manus AI and Deer-Flow).
*   **Server-Sent Events (SSE):** Unidirectional real-time event streaming for token generation, status updates, and live consensus scoring.

### Backend Engine
*   **Node.js & Express:** Core server infrastructure.
*   **TypeScript:** Enforced strict typing across all modules. `any` types are actively suppressed.
*   **Zod:** Runtime schema validation for all API inputs and structured LLM JSON outputs.

### Data & Machine Learning Layer
*   **Prisma ORM & PostgreSQL:** Relational data management for users, configurations, and audit logs.
*   **pgvector:** PostgreSQL extension utilized for storing and querying text embeddings to create the system's long-term semantic memory.
*   **Redis:** High-speed caching, strict rate-limiting, and state management.
*   **Transformers.js / Python Embeddings:** Local execution of embedding models to compute mathematical Cosine Similarity between text responses, removing dependency on external APIs for scoring.

---

## 4. The Deliberation Lifecycle

A single `POST /api/ask/stream` request triggers the following sequence:

1.  **Ingress & Security Check:** `src/middleware/rateLimit.ts` and `src/middleware/validate.ts` execute. `src/lib/pii.ts` scans the payload for sensitive data (SSNs, emails) and redacts/blocks it.
2.  **Auto-Routing:** `src/lib/router.ts` analyzes the query, scores its intent (e.g., Factual, Analytical), and dynamically selects an optimal subset of 2-4 distinct AI archetypes.
3.  **Parallel Generation:** `src/lib/deliberationPhases.ts:gatherOpinions()` executes asynchronous HTTP requests to the selected provider endpoints. Responses stream back via SSE.
4.  **Peer Review & Critique:** `src/lib/deliberationPhases.ts:conductPeerReview()` anonymizes the generated responses and cross-feeds them to the agents for strict JSON critiques.
5.  **Refinement & The Bloom Gate:** Agents refine answers. The system calculates vector drift. If refinement causes models to diverge mathematically from the target consensus, the round is discarded.
6.  **Deterministic Scoring:** `src/lib/scoring.ts` utilizes local ML embedding models to calculate Cosine Similarity.
7.  **Synthesis:** `src/lib/deliberationPhases.ts:synthesizeVerdict()` provides the complete context and scores to a designated "Master" model to generate the final response.
8.  **Cold Validation:** `src/lib/validator.ts` initializes an independent LLM with zero prior context. It evaluates the final synthesis against five strict failure points.
9.  **Audit & Ledger:** `src/lib/cost.ts` calculates the exact fractional cent cost and writes it to the PostgreSQL `AuditLog`.

---

## 5. Repository Structure & File-by-File Audit

### 5.1. The Literal Repository Tree

```text
.
├── .dockerignore
├── .env
├── .env.example
├── .gitignore
├── ARCHITECTURE.md
├── DEPLOYMENT.md
├── Dockerfile
├── README.md
├── ROADMAP.md
├── council.db
├── doc.md
├── docker-compose.yml
├── docs
│   └── API.md
├── eslint.config.js
├── frontend
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   ├── postcss.config.js
│   ├── src
│   │   ├── .env.example
│   │   ├── components
│   │   ├── context
│   │   ├── hooks
│   │   ├── index.css
│   │   ├── layouts
│   │   ├── main.tsx
│   │   ├── router.tsx
│   │   ├── types
│   │   ├── views
│   │   └── vite-env.d.ts
│   ├── tailwind.config.js
│   ├── tsconfig.app.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
├── orchestrator.ts
├── package-lock.json
├── package.json
├── prisma
│   ├── migrations
│   │   └── [Migration SQL files]
│   └── schema.prisma
├── prisma.config.ts
├── scripts
│   ├── [DevOps/Test scripts]
├── src
│   ├── config
│   │   ├── archetypes.ts
│   │   ├── env.ts
│   │   ├── fallbacks.ts
│   │   ├── providerConfig.ts
│   │   ├── providers.json
│   │   └── quotas.ts
│   ├── index.ts
│   ├── lib
│   │   ├── adversarial.ts
│   │   ├── archetypes.ts
│   │   ├── audit.ts
│   │   ├── breaker.ts
│   │   ├── cache
│   │   ├── cache.ts
│   │   ├── configResolver.ts
│   │   ├── context.ts
│   │   ├── controller.ts
│   │   ├── cost.ts
│   │   ├── council.ts
│   │   ├── crypto.ts
│   │   ├── db.ts
│   │   ├── deliberationPhases.ts
│   │   ├── errorMapper.ts
│   │   ├── evaluation.ts
│   │   ├── grounding.ts
│   │   ├── history.ts
│   │   ├── logger.ts
│   │   ├── metrics.ts
│   │   ├── ml
│   │   ├── pii.ts
│   │   ├── providerRegistry.ts
│   │   ├── providers
│   │   ├── providers.ts
│   │   ├── realtimeCost.ts
│   │   ├── redis.ts
│   │   ├── retry.ts
│   │   ├── router.ts
│   │   ├── schemas.ts
│   │   ├── scoring.ts
│   │   ├── socket.ts
│   │   ├── ssrf.ts
│   │   ├── strategies
│   │   ├── sweeper.ts
│   │   ├── templates.ts
│   │   ├── tools
│   │   ├── validation.ts
│   │   └── validator.ts
│   ├── middleware
│   │   ├── auth.ts
│   │   ├── cspNonce.ts
│   │   ├── errorHandler.ts
│   │   ├── limiter.ts
│   │   ├── quota.ts
│   │   ├── rateLimit.ts
│   │   ├── requestId.ts
│   │   └── validate.ts
│   ├── routes
│   │   ├── archetypes.ts
│   │   ├── ask.ts
│   │   ├── auth.ts
│   │   ├── costs.ts
│   │   ├── council.ts
│   │   ├── evaluation.ts
│   │   ├── export.ts
│   │   ├── history.ts
│   │   ├── metrics.ts
│   │   ├── pii.ts
│   │   ├── providers.ts
│   │   ├── realtime.ts
│   │   ├── templates.ts
│   │   └── tts.ts
│   ├── services
│   │   ├── conversationService.ts
│   │   ├── councilService.ts
│   │   └── usageService.ts
│   └── types
│       ├── index.ts
│       └── userConfig.ts
├── tests
│   ├── benchmarks
│   │   ├── benchmarkRunner.ts
│   │   ├── cases
│   │   └── council.test.ts
│   ├── configResolver.test.ts
│   ├── councilService.test.ts
│   ├── edgeCases.test.ts
│   ├── mixedProvider.test.ts
│   ├── providerExecutionSimple.test.ts
│   ├── rpa.test.ts
│   ├── testGoogleConnection.ts
│   ├── verifyConnectors.ts
│   └── verifyMultipleKeys.ts
├── tsconfig.json
├── useCouncilStream.ts
└── vitest.config.ts
```

### 5.2. File Role Breakdown

#### Root Files
*   `.env` / `docker-compose.yml`: Infrastructure configuration for DBs, Redis, and API keys.
*   `ARCHITECTURE.md` / `ROADMAP.md` / `DEPLOYMENT.md`: Strategic, architectural, and operational documentation tracking the project's evolution.
*   `vitest.config.ts` / `eslint.config.js` / `tsconfig.json`: Tooling configurations enforcing strict testing, linting, and TypeScript compilation.

#### `prisma/`
*   `schema.prisma`: The PostgreSQL database structure containing User, AuditLog, and pgvector-enabled tables for long-term memory.

#### `frontend/` (React SPA)
*   `src/main.tsx` / `src/router.tsx`: Bootstrapping and client-side routing.
*   `src/hooks/useCouncilStream.ts`: Establishes the `EventSource` connection to process Server-Sent Events (SSE), enabling the real-time, streaming UI.
*   `src/components/` & `src/views/`: Contains the modular UI panels mapping exactly to the backend deliberation phases (e.g., Debate, Verdict, Cost Tracking).

#### `src/middleware/` (Security & Validation)
*   `rateLimit.ts` / `limiter.ts`: Redis-backed connection throttling.
*   `validate.ts`: Strict Zod schema enforcement for incoming requests.
*   `pii.ts`: Scans all payloads for sensitive data via heuristics to ensure compliance prior to external API transmission.
*   `auth.ts`: JWT verification for secured routes.

#### `src/config/` (Engine Rules)
*   `archetypes.ts`: Defines the distinct system prompts and roles for agents (e.g., "The Critic", "The Synthesizer").
*   `fallbacks.ts`: Defines provider failover routes (Anthropic -> OpenAI -> Ollama).
*   `providerConfig.ts` / `providers.json`: Registry of supported models and their context window configurations.

#### `src/lib/` (The Core Deliberation Engine)
*   `router.ts`: The Auto-Router. Scores user queries and dynamically selects archetypes.
*   `council.ts`: The Orchestrator. Wraps the deliberation pipeline in an `AsyncGenerator` to yield exact SSE payloads to the frontend.
*   `deliberationPhases.ts`: The state machine. Executes `gatherOpinions()` (parallel agent requests), `conductPeerReview()` (structured critiques), and `synthesizeVerdict()`.
*   `scoring.ts`: Executes deterministic Cosine Similarity mathematical matching for consensus evaluation.
*   `ml/` (`embeddings.py`, `ml_worker.ts`): Python/JS interop executing local embedding generation to bypass expensive API calls for vector math.
*   `validator.ts`: The Cold Validator. Instantiates a blind model to audit the final verdict for logic flaws and hallucinations.
*   `adversarial.ts` / `grounding.ts`: Safeguards against groupthink and ensures factual grounding.
*   `cost.ts` / `realtimeCost.ts`: The Ledger. Calculates exact per-token costs based on static tables and writes to the database.
*   `providers.ts` / `providerRegistry.ts`: The Universal Adapter normalizing inputs and outputs across OpenAI, Anthropic, Google, and Ollama.
*   `redis.ts` / `cache/`: Interfaces for high-speed, volatile data storage.

#### `src/routes/` (API Controllers)
*   `ask.ts`: Ingress endpoint triggering the `council.ts` engine.
*   `costs.ts` / `metrics.ts`: Analytics endpoints.
*   `history.ts`: Accesses `pgvector` semantic cache for historical context.

#### `src/services/` (Data Services)
*   `conversationService.ts`: Reads/writes vectorized conversations to Prisma.
*   `usageService.ts`: Commits the financial logic generated by `cost.ts` into the AuditLog.

#### `tests/`
*   `benchmarks/`: Automated tests against known datasets (`factual.json`, `logic.json`) proving the mathematical superiority of the Council over single-LLM queries.
*   `edgeCases.test.ts` / `councilService.test.ts`: Validates failure isolation, fallback mechanisms, and routing logic under stress.

---

## 6. Conclusion

The AIbyAI repository represents a highly defensive, computationally expensive, but mathematically validated approach to Artificial Intelligence. It systematically removes reliance on the unpredictable nature of single-prompt LLMs by enforcing distributed processing, adversarial critique, deterministic scoring, and isolated validation. The architecture is explicitly designed for environments where factual accuracy and logical grounding are strict requirements.
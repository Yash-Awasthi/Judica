# AIbyAI Architecture & Business Audit

## 1. Executive Summary

AIbyAI is a multi-agent deliberation engine designed to eliminate hallucination and sycophancy in Large Language Models (LLMs) through adversarial compute, deterministic scoring, and cryptographic validation. The system does not route user queries to a single model; it orchestrates a "Council" of distinct AI archetypes running on different provider backends (OpenAI, Anthropic, Google, Ollama).

The output is not determined by LLM consensus, but by a deterministic mathematical scoring engine (Cosine Similarity via local ML models). The architecture enforces peer review, anti-convergence safeguards (Bloom Gate), and independent zero-context validation (Cold Validator).

This document serves as an exhaustive, objective audit of the entire repository, detailing the technology stack, the exact request lifecycle, and a comprehensive file-by-file breakdown.

---

## 2. Technology Stack

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

## 3. The Deliberation Lifecycle

A single `POST /api/ask/stream` request triggers the following sequence:

1.  **Ingress & Security Check:** `src/middleware/rateLimit.ts` and `src/middleware/validate.ts` execute. `src/lib/pii.ts` scans the payload for sensitive data (SSNs, emails) and redacts/blocks it.
2.  **Auto-Routing:** `src/lib/router.ts` analyzes the query, scores its intent (e.g., Factual, Analytical), and dynamically selects an optimal subset of 2-4 distinct AI archetypes (defined in `src/config/archetypes.ts`).
3.  **Parallel Generation:** `src/lib/deliberationPhases.ts:gatherOpinions()` executes asynchronous HTTP requests to the selected provider endpoints (OpenAI, Anthropic, etc.). Tool schemas (e.g., `web_search`) are injected. Responses stream back via SSE.
4.  **Peer Review & Critique:** `src/lib/deliberationPhases.ts:conductPeerReview()` anonymizes the generated responses and cross-feeds them to the agents. Agents generate strict `{target, claim, issue, correction}` JSON critiques.
5.  **Refinement & The Bloom Gate:** Agents refine answers based on critiques. The system calculates the vector drift. If the refinement causes the models to diverge mathematically from the target consensus (The Bloom Gate), the round is discarded.
6.  **Deterministic Scoring:** `src/lib/scoring.ts` utilizes local ML embedding models to calculate the Cosine Similarity between the refined answers. An agreement metric of 0.85 (85%) is the target. Final scores combine the mathematical agreement and the peer ranking.
7.  **Synthesis:** `src/lib/deliberationPhases.ts:synthesizeVerdict()` provides the complete context and scores to a designated "Master" model, which generates the final response, strictly barred from introducing unverified facts.
8.  **Cold Validation:** `src/lib/validator.ts` initializes an independent LLM with zero prior context. It evaluates the final synthesis against five strict failure points (e.g., unsupported claims). Any failure triggers a `valid: false` flag.
9.  **Audit & Ledger:** `src/lib/cost.ts` calculates the exact fractional cent cost of the query based on input/output tokens and writes it to the PostgreSQL `AuditLog`. The vectorized conversation is written via `pgvector` for future memory retrieval.

---

## 4. Exhaustive Repository Breakdown

The following is a comprehensive analysis of every file and its architectural purpose within the repository.

### 4.1. Root Configuration Files
*   `.env` / `.env.example`: Stores critical environment variables including database URIs, Redis URLs, and provider API keys (OpenAI, Anthropic, Google).
*   `docker-compose.yml`: Infrastructure orchestration. Spins up PostgreSQL (with pgvector), Redis, and the Node application.
*   `eslint.config.js`: Strict linting rules enforcement.
*   `package.json` / `package-lock.json`: Node dependency management.
*   `tsconfig.json`: TypeScript compiler configuration enforcing strict null checks and type safety.
*   `vitest.config.ts`: Configuration for the Vitest testing framework.
*   `ARCHITECTURE.md` / `ROADMAP.md` / `DEPLOYMENT.md`: High-level system documentation and operational guides.

### 4.2. Database Layer (`prisma/`)
*   `prisma/schema.prisma`: The definitive data schema. Defines models for `User`, `Conversation`, `AuditLog`, and incorporates `pgvector` embedding fields.
*   `prisma/migrations/`: Sequential SQL scripts representing the database schema evolution.
*   `prisma.config.ts`: TypeScript configuration for Prisma Client.

### 4.3. Operations & Scripts (`scripts/`)
Contains automation for infrastructure and CI/CD pipelines.
*   `setup-database.sh`, `setup-docker.sh`, `setup-environment.sh`: Bootstrap scripts for deploying the stack.
*   `rotate-keys.ts`: Security automation for credential rotation.
*   `run-load-tests.sh`, `test-and-benchmark.sh`: CI/CD triggers for performance validation.

### 4.4. Frontend Layer (`frontend/`)
The React application responsible for rendering the complex, streaming UI.
*   `index.html`, `src/main.tsx`: Entry points for the React SPA.
*   `src/router.tsx`: Client-side route definitions.
*   `tailwind.config.js`, `src/index.css`: Design system enforcement.
*   `src/hooks/useCouncilStream.ts`: The critical React Hook that establishes the SSE connection to `/api/ask/stream` and parses incoming chunks into reactive UI state.
*   `src/hooks/useCouncilMembers.ts`, `useDeliberation.ts`: State management hooks.
*   `src/components/`: Modular UI elements.
    *   `ChatArea.tsx`, `InputArea.tsx`: Primary user interaction zones.
    *   `StreamingStatus.tsx`, `MessageList.tsx`: Components that react directly to SSE updates.
    *   `CostTracker.tsx`: Renders live financial data retrieved from the `cost.ts` ledger.
    *   `AuditLogs.tsx`, `EvaluationDashboard.tsx`: Administrative views.
*   `src/views/`: Layout containers (`ChatView.tsx`, `DashboardView.tsx`).

### 4.5. Backend API Layer (`src/api/` & `src/routes/`)
*   `src/routes/ask.ts`: The primary endpoint. Initiates the deliberation state machine.
*   `src/routes/auth.ts`: Authentication endpoints (JWT issuing).
*   `src/routes/history.ts`: Exposes `pgvector` similarity search results to the client.
*   `src/routes/costs.ts`, `metrics.ts`: Analytics and ledger endpoints.
*   `src/routes/council.ts`, `providers.ts`: Configuration endpoints.

### 4.6. Middleware & Security (`src/middleware/`)
*   `src/middleware/rateLimit.ts`, `limiter.ts`: Redis-backed connection throttling to prevent abuse and API exhaustion.
*   `src/middleware/auth.ts`: Validates incoming JWTs.
*   `src/middleware/validate.ts`: Enforces Zod schemas on incoming payloads.
*   `src/middleware/cspNonce.ts`: Content Security Policy injection.

### 4.7. Configuration (`src/config/`)
*   `src/config/archetypes.ts`: Defines the distinct AI personalities and their associated system prompts.
*   `src/config/fallbacks.ts`: Defines the automated failover cascade (e.g., Anthropic -> OpenAI -> Ollama).
*   `src/config/providerConfig.ts`, `providers.json`: Master registry of supported LLM models and APIs.

### 4.8. Core Engine Logic (`src/lib/`)
The monolithic brain of the operation.
*   `src/lib/router.ts`: Implements the Auto-Router heuristic scoring for archetype selection.
*   `src/lib/deliberationPhases.ts`: The state machine. Implements `gatherOpinions()`, `conductPeerReview()`, `conductDebateRound()`, and `synthesizeVerdict()`.
*   `src/lib/council.ts`: Wraps `deliberationPhases.ts` in an `AsyncGenerator` to yield SSE payloads.
*   `src/lib/scoring.ts`: Uses Cosine Similarity to calculate mathematical consensus.
*   `src/lib/ml/embeddings.py`, `ml_worker.ts`: Child processes executing local embedding models to support `scoring.ts`.
*   `src/lib/validator.ts`, `validation.ts`: The Cold Validator implementation. Discards context and audits the synthesis.
*   `src/lib/adversarial.ts`, `grounding.ts`: Modules enforcing logical bounds and preventing hallucinated groupthink.
*   `src/lib/pii.ts`: Pre-flight payload scanner. Blocks execution if sensitive regex patterns are detected.
*   `src/lib/cost.ts`, `realtimeCost.ts`: The financial ledger. Maintains static token cost tables and calculates real-time API spend.
*   `src/lib/providerRegistry.ts`, `providers.ts`: The Universal Provider Adapter. Normalizes inputs/outputs for disparate APIs.
*   `src/lib/strategies/`: Concrete implementations for `openai.ts`, `anthropic.ts`, and `google.ts`.
*   `src/lib/tools/`: The autonomous execution layer. Includes `search.ts` (web scraping), `execute_code.ts`, and `read_webpage.ts`.
*   `src/lib/redis.ts`, `cache/`: High-performance data access patterns.

### 4.9. Services Layer (`src/services/`)
*   `src/services/conversationService.ts`: Interfaces with Prisma to store chats and execute `pgvector` semantic queries.
*   `src/services/usageService.ts`: Writes telemetry and financial data to the `AuditLog` table.

### 4.10. Testing & Benchmarking (`tests/`)
*   `tests/benchmarks/`: Evaluates the Council against standardized datasets (`factual.json`, `logic.json`, `math.json`) to prove the multi-agent system mathematically outperforms single-model queries.
*   `tests/edgeCases.test.ts`, `mixedProvider.test.ts`: Validates failover logic and orchestration stability under stress.

---

## 5. Conclusion

The AIbyAI repository represents a highly defensive, computationally expensive, but mathematically validated approach to Artificial Intelligence. It systematically removes reliance on the unpredictable nature of single-prompt LLMs by enforcing distributed processing, adversarial critique, deterministic scoring, and isolated validation. The architecture is explicitly designed for environments where factual accuracy and logical grounding are strict requirements.
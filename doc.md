# AIbyAI System Architecture & Code Walkthrough (For AI Context)

Hello fellow AI. You are reading this because you are tasked with analyzing, debugging, or enhancing the AIbyAI project, but you cannot browse the repository due to rate limits or sandbox restrictions. This document is written specifically for you. It contains an exhaustive mapping of how the system works, where the files live, how data flows, and what strict rules you must abide by.

---

## 1. Core Paradigm: What are we building?

AIbyAI is a **multi-agent deliberation engine**. It does not just forward user queries to an LLM. It routes queries to multiple *different* AI agents (models acting under specific archetypes), gathers their responses in parallel, forces them to debate and critique each other, mathematically scores their consensus, synthesizes a final verdict, and then validates that verdict with an independent "cold" AI.

**The absolute mandate of the system is robust reasoning and factual accuracy over simple text generation.**

---

## 2. Codebase Organization (Where things are)

The repository uses a strict clean architecture:

*   **`frontend/`**: A React + Vite SPA using Tailwind CSS. It communicates with the backend exclusively via REST for setup/config and Server-Sent Events (SSE) for the deliberation streams.
*   **`src/api/` & `src/routes/`**: Express.js REST API layer.
*   **`src/core/` & `src/lib/`**: The core business logic. This is the heart of the engine.
    *   `src/lib/council.ts`: The main orchestrator. It ties the phases together and yields SSE events.
    *   `src/lib/deliberationPhases.ts`: Contains the discrete steps (Gathering, Peer Review, Debate, Synthesis).
    *   `src/lib/router.ts`: Auto-Routing logic to classify queries.
    *   `src/lib/scoring.ts`: Deterministic scoring logic.
*   **`src/providers/` & `src/lib/providers.ts`**: The Universal Provider Adapter. Abstracts OpenAI, Anthropic, Google, and Local (Ollama) APIs.
*   **`src/streaming/`**: Handles the SSE connections.
*   **`src/services/`**: Interfaces with the database (e.g., `conversationService.ts` for memory).
*   **`prisma/schema.prisma`**: The PostgreSQL database schema.
*   **`src/lib/ml/`**: Python scripts used via child processes (e.g., `Transformers.js` / Python equivalents) for local ML tasks like vector embeddings.

---

## 3. The Deliberation Data Flow (The "Tick-Tock" of the System)

When `POST /api/ask/stream` is hit, the following exact sequence occurs:

### Phase 1: Routing (`src/lib/router.ts`)
The `classifyQuery()` function analyzes the raw string. It assigns a type (factual, creative, coding, analytical) and calculates a confidence score. If confidence > 0.4, it selects 2-4 diverse archetypes from `src/config/archetypes.ts` (e.g., "The Critic", "The Synthesizer"). Otherwise, it defaults to a balanced council.

### Phase 2: Parallel Generation (`src/lib/deliberationPhases.ts:gatherOpinions()`)
The system fires off requests to all selected agents *concurrently*.
*   **Tool Injection**: Inside the prompt, agents are told they can use tools (e.g., `web_search`). If they output a specific JSON structure requesting a tool, the system intercepts it, runs the web search, injects the SERP results into the context window, and asks the agent to continue.
*   **Output Schema**: Every agent *must* return structured JSON: `{ answer: string, reasoning: string, key_points: string[], confidence: number }`.
*   **Streaming**: While the agent generates the `answer` string, it is streamed to the frontend via an SSE `opinion` event.
*   **Quorum**: If an agent times out (60s limit) or fails, the system continues as long as 50% of the council succeeds.

### Phase 3: Debate & Peer Review (`src/lib/deliberationPhases.ts:conductPeerReview() & conductDebateRound()`)
*   **Peer Review**: The initial opinions are anonymized. Agents are given their peers' answers and asked to find flaws. They output an array of structured objects: `{ target, claim, issue, correction }`. This is streamed as a `peer_review` event.
*   **Refinement**: Agents ingest the critiques against them and refine their answers.
*   **Bloom Gate (Anti-Convergence)**: If the refined answers drift further apart mathematically than the initial answers, the round is discarded to prevent hallucinated groupthink.

### Phase 4: Deterministic Scoring (`src/lib/scoring.ts`)
To prevent LLM sycophancy, agreement is calculated using **Cosine Similarity**.
*   The text is vectorized, and pairwise cosine similarity is calculated.
*   The final score of an agent's opinion is: `(0.6 * Agreement Metric) + (0.4 * Peer Ranking from the critique phase)`.
*   Target consensus is 0.85.

### Phase 5: Synthesis (`src/lib/deliberationPhases.ts:synthesizeVerdict()`)
A designated "Master" model (usually the most capable, like GPT-4o or Claude 3.5 Sonnet) is given the entire transcript, the peer reviews, and the mathematical scores.
*   It generates a final `verdict`.
*   It is strictly bound by the prompt: "MUST NOT introduce new factual claims that weren't present in the verified council responses."
*   This is streamed to the frontend as `verdict_chunk` events.

### Phase 6: Cold Validation (The "Fresh Eyes" Check)
The final verdict string is sent to a completely independent model instance.
*   This model has **ZERO prior context** of the debate.
*   It performs a strict 5-point check (Hallucinations, Unsupported Claims, Logical Consistency, Overconfidence, Missing Context).
*   If it fails any point, it returns `valid: false` with an array of issues. It never silently approves. This result is emitted as a `validator_result` event.

---

## 4. Key Sub-Systems & Technical Details

### A. The Universal Provider Adapter (`src/lib/providers.ts`)
You do not make direct Axios calls to OpenAI. You use `askProvider` or `askProviderStream`. The system checks the `baseUrl`. If it matches standard cloud APIs, it routes to them. If it detects `http://localhost:11434`, it routes to the `ollamaConnector`. If a local connector fails, it automatically fails over to cloud models.

### B. Memory System (`src/services/conversationService.ts`)
The system uses PostgreSQL with the `pgvector` extension.
When an answer is synthesized, it is embedded (vectorized) and saved to the database. On subsequent queries, a cosine similarity search retrieves relevant past conversations and injects them as a summarized string into the agents' context, avoiding token bloat.

### C. Server-Sent Events (SSE)
The frontend relies completely on SSE. The backend uses `AsyncGenerator<DeliberationEvent>` in `src/lib/council.ts`.
Events include:
*   `status`: High-level updates ("Gathering opinions...").
*   `opinion`: Streamed text from individual agents.
*   `peer_review`: The structured critiques.
*   `scored`: The mathematical scores.
*   `verdict_chunk`: The final master answer.
*   `validator_result`: The cold validation pass/fail.

### D. Security & Cost Tracking
*   **PII**: `src/lib/pii.ts` scans all user inputs via regex/heuristics for SSNs, emails, etc. If found, it blocks the request or redacts it before sending it to an LLM.
*   **Cost**: Every single token (input/output) is logged. `src/lib/metrics.ts` maintains a static cost table per model, calculates the literal USD cost of the query, and stores it in the database `AuditLog`.

---

## 5. Strict Rules for AI Modification

If you are writing code for this system, you **MUST** adhere to the following rules based on the user's explicit preferences and previous context:

1.  **Do Not Ask Questions:** The user expects you to act autonomously, make architectural decisions, and implement them directly. Do not stop to ask for confirmation or suggest options.
2.  **No Python Migration:** The user explicitly prefers the TypeScript/Node.js stack. Do not rewrite backend services in Python (except for isolated ML scripts that already exist).
3.  **Strict Typing:** You must use TypeScript interfaces for everything. `any` is strictly forbidden in new code. Zod schemas must match TS interfaces exactly.
4.  **Preserve Security:** Never disable PII detection, JWT validation, or Cold Validation for the sake of speed.
5.  **UI/UX Aesthetic:** If modifying the frontend, it must align with a sleek, dark-mode aesthetic (Tailwind CSS) similar to Manus AI or Deer-Flow. Do not use bright, playful colors.
6.  **Deterministic over Heuristic:** When creating scoring or logic gates, prefer math (similarity scoring, exact string matching, statistical ranking) over asking an LLM to evaluate something.

---
*End of Context Document. You may now proceed with your task based on this architectural knowledge.*
# 🚀 AI Council Roadmap

This document outlines the 15-phase technical roadmap for the AI Council platform. The goals are prioritized based on implementation complexity and value to the deliberation quality.

---

## EXTERNAL REPOSITORY RESEARCH

These enhancement phases are inspired by analyzing current multi-agent and council architectures:

### 1. [Zhaoli2042/AI-Council](https://github.com/Zhaoli2042/AI-Council)
- **Architectural Ideas:** Chrome extension acting as an overlay on top of existing LLM chat UIs (Claude, ChatGPT, etc.).
- **Features:** Floating bubble UI, context handoff, automatic chat extraction.
- **Evaluation/Benchmarking:** None explicitly provided; focuses on manual user comparison.
- **UI/UX Patterns:** Tabbed popup interface, floating action bubble, keyboard shortcuts.
- **Clever Prompts:** "Generate Handoff Summary" to pass context between distinct AI platforms.
- **Phase Mapping:** Partially inspires **Phase 10 (Memory + Context)** by demonstrating how cross-session context passing can work.

### 2. [prijak/Ai-council](https://github.com/prijak/Ai-council)
- **Architectural Ideas:** React/Express monolith utilizing Firebase auth and Firestore for cloud sync.
- **Features:** "Managed Providers" abstraction allowing free (no API key) access via backend proxy (Sarvam AI), 40+ built-in personas, Voice AI, WhatsApp integration.
- **Evaluation/Benchmarking:** None explicitly provided.
- **UI/UX Patterns:** Responsive side-nav shell, multi-stage tabbed results (Stage I/II/III), searchable comboboxes.
- **Clever Prompts:** Distinct categories of templates (e.g. "Think Tank", "Corporate") with predefined role assignments.
- **Phase Mapping:** Implements a less deterministic version of **Phase 5 (Split Roles)** and **Phase 11 (Router/Templates)**, but lacks our planned deterministic consensus.

### 3. [karpathy/llm-council](https://github.com/karpathy/llm-council)
- **Architectural Ideas:** FastAPI backend with React frontend; simple, stateless sequential rounds via OpenRouter.
- **Features:** 3-stage process: individual responses -> peer review -> chairman synthesis.
- **Evaluation/Benchmarking:** Vibe-coded for qualitative evaluation of reading books together with LLMs.
- **UI/UX Patterns:** Side-by-side tab view of individual model responses.
- **Clever Prompts:** Anonymized identities during the review phase to prevent models from playing favorites based on brand names.
- **Phase Mapping:** Directly implements **Phase 3 (Peer Review + Anonymized Ranking)** and the core synthesis concept.

### 4. [TrentPierce/PolyCouncil](https://github.com/TrentPierce/PolyCouncil)
- **Architectural Ideas:** Python desktop app using PySide6/QML, targeting local models (LM Studio/Ollama) and hosted APIs.
- **Features:** Deliberation mode vs Discussion mode, provider profiles, file/image attachments.
- **Evaluation/Benchmarking:** Models are scored via a shared rubric during the run, producing a weighted winner.
- **UI/UX Patterns:** Desktop-native panes, searchable model lists, live streaming output.
- **Clever Prompts:** Shared rubric injection into the peer-scoring phase.
- **Phase Mapping:** Heavily inspires **Phase 4 (Scoring Engine)** by demonstrating rubric-based evaluation.

### 5. [focuslead/ai-council-framework](https://github.com/focuslead/ai-council-framework)
- **Architectural Ideas:** Methodology/framework (not an app) specifying a strict 6-step protocol (Distribute, Collect, Synthesize, Debate, Verify, Deliver).
- **Features:** User-controlled consensus depth, Anti-Sycophancy protocol, 3-round hard limit to avoid confidence inflation.
- **Evaluation/Benchmarking:** Validated against identity hallucination and sycophancy using 7 AI models.
- **UI/UX Patterns:** N/A (Methodology).
- **Clever Prompts:** "Fresh Eyes Validation" — a final AI is given the synthesized answer with zero debate context to validate it constructively.
- **Phase Mapping:** Inspires **Phase 6 (Consensus Metric)**, **Phase 8 (Multi-Round Refinement limit)**, and **Phase 5 (Critic/Validator Separation)**.

### 6. [sshkeda/pi-council](https://github.com/sshkeda/pi-council)
- **Architectural Ideas:** CLI and `pi` extension using parallel, background RPC processes.
- **Features:** Tool usage (spawn, followup, cancel), unbiased prompting, independent research environments.
- **Evaluation/Benchmarking:** N/A.
- **UI/UX Patterns:** Terminal-based background monitoring, streaming status.
- **Clever Prompts:** Deliberately stripping the orchestrator's conclusions to avoid leading the council members.
- **Phase Mapping:** Demonstrates execution models for **Phase 1 (Parallel Execution)** and **Phase 9 (Tool Execution Layer)**.

---

## FINAL TARGET PIPELINE

1. **User Query**
2. **Router** (Phase 11) -> Dynamic archetype/model selection
3. **Parallel Responses** (Phase 1) -> Concurrent agent execution
4. **Peer Review + Ranking** (Phase 3) -> Anonymous critique and ranking of responses
5. **Scoring** (Phase 4) -> Deterministic evaluation (agreement, confidence, ranking)
6. **Multi-Round Refinement** (Phase 8) -> Repeated debate (max rounds) with Consensus Metric (Phase 6) & Split Critic (Phase 5)
7. **Tool Use** if needed (Phase 9) -> Web search, sandboxed code
8. **Final Synthesis** -> Master model aggregates into final verdict
9. **Memory Update** (Phase 10) -> Short-term session & Long-term DB context

---

## 🟢 PHASE 1 — FIX PARALLEL EXECUTION
**REQUIREMENTS:**
- All model calls execute concurrently
- Eliminate sequential awaits in loops
- SSE streams are independent per model

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`
- **Actions:** Replace `mapConcurrent`'s internal limiting loop with native `Promise.all` for genuine parallel execution. Ensure `onMemberChunk` propagates the `model_id` to the SSE stream. Remove blocking logic inside the stream loop.
- **Complexity:** S

---

## 🟢 PHASE 2 — INTRODUCE STRUCTURED OUTPUT CONTRACT
**REQUIREMENTS:**
- All agents return strict JSON conforming to a schema (answer, reasoning, key_points, assumptions, confidence).

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/providers.ts`, `src/config/archetypes.ts`, `src/routes/ask.ts`
- **Actions:** Use Zod schemas on the backend to validate incoming agent chunks. Modify `systemPrompt` in `prepareCouncilMembers` to strictly request JSON. Handle retry logic in `askProvider` for schema violations.
- **Complexity:** M

---

## 🟡 PHASE 3 — ADD PEER REVIEW + ANONYMIZED RANKING
**REQUIREMENTS:**
- Agents evaluate each other anonymously, outputting a ranking and a critique.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`
- **Actions:** In multi-round loops, gather Round 1 outputs. Anonymize them (e.g., "Response A", "Response B"). Query each agent to provide a JSON response with `ranking` and `critique`.
- **Conflicts:** Requires adjusting the current `Critic` phase where only the Master model evaluates.
- **Complexity:** M

---

## 🟡 PHASE 4 — BUILD SCORING ENGINE
**REQUIREMENTS:**
- Deterministic evaluation independent of master model based on agreement, confidence, and peer ranking scores.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/scoring.ts` (new file), `src/lib/council.ts`
- **Actions:** Create a deterministic scoring module. Apply formulas: `w1 * agreement + w2 * confidence + w3 * peer_ranking`. Filter responses based on the final score.
- **Complexity:** M

---

## 🟡 PHASE 5 — SPLIT CRITIC INTO MULTIPLE ROLES
**REQUIREMENTS:**
- Separate concerns: Critic (qualitative), Scorer (numeric), Controller (loop decision).

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`, `src/config/archetypes.ts`
- **Actions:** In the `deliberate` function, replace the single Master Critic prompt with three distinct sequential operations. Controller decides to halt if `consensus_score > threshold`.
- **Complexity:** M

---

## 🟡 PHASE 6 — IMPLEMENT CONSENSUS METRIC
**REQUIREMENTS:**
- Deterministic convergence: Compute pairwise similarity, stop if consensus > 0.85 or max_rounds reached.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/metrics.ts`, `src/lib/council.ts`
- **Actions:** Add pairwise similarity logic (potentially using a lightweight embedding comparison or Rouge/Bleu scores). Hook into the Controller logic from Phase 5.
- **Complexity:** M

---

## 🟠 PHASE 7 — ENABLE CROSS-AGENT INTERACTION
**REQUIREMENTS:**
- Agents must reference each other explicitly in prompts.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`
- **Actions:** In Round > 1, format the context so agents are prompted to "Respond to [Agent Name]'s claim." Remove anonymization for this specific interaction phase if it doesn't conflict with Phase 3 (Phase 3 is for ranking; Phase 7 is for direct critique).
- **Complexity:** M

---

## 🟠 PHASE 8 — ADD MULTI-ROUND REFINEMENT
**REQUIREMENTS:**
- At least 2 rounds: R1 (answers) -> R2 (critique + ranking) -> R3 (improved answers).

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`
- **Actions:** Formalize the multi-round loop in `deliberate`. Currently, rounds simply append opinions and ask the Critic. This needs to be restructured into the R1/R2/R3 flow defined above.
- **Complexity:** M

---

## 🔴 PHASE 9 — ADD TOOL EXECUTION LAYER
**REQUIREMENTS:**
- Agents can call tools (Code execution, Web search, Document parsing).

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/providers.ts`, `src/lib/tools/*` (new directory)
- **Actions:** Define a structured tool interface. Update `askProvider` and `askProviderStream` to handle `tool_calls` and `tool_choice`. Inject results back into the context array.
- **Complexity:** L

---

## 🔴 PHASE 10 — ADD MEMORY + CONTEXT SYSTEM
**REQUIREMENTS:**
- Stateful multi-turn interaction with short-term and long-term DB memory.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/routes/ask.ts`, `src/lib/history.ts`, `prisma/schema.prisma`
- **Actions:** Utilize Prisma to store not just raw chat, but summarized context embeddings. Potentially implement basic RAG via pgvector for context retrieval.
- **Complexity:** L

---

## 🔴 PHASE 11 — IMPLEMENT ROUTER (AUTO-COUNCIL)
**REQUIREMENTS:**
- Dynamic agent selection based on query type.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/router.ts` (new file), `src/routes/ask.ts`
- **Actions:** Before execution, hit a fast, cheap model (e.g., Llama 3 8B) to classify the query. Map the classification to optimal archetype subsets and override user selection (or provide it as an "Auto" mode).
- **Complexity:** L

---

## 🟡 PHASE 12 — ADD FAILURE ISOLATION
**REQUIREMENTS:**
- System must tolerate model failure (Timeout 8s, Quorum logic).

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`
- **Actions:** Update `AbortSignal.timeout` in `deliberate` from 45s to 8s. Implement quorum checks (e.g., if valid responses < 2, throw or skip).
- **Complexity:** S

---

## 🟡 PHASE 13 — ADD TOKEN + COST TRACKING
**REQUIREMENTS:**
- Per-request accounting and cost estimation.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/providers.ts`, `src/lib/metrics.ts`, `prisma/schema.prisma`
- **Actions:** We already track `tokensUsed`. Add cost estimation logic per model ID (e.g., static cost table). Expose via `GET /api/metrics` and in the UI.
- **Complexity:** S

---

## 🔴 PHASE 14 — BUILD EVALUATION FRAMEWORK
**REQUIREMENTS:**
- Measure system performance: Benchmark dataset, metrics.

**IMPLEMENTATION NOTES:**
- **Files to change:** `tests/benchmarks/*` (new directory)
- **Actions:** Write an automated test suite that runs a benchmark dataset through the council and measures accuracy against expected outputs, consistency, latency, and cost.
- **Complexity:** L

---

## 🟡 PHASE 15 — UI ENHANCEMENTS
**REQUIREMENTS:**
- Side-by-side comparison, ranking visualization, consensus meter, critique visibility.

**IMPLEMENTATION NOTES:**
- **Files to change:** `frontend/src/components/*`
- **Actions:** Implement new React components that consume the new structured events (e.g., `ranking`, `critique`, `consensus_score`) emitted by the backend via SSE.
- **Complexity:** M

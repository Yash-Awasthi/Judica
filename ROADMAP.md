[ 📖 README ](./README.md) | [ 🗺️ ROADMAP ](./ROADMAP.md)

# 🚀 AI Council Roadmap

This document outlines the technical roadmap for the AI Council platform, along with Atticus-inspired additions and a concrete UI specification. The goals are prioritized based on implementation complexity and value to the deliberation quality.

---

## Planned Features

### Q2 2026
- [ ] Implement Phase 1: Fix Parallel Execution
- [ ] Implement Phase 2: Structured Output Contract
- [ ] Implement Phase 12: Failure Isolation
- [ ] Implement Phase 13: Token + Cost Tracking
- [ ] Implement Atticus Addition A: Real-Time Cost Ledger
- [ ] Implement Atticus Addition C: PII Detection Pre-Send

### Q3 2026
- [ ] Implement Phase 3: Peer Review + Anonymized Ranking
- [ ] Implement Phase 4: Build Scoring Engine
- [ ] Implement Phase 5: Split Critic Into Multiple Roles
- [ ] Implement Phase 6: Implement Consensus Metric
- [ ] Implement Phase 15: UI Enhancements (Tabbed Pane)
- [ ] Implement Atticus Addition B: Cold Validator / "Fresh Eyes"

---

## 🟢 PHASE 1 — FIX PARALLEL EXECUTION
**REQUIREMENTS:**
- All model calls execute concurrently
- Eliminate sequential awaits in loops
- SSE streams are independent per model

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`
- **Actions:** Replace `mapConcurrent`'s internal limiting loop with native `Promise.all` for genuine parallel execution. Tag SSE events with `model_id`. Remove blocking shared stream logic.
- **Validation:** all model responses begin within same timestamp window.
- **Complexity:** S

---

## 🟢 PHASE 2 — INTRODUCE STRUCTURED OUTPUT CONTRACT
**REQUIREMENTS:**
- All agents return strict JSON conforming to a schema.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/providers.ts`, `src/config/archetypes.ts`, `src/routes/ask.ts`
- **Actions:** Enforce via Zod, retry on schema violation, strip free-form outputs. Strict JSON shape: `{ answer, reasoning, key_points, assumptions, confidence (0–1) }`
- **Complexity:** M

---

## 🟡 PHASE 3 — ADD PEER REVIEW + ANONYMIZED RANKING
**REQUIREMENTS:**
- Agents evaluate each other anonymously, outputting a ranking and a critique.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`
- **Actions:** Collect Round 1 outputs, anonymize ("Response A", "Response B"). Each agent outputs: `{ ranking: [id1,id2,id3], critique: string }`.
- **Conflicts:** Adjusts current single-model Critic phase.
- **Complexity:** M

---

## 🟡 PHASE 4 — BUILD SCORING ENGINE
**REQUIREMENTS:**
- Deterministic evaluation based on agreement, confidence, and peer ranking scores.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/scoring.ts` (new file)
- **Actions:** Formula: `final_score = w1*agreement + w2*confidence + w3*peer_ranking`. Filter bottom responses, pass top-k to synthesis.
- **Complexity:** M

---

## 🟡 PHASE 5 — SPLIT CRITIC INTO MULTIPLE ROLES
**REQUIREMENTS:**
- Separate concerns: Critic (qualitative), Scorer (numeric), Controller (loop decision).

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`, `src/config/archetypes.ts`
- **Actions:** Controller logic: if `consensus_score > threshold` → stop; else → next round.
- **Complexity:** M

---

## 🟡 PHASE 6 — IMPLEMENT CONSENSUS METRIC
**REQUIREMENTS:**
- Deterministic convergence: Compute pairwise similarity.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/metrics.ts` (new file)
- **Actions:** Pairwise similarity between responses (lightweight embedding or ROUGE). Stop: `consensus > 0.85` OR `max_rounds` reached.
- **Complexity:** M

---

## 🟠 PHASE 7 — ENABLE CROSS-AGENT INTERACTION
**REQUIREMENTS:**
- Agents must reference each other explicitly in prompts.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`
- **Actions:** Round > 1: prompt agents to address each other by name (e.g. "Respond to [Agent Name]'s claim about X").
- **Complexity:** M

---

## 🟠 PHASE 8 — ADD MULTI-ROUND REFINEMENT
**REQUIREMENTS:**
- Formalize a staged multi-round loop.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts` (restructure `deliberate()` loop)
- **Actions:** R1 (answers) → R2 (critique + ranking) → R3 (improved answers).
- **Complexity:** M

---

## 🔴 PHASE 9 — ADD TOOL EXECUTION LAYER
**REQUIREMENTS:**
- Agents can call tools (Code execution, Web search, Document parsing).

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/tools/` (new directory)
- **Actions:** Update `askProvider` and `askProviderStream` for `tool_calls`. Tools include sandboxed code execution, web search, document parsing.
- **Complexity:** L

---

## 🔴 PHASE 10 — ADD MEMORY + CONTEXT SYSTEM
**REQUIREMENTS:**
- Stateful multi-turn interaction with short-term and long-term DB memory.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/routes/ask.ts`, `src/lib/history.ts`, `prisma/schema.prisma`
- **Actions:** Prisma already in stack — add summarized context storage. Optional: pgvector RAG for context retrieval.
- **Complexity:** L

---

## 🔴 PHASE 11 — IMPLEMENT ROUTER (AUTO-COUNCIL)
**REQUIREMENTS:**
- Dynamic agent selection based on query type.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/router.ts` (new file), `src/routes/ask.ts`
- **Actions:** Fast cheap model classifies query → maps to optimal archetype subset. "Auto" mode override in `ask.ts`.
- **Complexity:** L

---

## 🟡 PHASE 12 — ADD FAILURE ISOLATION
**REQUIREMENTS:**
- System must tolerate model failure.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/council.ts`
- **Actions:** Timeout per model: `AbortSignal.timeout` 45s → 8s. Quorum: if valid responses < 2, skip or throw.
- **Complexity:** S

---

## 🟡 PHASE 13 — ADD TOKEN + COST TRACKING
**REQUIREMENTS:**
- Per-request accounting and cost estimation.

**IMPLEMENTATION NOTES:**
- **Files to change:** `src/lib/providers.ts`, `src/lib/metrics.ts`, `prisma/schema.prisma`
- **Actions:** `tokensUsed` already tracked — add cost estimation (static cost table per model ID). Expose via `GET /api/metrics` and in UI.
- **Complexity:** S

---

## 🔴 PHASE 14 — BUILD EVALUATION FRAMEWORK
**REQUIREMENTS:**
- Measure system performance: Benchmark dataset, metrics.

**IMPLEMENTATION NOTES:**
- **Files to change:** `tests/benchmarks/` (new directory)
- **Actions:** Benchmark dataset + expected outputs. Metrics: accuracy, consistency, latency, cost.
- **Complexity:** L

---

## 🟡 PHASE 15 — UI ENHANCEMENTS
**REQUIREMENTS:**
- Implement new React components consuming structured SSE events.

**IMPLEMENTATION NOTES:**
- **Files to change:** `frontend/src/components/*`
- **Actions:** See §8 Tabbed Pane UI Specification below for full details. New components for ranking, critique, consensus_score.
- **Complexity:** M

---

## §7 — ATTICUS-INSPIRED ADDITIONS

### A — REAL-TIME COST LEDGER (HIGH priority, S complexity)
- **Actions:** Per-query: per-model token accounting (input + output), estimated cost, cumulative session total. Collapsible: compact summary (total + tokens + latency) expands to full per-model breakdown. Color tiers: green <$0.01, amber $0.01–$0.10, red >$0.10.
- **Files:** `src/lib/metrics.ts` (add cost table), `frontend/src/components/CostLedger.tsx` (new)

### B — COLD VALIDATOR / "FRESH EYES" (HIGH priority, M complexity)
- **Actions:** After final synthesis, route the verdict to a SEPARATE model with ZERO prior council context. That model validates cold: checks for errors, hallucinations, overconfidence. New SSE event type: `validator_result`.
- **Files:** `src/lib/council.ts` (add post-synthesis step)

### C — PII DETECTION PRE-SEND (MEDIUM priority, S complexity)
- **Actions:** Before any API call, scan user prompt for PII (email, phone, SSN, credit card, etc.). Surface UI warning with option to anonymize or proceed.
- **Files:** `src/lib/pii.ts` (new), `frontend/src/components/PiiWarning.tsx` (new)

### D — RUNTIME-EDITABLE ARCHETYPES (MEDIUM priority, M complexity)
- **Actions:** Expose archetype system prompts as user-editable JSON/YAML via UI, stored in DB per user.
- **Files:** `prisma/schema.prisma` (new Archetype model), `src/routes/archetypes.ts`, `frontend/src/components/ArchetypeEditor.tsx` (new)

### E — CONVERSATION SEARCH (MEDIUM priority, S complexity)
- **Actions:** Full-text search across past council sessions: query content, archetype names, verdict keywords. Prisma + PostgreSQL supports full-text search natively.
- **Files:** `src/routes/history.ts` (add search endpoint), `frontend/src/components/SearchDialog.tsx` (new)

### F — AUDIT LOG (LOW priority, S complexity)
- **Actions:** Per-request log: full prompt sent to each model, full response received, timing. Viewable in UI alongside cost ledger.
- **Files:** `src/lib/audit.ts` (new), `prisma/schema.prisma` (new AuditLog model)

---

## §8 — TABBED PANE UI SPECIFICATION

A concrete UI design requirement for Phase 15 and the Atticus-inspired additions. Implement a tabbed results panel in the frontend that organizes the deliberation output into the following tabs:

### TAB 1 — "Council" (default active tab)
- All agent responses displayed as cards, one per council member
- Each card shows: agent name + archetype badge, response text (streaming, word-by-word via SSE), confidence score badge, key_points as bullet list, assumptions as collapsible section
- Cards are arranged in a responsive grid (2-col on desktop, 1-col on mobile)
- While streaming: show a pulsing indicator on the active card
- After streaming: show confidence score colored bar (green = high, amber = mid, red = low)

### TAB 2 — "Debate" (visible after Round 2 completes)
- Per-round timeline: Round 1 → Round 2 → Round 3 (if applicable)
- For each round: show each agent's critique of the others, with agent attribution
- Anonymized ranking results: "Response A ranked #1 by 3 agents"
- Cross-agent reference highlights: if Agent B referenced Agent A's claim, show a visual thread between their cards
- Consensus meter: horizontal progress bar showing current consensus score (0 → 0.85 target), updated each round

### TAB 3 — "Verdict"
- Master synthesis output, streaming in real-time
- Below synthesis: Cold Validator result (§7-B) — shown as a "Validator Note" card with green/amber/red status
- Scoring breakdown: table showing each agent's final_score components (agreement / confidence / peer_ranking)
- Which agents were included in synthesis (top-k) vs filtered out

### TAB 4 — "Cost & Audit"
- Cost Ledger (§7-A): per-model token usage + cost, cumulative total, color-coded tiers
- Latency breakdown: time-to-first-token and total time per model
- Audit Log (§7-F): collapsible per-agent sections showing exact prompt sent and raw response received
- Export button: download full audit log as JSON

### TAB 5 — "Config" (inline, no page nav)
- Active council template name + members list
- Per-member: archetype name, model assigned, role, editable system prompt (§7-D)
- Router classification result (§6 Phase 11): what query type was detected, which archetypes were auto-selected and why
- PII detection status: clean / warning (§7-C)

**Implementation Notes:**
- Use React tabs (shadcn/ui Tabs component or simple state-driven tab switcher).
- Tab bar is sticky at the top of the results panel.
- Tabs 2, 3, 4 are disabled/grayed until the relevant data is available.
- Entire tabbed panel is driven by SSE events.
- Files: `frontend/src/components/tabs/`, `frontend/src/types/events.ts`
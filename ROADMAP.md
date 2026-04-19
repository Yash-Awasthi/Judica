<div align="center">

# AIBYAI — Development Roadmap

**Multi-Agent Deliberative Intelligence Platform**

[![Phase 1](https://img.shields.io/badge/Phase_1-Complete-22C55E?style=flat-square)](#phase-1-bloom-gate--ml-scoring)
[![Phase 2](https://img.shields.io/badge/Phase_2-Complete-22C55E?style=flat-square)](#phase-2-master-synthesis--cold-validation)
[![Phase 3](https://img.shields.io/badge/Phase_3-Complete-22C55E?style=flat-square)](#phase-3-rag-intelligence-layer)
[![Phase 4](https://img.shields.io/badge/Phase_4-Complete-22C55E?style=flat-square)](#phase-4-agentic-memory--context-handling)
[![Phase 5](https://img.shields.io/badge/Phase_5-Complete-22C55E?style=flat-square)](#phase-5-workflow-engine)
[![Phase 6](https://img.shields.io/badge/Phase_6-Complete-22C55E?style=flat-square)](#phase-6-agent-skills--autonomy)
[![Phase 7](https://img.shields.io/badge/Phase_7-Complete-22C55E?style=flat-square)](#phase-7-frontend-uiux-refinement)
[![Phase 8](https://img.shields.io/badge/Phase_8-Complete-22C55E?style=flat-square)](#phase-8-real-time-collaboration--human-in-the-loop)
[![Phase 9](https://img.shields.io/badge/Phase_9-Complete-22C55E?style=flat-square)](#phase-9-final-polish-accessibility--cicd)

</div>

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Shipped |
| 🔄 | In Progress |
| 🔵 | Planned |

---

## Phase 1: Bloom Gate & ML Scoring

> Prevents artificial consensus collapse; replaces fragile keyword matching with verifiable semantic scoring.

| Feature | Status | Implementation |
|---------|--------|---------------|
| **Bloom Gate** — halt debate if consensus degrades round-over-round | ✅ | `src/lib/council.ts` — `controller.decide()` checks per-round delta |
| **Deterministic ML Scoring** — Transformers.js cosine similarity | ✅ | `src/lib/scoring.ts` + `src/lib/ml/ml_worker.ts` (Python subprocess) |
| **Pairwise Claim Comparison** — discrete fact extraction, 1–5 severity | ✅ | `src/agents/conflictDetector.ts` — severity enforced at lines 110, 146 |
| **Devil's Advocate Archetype** — forced adversarial peer review agent | ✅ | `src/config/archetypes.ts` + `src/agents/orchestrator.ts` |

---

## Phase 2: Master Synthesis & Cold Validation

> Reliability-weighted synthesis and unbiased hallucination auditing.

| Feature | Status | Implementation |
|---------|--------|---------------|
| **Reliability-Weighted Synthesis** — historical accuracy scoring matrix | ✅ | `src/lib/deliberationPhases.ts` — `synthesizeVerdict()` with reliability scores |
| **Zero-Context Cold Validation** — receives only final synthesis, outputs pass/fail JSON | ✅ | `src/lib/deliberationPhases.ts` — independent validator agent |
| **Confidence Formula** — `claimScore × 0.6 + debateScore × 0.3 + diversityBonus × 0.1` | ✅ | `src/lib/metrics.ts` — `computeConsensus()` |

---

## Phase 3: RAG Intelligence Layer

> Five-stage retrieval pipeline with semantic + keyword fusion.

| Feature | Status | Implementation |
|---------|--------|---------------|
| **Multi-stage Retrieval** — pgvector + BM25 merged via RRF | ✅ | `src/services/vectorStore.service.ts` |
| **HyDE Integration** — hypothetical answer embedding pre-search | ✅ | `src/services/vectorStore.service.ts` — `hydeSearch()` |
| **Adaptive K & Parent-Child Chunking** — complexity-scaled retrieval | ✅ | `src/services/adaptiveK.service.ts` + `src/services/chunker.service.ts` |
| **Cohere Reranking** — cross-encoder reorder post-retrieval | ✅ | `src/services/reranker.service.ts` |

---

## Phase 4: Agentic Memory & Context Handling

> Persistent, decaying, cross-session memory with background synthesis.

| Feature | Status | Implementation |
|---------|--------|---------------|
| **Cross-Conversation Topic Graph** — LLM-extracted topics linked via edges | ✅ | `src/services/topicGraph.service.ts` |
| **Multi-Backend Vector Memory** — local / Qdrant / pgvector routing | ✅ | `src/services/memoryRouter.service.ts` |
| **Temporal Decay & Adaptive Recall** — 14-day half-life cron | ✅ | `src/lib/memoryCrons.ts` |
| **Subconscious Background Synthesis** — dormant logs → knowledge graph nodes | ✅ | `src/queue/workers.ts` — `compactionWorker` via BullMQ |

---

## Phase 5: Workflow Engine

> No-code DAG canvas with topologically ordered, self-healing execution.

| Feature | Status | Implementation |
|---------|--------|---------------|
| **Drag-and-Drop Canvas** — React Flow with configurable node types | ✅ | `frontend/src/components/workflow/` |
| **Topological Execution** — Kahn's algorithm + `Promise.all` parallel branches | ✅ | `src/workflow/executor.ts` — `buildExecutionLevels()` |
| **12 Node Handlers** — LLM, Tool, Condition, Loop, HTTP, Code, Gate, Split, Merge, Template, Input, Output | ✅ | `src/workflow/nodes/` |
| **Self-Healing Agentic Workflows** — error → recovery LLM node → retry | ✅ | `src/workflow/executor.ts` — `recoverNode()` |

---

## Phase 6: Agent Skills & Autonomy

> Compound task decomposition, probabilistic thought exploration, and agentic tool use.

| Feature | Status | Implementation |
|---------|--------|---------------|
| **Goal Decomposition Engine** — LLM breaks goals into 3–8 DAG subtasks | ✅ | `src/services/goalDecomposition.service.ts` |
| **Monte Carlo Thought Trees (MCTS)** — parallel branch simulation, ML-scored pruning | ✅ | `src/services/goalDecomposition.service.ts` — `runMCTS()` |
| **Tool Chaining** — sequential output-piping across tool steps | ✅ | `src/services/toolChain.service.ts` |
| **Code Sandbox Deep Hardening** — seccomp-bpf, bubblewrap, ulimit | ✅ | `src/sandbox/pythonSandbox.ts` + `src/sandbox/seccomp.ts` |

---

## Phase 7: Frontend UI/UX Refinement

> Premium deliberation interface with live streaming and rich visualizations.

| Feature | Status | Implementation |
|---------|--------|---------------|
| **Visual Patterns** — modern agentic-framework aesthetics with Framer Motion | ✅ | `frontend/src/` — Tailwind 4 + dark/light CSS design tokens |
| **Interactive Deliberation UI** — live SSE token stream, contradiction mapping | ✅ | `frontend/src/views/DebateDashboardView.tsx` |
| **Mindmap & Mermaid Rendering** — Mermaid diagrams + ECharts embedded in Markdown | ✅ | `frontend/src/components/MessageList.tsx` + react-markdown |

---

## Phase 8: Real-Time Collaboration & Human-in-the-Loop

> Shared council sessions, HITL safety gates, and democratic synthesis overlay.

| Feature | Status | Implementation |
|---------|--------|---------------|
| **Multi-User WebSockets** — cursors, typing indicators, shared sessions | ✅ | `src/services/livePresence.service.ts` + native `ws` |
| **Human-in-the-Loop Gates** — pause → DB-persisted pending → manual approval | ✅ | `src/services/hitlGates.service.ts` |
| **User Annotations & Democratic Voting** — threaded replies + synthesis vote layer | ✅ | `src/services/annotations.service.ts` + `src/services/synthesisVoting.service.ts` |

---

## Phase 9: Final Polish, Accessibility & CI/CD

> WCAG 2.1 AA compliance, comprehensive test coverage, and production observability.

| Feature | Status | Implementation |
|---------|--------|---------------|
| **Accessibility Audit** — ARIA, focus-visible, reduced-motion, screen reader tested | ✅ | `frontend/src/index.css` + all UI components |
| **Comprehensive Test Coverage** — 2700+ tests, Vitest + Playwright E2E | ✅ | `tests/` — unit, integration, load, E2E |
| **Deployment & Observability** — Docker multi-stage, Prometheus, Grafana dashboards | ✅ | `src/lib/prometheusMetrics.ts` + `grafana/` + `Dockerfile` |

---

<div align="center">

**[Back to README](./README.md)** · [Report a Bug](https://github.com/Yash-Awasthi/aibyai/issues) · [Request a Feature](https://github.com/Yash-Awasthi/aibyai/issues)

</div>

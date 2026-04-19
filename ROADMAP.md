<div align="center">

# AIBYAI 13-Tier Caveman Build Plan

### Status

*Execution must strictly follow the sequential order of phases, as each phase unlocks the next.*

</div>

---

## The 13-Tier Roadmap (Pending Phases)

### Phase 5: Bloom Gate Anti-Convergence & ML Scoring
- [ ] **Implement Bloom Gate mechanism:** Enforce quality control during debate rounds to prevent premature agent convergence. If a round's consensus drops below the previous round's score, halt refinement and proceed to synthesis.
- [ ] **Deterministic ML Scoring:** Replace the fallback keyword overlap logic with an actual ML worker (`ml_worker.py` utilizing `Transformers.js` or a local ONNX model) to compute semantic cosine similarity across agent outputs.
- [ ] **Pairwise claim comparison refinement:** Enhance the conflict detector (`src/agents/conflictDetector.ts`) to rigorously compare factual claims pair-by-pair and assign 1–5 severity scale contradiction scores.

### Phase 6: Master Synthesis & Cold Validation
- [ ] **Master Synthesis algorithm:** Finalize the logic in `synthesizeVerdict` to reliably merge agent opinions using reliability-weighted scoring (giving higher weight to agents with fewer tool errors and fewer historical concessions).
- [ ] **Zero-Context Cold Validation:** Finalize the independent Cold Validator agent check that runs outside the deliberation context to strictly audit the final synthesis for hallucinations, unsupported claims, and overconfidence.
- [ ] **Final verdict confidence score:** Implement the formula `(claimScore × 0.6 + debateScore × 0.3 + diversityBonus × 0.1)` to output a deterministic, trustworthy confidence number to the user.

### Phase 7: RAG Intelligence Layer (Onyx / AnythingLLM Patterns)
- [ ] **Advanced Multi-stage Retrieval:** Finalize the pipeline combining Hybrid Search (pgvector similarity + BM25 keyword matching) and merge results via Reciprocal Rank Fusion (RRF).
- [ ] **HyDE Integration:** Implement Hypothetical Document Embeddings (HyDE) for abstract/conceptual queries to generate hypothetical answers before vector search.
- [ ] **Adaptive K & Chunking:** Implement parent-child chunking (1536/512 chars) to retain broader context. Implement an adaptive K selector that chooses retrieval limits based on query complexity (e.g., K=3 for simple, K=12 for complex).
- [ ] **Cohere Reranking:** Add an optional Cohere reranker integration step to reorder the final retrieved chunks for maximum semantic relevance.

### Phase 8: Agentic Memory & Context Handling
- [ ] **Cross-conversation topic graph linking:** Build out `src/services/topicGraph.service.ts` to extract topics using LLMs and establish source/target edges linking related historical conversations.
- [ ] **Multi-Backend Vector Memory:** Ensure the `memoryRouter` gracefully scales between local memory, Qdrant REST client endpoints, and native pgvector schemas.
- [ ] **Temporal decay & Adaptive recall:** Implement background sweepers (`src/lib/memoryCrons.ts`) to decay the relevance of older context chunks (e.g., 14-day half-life) while surfacing heavily accessed facts.

### Phase 9: Workflow Engine (Dify / Flowise / Langflow Patterns)
- [ ] **Drag-and-drop canvas implementation:** Build out the frontend UI utilizing `React Flow` to visualize workflows with draggable, configurable nodes (`LLMNode.tsx`, `ToolNode.tsx`, etc.).
- [ ] **Topological Execution:** Finalize the backend DAG executor (`src/workflow/executor.ts`) to process nodes in correct dependency order (Kahn's algorithm) while ensuring parallel-safe branches execute concurrently.
- [ ] **Node Handlers:** Implement handlers for 12 core node types including HTTP requests (with SSRF protection), Code, Condition, Loop, Split, Merge, and Human Gates.

### Phase 10: Agent Skills & Autonomy (MetaGPT / CAMEL / OWU Patterns)
- [ ] **Goal Decomposition Engine:** Expand `src/services/goalDecomposition.service.ts` to break complex queries into a DAG of 3-8 subtasks, assigning specific archetypes and tracking progress.
- [ ] **Tool Chaining:** Implement autonomous sequencing where the output of one tool seamlessly pipes into the input of the next (e.g., web search -> extraction -> analysis -> chart generation).
- [ ] **Code Sandbox Deep Hardening:** Finalize the Python Sandbox (`src/sandbox/pythonSandbox.ts` and `seccomp.ts`) to enforce strict isolation via seccomp-bpf (killing dangerous syscalls like `ptrace`, `mount`), bubblewrap, and `ulimit` restrictions.

### Phase 11: Frontend UI/UX Refinement
- [ ] **Visual Patterns:** Update Tailwind layouts and framer-motion animations to mirror the clean aesthetics of Manus AI, Deer-Flow, Lobe Chat, and Chatbox.
- [ ] **Interactive Deliberation UI:** Develop the `DebateDashboardView.tsx` to visualize agent arguments, real-time token streaming, and cross-agent contradiction resolutions in real-time.
- [ ] **Mindmap & Mermaid Rendering:** Enhance the frontend Markdown parser to dynamically render Markdown-embedded Mermaid state diagrams, sequence diagrams, and ECharts components.

### Phase 12: Real-Time Collaboration & Human-in-the-Loop
- [ ] **Multi-user WebSockets:** Implement native WebSocket presence (`src/services/livePresence.service.ts`) to track cursors, typing indicators, and shared sessions.
- [ ] **Human-in-the-Loop (HITL) Gates:** Finish `src/services/hitlGates.service.ts` to allow autonomous execution to pause for manual approval, review, or escalation within configured timeouts.
- [ ] **User Annotations & Voting:** Implement threaded replies, reactions to specific agent claims, and democratic synthesis voting (quorum logic) on top of the AI's determined consensus.

### Phase 13: Final Polish, Accessibility & CI/CD
- [ ] **Accessibility Audit:** Perform manual screen reader testing (VoiceOver/NVDA) and ensure ARIA labels are correctly applied across the complex workflow and chat UIs.
- [ ] **Comprehensive Test Coverage:** Ensure the Vitest and Playwright test suites fully cover integration pathways for the completed orchestration and routing DAGs.
- [ ] **Deployment & Observability:** Finalize Docker multi-stage builds, Prometheus metrics (`src/lib/prometheusMetrics.ts`), and Grafana dashboard provisioning for observability of token usage, costs, and queue lengths.

---

<div align="center">

**[Back to README](./README.md)**

</div>

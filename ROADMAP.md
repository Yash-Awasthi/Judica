<div align="center">

# AIBYAI 13-Tier Caveman Build Plan

### Status

*Execution must strictly follow the sequential order of phases, as each phase unlocks the next.*

</div>

---

## The 13-Tier Roadmap (Pending Phases)

### Phase 5: Bloom Gate Anti-Convergence & ML Scoring

- [ ] #### Implement Bloom Gate mechanism
  - **How:** Modify `src/lib/council.ts` to track the consensus score from the previous debate round. If the current round's consensus drops below the previous round's score or degrades beyond a defined threshold, trigger an early exit and halt further refinement, proceeding immediately to synthesis.
  - **Why:** To prevent agent convergence decay where agents agree just to agree, or where a subsequent debate round reduces the quality and logical consistency of the outputs.

- [ ] #### Deterministic ML Scoring
  - **How:** Replace the fallback keyword overlap logic in `src/lib/scoring.ts` with a call to an actual ML worker (`src/lib/ml/ml_worker.ts`). This worker should utilize a local python process or `Transformers.js` to compute deterministic semantic cosine similarity across agent outputs.
  - **Why:** Keyword overlap is fragile and easily tricked by paraphrasing. A semantic ML model accurately gauges true conceptual agreement, making the consensus score highly trustworthy.

- [ ] #### Pairwise claim comparison refinement
  - **How:** Enhance `src/agents/conflictDetector.ts` to extract discrete factual claims from agent outputs, rigorously compare them pair-by-pair, and assign a 1–5 severity scale score for contradictions.
  - **Why:** To isolate exactly *what* the agents disagree on rather than just knowing that they generally disagree, allowing for targeted, productive debate rounds.

### Phase 6: Master Synthesis & Cold Validation

- [ ] #### Master Synthesis algorithm
  - **How:** Update `synthesizeVerdict` in `src/lib/deliberationPhases.ts` to merge agent opinions using a reliability-weighted scoring matrix. Agents with fewer tool errors and fewer historical concessions will have a heavier mathematical weight in the final output generation.
  - **Why:** Not all agents are equally reliable. Weighting by historical accuracy ensures that the synthesis heavily favors the most consistently correct archetypes rather than treating all models equally.

- [ ] #### Zero-Context Cold Validation
  - **How:** Finalize the independent Cold Validator agent check that runs outside the deliberation context. It will receive only the final synthesis and strictly audit it for hallucinations, unsupported claims, and overconfidence, outputting a strict JSON pass/fail matrix.
  - **Why:** To act as a final safety net. Because it has zero context of the preceding debate, it cannot be biased by the agents' internal logic, providing a pure, objective check for hallucinations.

- [ ] #### Final verdict confidence score
  - **How:** Implement the formula `(claimScore × 0.6 + debateScore × 0.3 + diversityBonus × 0.1)` to calculate the final confidence number.
  - **Why:** Users need a quantifiable, numerical metric they can trust. Exposing the exact math behind the confidence score builds transparency and trust in the platform's outputs.

### Phase 7: RAG Intelligence Layer (Onyx / AnythingLLM Patterns)

- [ ] #### Advanced Multi-stage Retrieval
  - **How:** Finalize the pipeline combining Hybrid Search (pgvector similarity + PostgreSQL BM25 keyword matching) and merge the results via Reciprocal Rank Fusion (RRF) in `src/services/vectorStore.service.ts`.
  - **Why:** Relying purely on vector similarity misses exact-match keywords (like UUIDs or specific names). Combining both search methods ensures high recall across all query types.

- [ ] #### HyDE Integration
  - **How:** Implement Hypothetical Document Embeddings (HyDE) for abstract/conceptual queries in `src/services/vectorStore.service.ts`. The system will generate a hypothetical LLM answer first, embed that answer, and use it to search the vector database.
  - **Why:** User queries are often short and lack context. Embedding a hypothetical "perfect answer" bridges the semantic gap, retrieving much more relevant context chunks for abstract questions.

- [ ] #### Adaptive K & Chunking
  - **How:** Implement parent-child chunking (e.g., 1536 char parent / 512 char child) in `src/services/chunker.service.ts`. Implement an adaptive K selector (`src/services/adaptiveK.service.ts`) that chooses retrieval limits based on query complexity (K=3 for simple, K=12 for complex).
  - **Why:** Returning massive contexts for simple questions wastes tokens and confuses the LLM. Adaptive K ensures the LLM receives exactly the amount of context it needs, while parent-child chunking ensures that small semantic hits return the broader surrounding text for complete understanding.

- [ ] #### Cohere Reranking
  - **How:** Add an optional Cohere reranker integration step (`src/services/reranker.service.ts`) to reorder the final retrieved chunks post-retrieval for maximum semantic relevance.
  - **Why:** Standard vector databases retrieve well but rank poorly. A dedicated Cross-Encoder reranker drastically improves the precision of the top 5 documents fed into the deliberation engine.

### Phase 8: Agentic Memory & Context Handling

- [ ] #### Cross-conversation topic graph linking
  - **How:** Build out `src/services/topicGraph.service.ts` to extract topics using LLMs and establish source/target edges in the `topicEdges` database table, linking related historical conversations together.
  - **Why:** To provide the AI with continuous context. If a user asks a question about "Project X," the AI should instantly recall relevant decisions made about "Project X" in a conversation from three weeks ago.

- [ ] #### Multi-Backend Vector Memory
  - **How:** Ensure `src/services/memoryRouter.service.ts` gracefully routes operations between local memory, Qdrant REST client endpoints, and native pgvector schemas based on the user's configured backend preference.
  - **Why:** Different environments have different scaling needs. Supporting both a robust built-in vector store (pgvector) and a scalable external one (Qdrant) prevents vendor lock-in.

- [ ] #### Temporal decay & Adaptive recall
  - **How:** Implement background cron jobs (`src/lib/memoryCrons.ts`) to decay the strength/relevance of older context chunks (e.g., a 14-day half-life) while maintaining or boosting the strength of heavily accessed facts.
  - **Why:** As context window size increases, noise increases. Temporal decay ensures that outdated information naturally fades away, preventing the AI from hallucinating based on stale facts.

### Phase 9: Workflow Engine (Dify / Flowise / Langflow Patterns)

- [ ] #### Drag-and-drop canvas implementation
  - **How:** Build out the frontend UI utilizing `React Flow` to visualize workflows. Create draggable, configurable custom React components for `LLMNode.tsx`, `ToolNode.tsx`, `ConditionNode.tsx`, etc.
  - **Why:** To democratize agent creation. A visual, no-code/low-code interface allows non-engineers to construct complex, multi-agent AI workflows easily.

- [ ] #### Topological Execution
  - **How:** Finalize the backend DAG executor (`src/workflow/executor.ts`) to process nodes in correct dependency order utilizing Kahn's algorithm, ensuring parallel-safe branches execute concurrently via `Promise.all`.
  - **Why:** Complex workflows require precise execution ordering. A robust topological sort guarantees that a node never executes before its dependencies are fully resolved.

- [ ] #### Node Handlers
  - **How:** Implement the backend execution handlers for 12 core node types (e.g., `src/workflow/nodes/http.handler.ts`) including strict validation, state passing, and Server-Side Request Forgery (SSRF) protection for network calls.
  - **Why:** To make the workflow engine actually functional and secure. SSRF protection is critical to prevent malicious workflows from accessing internal infrastructure.

### Phase 10: Agent Skills & Autonomy (MetaGPT / CAMEL / OWU Patterns)

- [ ] #### Goal Decomposition Engine
  - **How:** Expand `src/services/goalDecomposition.service.ts` to take high-level user prompts and use an LLM to break them into a DAG of 3-8 concrete subtasks, assigning specific archetypes and tracking step-by-step progress.
  - **Why:** LLMs struggle with massive, multi-step tasks. Breaking a goal into smaller, modular subtasks ensures higher accuracy, easier debugging, and allows specialized agents to handle specific pieces.

- [ ] #### Tool Chaining
  - **How:** Implement autonomous sequencing in `src/services/toolChain.service.ts` where the output of one tool seamlessly pipes into the input of the next (e.g., web search -> extraction -> analysis -> chart generation).
  - **Why:** To provide true agentic autonomy. The AI must be able to chain operations together to solve complex problems without requiring human intervention at every step.

- [ ] #### Code Sandbox Deep Hardening
  - **How:** Finalize the Python Sandbox (`src/sandbox/pythonSandbox.ts` and `src/sandbox/seccomp.ts`) to enforce strict isolation via seccomp-bpf (killing dangerous syscalls like `ptrace`, `mount`), bubblewrap namespaces, and `ulimit` resource constraints.
  - **Why:** Executing AI-generated code is inherently dangerous. Deep defense-in-depth isolation ensures that even if an agent writes malicious code, it cannot escape the sandbox or harm the host machine.

### Phase 11: Frontend UI/UX Refinement

- [ ] #### Visual Patterns
  - **How:** Update Tailwind classes and `framer-motion` animations across the frontend components to mirror the clean, modern aesthetics of Manus AI, Deer-Flow, Lobe Chat, and Chatbox.
  - **Why:** A premium, polished UI significantly improves perceived trust and user experience, which is critical for an application meant to deliver high-confidence AI verdicts.

- [ ] #### Interactive Deliberation UI
  - **How:** Develop the `DebateDashboardView.tsx` component to visualize agent arguments, render real-time token streaming via Server-Sent Events (SSE), and visually map cross-agent contradiction resolutions in real-time.
  - **Why:** To demystify the AI "black box." Showing the user exactly how the agents are arguing and arriving at a conclusion is the core value proposition of the platform.

- [ ] #### Mindmap & Mermaid Rendering
  - **How:** Enhance the frontend Markdown parser (`react-markdown` plugins) to dynamically render Markdown-embedded Mermaid state diagrams, sequence diagrams, and interactive ECharts components.
  - **Why:** Text walls are hard to parse. Visualizing complex logic, timelines, and data architectures via diagrams makes the AI's output instantly comprehensible.

### Phase 12: Real-Time Collaboration & Human-in-the-Loop

- [ ] #### Multi-user WebSockets
  - **How:** Implement native WebSocket presence in `src/services/livePresence.service.ts` to track cursors, typing indicators, and manage shared multi-user council sessions.
  - **Why:** To enable team collaboration. Teams should be able to watch a deliberation unfold together, just like working in a shared Google Doc.

- [ ] #### Human-in-the-Loop (HITL) Gates
  - **How:** Finish `src/services/hitlGates.service.ts` to allow autonomous execution workflows to pause. The system will store a pending state in the database and wait for manual approval, review, or escalation within configured timeouts.
  - **Why:** High-stakes tasks (like executing a destructive API call or sending an email) require human oversight. HITL gates provide necessary safety checkpoints in autonomous workflows.

- [ ] #### User Annotations & Voting
  - **How:** Implement threaded replies and reactions to specific agent claims in the frontend, and add a backend system for democratic synthesis voting (quorum logic) to layer human consensus on top of the AI's consensus.
  - **Why:** To blend human expertise with AI deliberation. Allowing human reviewers to flag specific AI claims or vote on the final verdict ensures the final output aligns with human alignment and domain knowledge.

### Phase 13: Final Polish, Accessibility & CI/CD

- [ ] #### Accessibility Audit
  - **How:** Perform manual screen reader testing (VoiceOver/NVDA) and ensure ARIA labels, focus states, and color contrasts are correctly applied across the complex workflow and chat UIs.
  - **Why:** To ensure the platform is usable by everyone, meeting compliance standards and providing a professional-grade user experience for users with disabilities.

- [ ] #### Comprehensive Test Coverage
  - **How:** Expand the Vitest and Playwright test suites to fully cover integration pathways for the completed orchestration DAGs, checking for edge cases in debate resolution and tool failures.
  - **Why:** To ensure long-term stability. A highly complex multi-agent orchestrator is prone to regressions; comprehensive testing is mandatory to guarantee reliability.

- [ ] #### Deployment & Observability
  - **How:** Finalize Docker multi-stage builds. Implement Prometheus metrics (`src/lib/prometheusMetrics.ts`) and provision Grafana dashboards for deep observability of token usage, latency, costs, and queue lengths.
  - **Why:** To make the application production-ready. Administrators need deep visibility into system performance and API costs to manage the platform effectively at scale.

---

<div align="center">

**[Back to README](./README.md)**

</div>

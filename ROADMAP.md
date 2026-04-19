<div align="center">

# AIBYAI Development Roadmap

### Status

*Execution must strictly follow the sequential order of phases, as each phase unlocks the next.*

</div>

---

## The Roadmap (Pending Phases)

### Phase 1: Bloom Gate & ML Scoring

- [ ] #### Implement Bloom Gate mechanism
  - **How:** Modify `src/lib/council.ts` to halt debate rounds if the current consensus score degrades compared to the previous round, proceeding directly to synthesis.
  - **Why:** Prevents artificial agent convergence and logic degradation during subsequent debate rounds.

- [ ] #### Deterministic ML Scoring
  - **How:** Replace fallback keyword matching in `src/lib/scoring.ts` with a dedicated ML worker (`src/lib/ml/ml_worker.ts`) using `Transformers.js` to compute semantic cosine similarity across agent outputs.
  - **Why:** Keyword matching is fragile. Semantic cosine similarity provides robust, mathematically verifiable consensus tracking.

- [ ] #### Pairwise claim comparison refinement
  - **How:** Enhance `src/agents/conflictDetector.ts` to extract discrete factual claims from agent outputs, rigorously compare them pair-by-pair, and assign a 1–5 severity scale score.
  - **Why:** Isolates specific points of disagreement rather than broad discordance, enabling targeted and productive debate rounds.

- [ ] #### Dedicated Adversarial Red-Team Agent
  - **How:** Introduce a "Devil's Advocate" archetype into `src/agents/orchestrator.ts`. Its sole objective during Peer Review is to identify edge cases, logical fallacies, and security risks in other agents' claims.
  - **Why:** Standard LLMs tend to be overly agreeable. A forced adversarial perspective stress-tests outputs, elevating the robustness of the final synthesis.

### Phase 2: Master Synthesis & Cold Validation

- [ ] #### Master Synthesis algorithm
  - **How:** Update `synthesizeVerdict` in `src/lib/deliberationPhases.ts` to merge agent opinions using a reliability-weighted scoring matrix based on historical agent accuracy and tool error rates.
  - **Why:** Ensures the final synthesis heavily favors the most consistently accurate archetypes, rather than weighting all models equally.

- [ ] #### Zero-Context Cold Validation
  - **How:** Finalize an independent Cold Validator agent that receives only the final synthesis (without debate history) to audit for hallucinations, unsupported claims, and overconfidence, outputting a strict JSON pass/fail matrix.
  - **Why:** Provides an unbiased, objective final check for hallucinations unaffected by the agents' preceding internal logic.

- [ ] #### Final verdict confidence score
  - **How:** Implement the formula `(claimScore × 0.6 + debateScore × 0.3 + diversityBonus × 0.1)` to calculate the final confidence metric.
  - **Why:** Provides users with a quantifiable, trustworthy numerical metric indicating the reliability of the platform's outputs.

### Phase 3: RAG Intelligence Layer

- [ ] #### Advanced Multi-stage Retrieval
  - **How:** Finalize the retrieval pipeline by combining pgvector similarity with PostgreSQL BM25 keyword matching, merging results via Reciprocal Rank Fusion (RRF) in `src/services/vectorStore.service.ts`.
  - **Why:** Relying solely on vector similarity misses exact-match keywords. Combining both methods ensures high recall across all query types.

- [ ] #### HyDE Integration
  - **How:** Implement Hypothetical Document Embeddings (HyDE) in `src/services/vectorStore.service.ts` to generate and embed a hypothetical LLM answer prior to vector search.
  - **Why:** Bridges the semantic gap for short, abstract user queries, retrieving highly relevant context chunks.

- [ ] #### Adaptive K & Chunking
  - **How:** Implement parent-child chunking in `src/services/chunker.service.ts` and an adaptive K selector (`src/services/adaptiveK.service.ts`) that scales retrieval limits based on query complexity.
  - **Why:** Conserves tokens and prevents context dilution by ensuring the LLM receives precisely the required amount of surrounding context.

- [ ] #### Cohere Reranking
  - **How:** Integrate the Cohere API in `src/services/reranker.service.ts` to reorder the top retrieved chunks post-retrieval.
  - **Why:** Cross-Encoder rerankers significantly improve the precision and relevance of the final documents fed into the deliberation engine.

### Phase 4: Agentic Memory & Context Handling

- [ ] #### Cross-conversation topic graph linking
  - **How:** Develop `src/services/topicGraph.service.ts` to extract conversational topics using LLMs, establishing source/target edges in the `topicEdges` database table to link historical conversations.
  - **Why:** Provides continuous context, allowing the AI to instantly recall relevant decisions made in previous related sessions.

- [ ] #### Multi-Backend Vector Memory
  - **How:** Configure `src/services/memoryRouter.service.ts` to route operations seamlessly between local memory, Qdrant REST client endpoints, and native pgvector schemas.
  - **Why:** Prevents vendor lock-in and accommodates different scaling requirements across deployment environments.

- [ ] #### Temporal decay & Adaptive recall
  - **How:** Implement cron jobs (`src/lib/memoryCrons.ts`) to decay the relevance weight of older context chunks (e.g., 14-day half-life) while preserving the weight of frequently accessed facts.
  - **Why:** Mitigates context noise and prevents the AI from hallucinating based on stale or outdated information.

- [ ] #### Subconscious Background Synthesis
  - **How:** Create a background worker queue (`src/queue/workers.ts`) to automatically compress dormant raw chat logs into dense, versioned knowledge graph nodes (`SharedFact` schemas).
  - **Why:** Pre-computing insights guarantees ultra-low latency RAG queries and provides the illusion of continuous background thinking.

### Phase 5: Workflow Engine

- [ ] #### Drag-and-drop canvas implementation
  - **How:** Build the frontend UI using `React Flow` to visualize workflows, creating draggable, configurable components for nodes like LLM, Tools, and Logic.
  - **Why:** Democratizes agent creation by providing a no-code/low-code interface for constructing complex, multi-agent AI workflows.

- [ ] #### Topological Execution
  - **How:** Finalize the backend DAG executor (`src/workflow/executor.ts`) utilizing Kahn's algorithm to process nodes in correct dependency order, employing `Promise.all` for parallel-safe branches.
  - **Why:** Guarantees precise execution ordering, ensuring a node never executes before its inputs are fully resolved.

- [ ] #### Node Handlers
  - **How:** Implement backend execution handlers for 12 core node types (e.g., `src/workflow/nodes/http.handler.ts`), incorporating strict state validation and Server-Side Request Forgery (SSRF) protection.
  - **Why:** Ensures workflow functionality and security; SSRF protection is critical to prevent malicious workflows from accessing internal infrastructure.

- [ ] #### Self-Healing Agentic Workflows
  - **How:** Extend `executor.ts` to catch node execution errors (e.g., API failures), automatically routing the error context back to a recovery LLM node to rewrite the prompt or adjust parameters before retrying.
  - **Why:** Creates truly resilient automation capable of recovering from external API changes or prompt drift without human intervention.

### Phase 6: Agent Skills & Autonomy

- [ ] #### Goal Decomposition Engine
  - **How:** Expand `src/services/goalDecomposition.service.ts` to use an LLM to break high-level prompts into a DAG of 3-8 concrete subtasks, assigning specific archetypes and tracking progress.
  - **Why:** Improves accuracy on massive, multi-step tasks by allowing specialized agents to handle modular pieces systematically.

- [ ] #### Monte Carlo Thought Trees (MCTS)
  - **How:** Modify `src/agents/orchestrator.ts` for complex coding tasks to simulate multiple reasoning branches (Tree of Thoughts), using the ML Scoring Engine to prune invalid logic trees prior to the debate phase.
  - **Why:** Simulating multiple future outcome paths guarantees optimal problem-solving, rivaling advanced reasoning capabilities within an open-source pipeline.

- [ ] #### Tool Chaining
  - **How:** Implement autonomous sequencing in `src/services/toolChain.service.ts` to automatically pipe the output of one tool into the input of the next.
  - **Why:** Enables true agentic autonomy, allowing the AI to solve complex problems without requiring human intervention at every step.

- [ ] #### Code Sandbox Deep Hardening
  - **How:** Finalize the Python Sandbox (`src/sandbox/pythonSandbox.ts` and `src/sandbox/seccomp.ts`) by enforcing strict isolation via seccomp-bpf, bubblewrap namespaces, and `ulimit` resource constraints.
  - **Why:** Executing AI-generated code is inherently dangerous. Deep defense-in-depth isolation ensures malicious code cannot escape the sandbox or harm the host environment.

### Phase 7: Frontend UI/UX Refinement

- [ ] #### Visual Patterns
  - **How:** Update Tailwind classes and `framer-motion` animations across frontend components to reflect the clean, modern aesthetics of leading agent frameworks (e.g., Manus AI, Lobe Chat).
  - **Why:** A premium, polished UI significantly enhances perceived trust and user experience, critical for an application delivering high-confidence verdicts.

- [ ] #### Interactive Deliberation UI
  - **How:** Develop `DebateDashboardView.tsx` to visualize agent arguments, render real-time token streaming via Server-Sent Events (SSE), and visually map contradiction resolutions.
  - **Why:** Demystifies the AI's internal processes by showing users exactly how the agents are arguing and arriving at their conclusions.

- [ ] #### Mindmap & Mermaid Rendering
  - **How:** Enhance the frontend Markdown parser to dynamically render Markdown-embedded Mermaid state diagrams, sequence diagrams, and interactive ECharts components.
  - **Why:** Visualizing complex logic, timelines, and data architectures via diagrams makes the AI's output instantly comprehensible.

### Phase 8: Real-Time Collaboration & Human-in-the-Loop

- [ ] #### Multi-user WebSockets
  - **How:** Implement native WebSocket presence in `src/services/livePresence.service.ts` to track cursors, typing indicators, and manage shared multi-user council sessions.
  - **Why:** Enables seamless team collaboration, allowing users to watch and interact with a deliberation unfolding together in real-time.

- [ ] #### Human-in-the-Loop (HITL) Gates
  - **How:** Finish `src/services/hitlGates.service.ts` to pause autonomous workflows, storing a pending state in the database while awaiting manual approval, review, or escalation.
  - **Why:** Provides necessary safety checkpoints for high-stakes tasks (e.g., destructive API calls) requiring human oversight.

- [ ] #### User Annotations & Voting
  - **How:** Implement threaded replies and reactions to specific claims in the frontend, supported by a backend democratic synthesis voting system to layer human consensus over the AI's consensus.
  - **Why:** Blends human domain expertise with AI deliberation, ensuring the final output aligns perfectly with human expectations.

### Phase 9: Final Polish, Accessibility & CI/CD

- [ ] #### Accessibility Audit
  - **How:** Perform manual screen reader testing (VoiceOver/NVDA) and verify ARIA labels, focus states, and color contrasts across all UI components.
  - **Why:** Ensures the platform is fully usable by all users, meeting strict compliance standards and providing a professional-grade experience.

- [ ] #### Comprehensive Test Coverage
  - **How:** Expand Vitest and Playwright test suites to fully cover integration pathways for the completed orchestration DAGs, checking for edge cases in debate resolution and tool failures.
  - **Why:** Guarantees long-term stability and prevents regressions within the highly complex multi-agent orchestrator.

- [ ] #### Deployment & Observability
  - **How:** Finalize Docker multi-stage builds. Implement Prometheus metrics (`src/lib/prometheusMetrics.ts`) and provision Grafana dashboards for observability of token usage, latency, and costs.
  - **Why:** Provides administrators with deep visibility into system performance and API costs, making the application production-ready at scale.

---

<div align="center">

**[Back to README](./README.md)**

</div>

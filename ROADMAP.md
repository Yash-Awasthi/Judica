<div align="center">

# AIBYAI Roadmap

### Status

[![Phases 1–4](https://img.shields.io/badge/Phases_1--4-Complete-22C55E?style=for-the-badge)](#completed)

</div>

---

## Completed

> All planned engineering phases are done. See git history for details.

| Phase | Highlights |
|---|---|
| **Phase 1** | E2E tests, 48 integration tests (`fastify.inject()`), load test scaffold (5 Autocannon scenarios), seccomp-bpf syscall filter, Redis auth pipelining, CI pipeline, observability |
| **Phase 2** | HyDE, parent-child chunking, federated search, adaptive k, topic graph, temporal decay, contradiction resolution, Cohere reranking, agent specialization, confidence calibration, dynamic delegation |
| **Phase 3** | Goal decomposition, tool chains, test generation, refactoring assistant, PR review agent, full-stack scaffolding, image-aware agents, visual output generation, cross-modal reasoning, HITL gates, background agents, artifact streaming, audio/video input |
| **Phase 4** | MCP server + client, plugin SDK, webhook triggers, middleware hooks, tool federation, custom workflow nodes, user annotations, synthesis voting, multi-user deliberation, live presence |

---

## Phase 1: Hardening — Detail

- [x] Rewrite route-level integration tests to use `fastify.inject()` — 48 tests across 6 files (archetypes, auth guard, council, memory, sandbox, templates)
- [x] Load testing with autocannon — 5 scenarios (health, templates, history, deliberation, archetypes), 200 concurrent connections, p95/p99 thresholds
- [x] Python sandbox: seccomp-bpf syscall filter — 30+ blocked syscalls, 10 tests
- [ ] Accessibility: screen reader testing (VoiceOver/NVDA) — manual verification needed

---

## Phase 3–4: Service Layers

> All service layers implemented with in-memory stores and full test coverage. Require infrastructure (Redis, WebSocket server, frontend) to become fully operational.

- [x] Long-running background agents — checkpointing, pause/resume, progress tracking (8 tests)
- [x] Human-in-the-loop gates — 4 gate types, multi-approver, auto-timeout (13 tests)
- [x] Intermediate artifact streaming — EventEmitter pub/sub, SSE formatting, replay (12 tests)
- [x] Audio/video input — multi-provider transcription, keyframe extraction (9 tests)
- [x] Tool federation — registry, search, install/uninstall, toggle (13 tests)
- [x] Custom workflow nodes — registry, execution, validation (15 tests)
- [x] Multi-user deliberation — rooms, roles, phases, turn management (18 tests)
- [x] Live presence — cursors, heartbeat, awareness (17 tests)
- [x] User annotations — threads, reactions, resolution (13 tests)
- [x] Synthesis voting — weighted scoring, quorum, delegation (14 tests)

---

<div align="center">

**[Back to README](./README.md)**

</div>

# Judica — Roadmap & Next Steps
# Audit date: 2026-06-10
# Inspired by: G0DM0D3 (elder-plinius) + Onyx (onyx-dot-app)

---

## AUDIT SUMMARY

### What's already built (stronger than expected)

BACKEND (src/)
- Multi-model council + deliberation engine (ask.ts — 1151 lines, fully wired)
- 50+ data connectors: Slack, Notion, GitHub, Jira, Linear, Confluence, Salesforce,
  HubSpot, Gmail, Google Drive, SharePoint, OneDrive, Airtable, Asana, ClickUp,
  Discord, Zendesk, Telegram, S3, GCS, R2, Wikipedia, and 25+ more
- Full RAG pipeline: vectorStore + chunker + embeddings + reranker
- Web search: Tavily, SerpAPI, Serper, Brave, Google PSE, SearXNG
- MCP server + client (full implementation)
- Code sandbox (isolated-vm)
- Voice: TTS + STT (voiceProvider.service.ts)
- Image generation
- Artifacts + streaming
- Workflow engine (executor + nodes)
- Knowledge graph
- Agent personas + archetypes + specialization
- Background agents + task router
- Simulation environment (runner, personas, scenarios, what-if, replay)
- Deep research lib (deepResearch/)
- Reasoning modes: Socratic, red-blue debate, hypothesis refinement, confidence calibration
- Anti-sycophancy, counterfactual debate, ensemble distillation
- Fine-tune pipeline, eval framework, hallucination scorer
- Adversarial testing, prompt DNA, epistemic tags
- Semantic cache (Redis), token conservation
- Guardrails + content scanners + moderation
- Cross-conversation memory, memory compaction
- Speculative decoding, structured extraction, grounding
- Auth: JWT + Google OAuth + SCIM + SSO
- Multi-tenancy, data residency, RBAC, whitelabeling
- Billing (Stripe), rate limits, spending limits
- Observability: Prometheus + Grafana + tracer
- 140+ API routes total

ADAPTERS
- Anthropic, OpenAI, Gemini, Groq, Ollama, LiteLLM, OpenRouter,
  vLLM, Pinecone, Weaviate, Vespa, MinIO/object storage

FRONTEND (React Router 7 + TypeScript)
- Chat, God Mode (parallel raw view), Deliberation, Evaluation
- Knowledge Bases, Repos, Workflows, Marketplace, Skills
- LLM Leaderboard, Archetypes, Prompts, Projects
- Admin (analytics, audit, users, system), Auth flows
- Landing, product pages, pricing, blog, careers
- Tauri desktop (Rust)

DESKTOP
- Electron app (BrowserView injection, SQLite, no API keys)
- Tauri app (cross-platform, Rust-based)

INFRA
- Docker + Docker Compose
- Kubernetes + Helm charts
- Cloudflare Workers (wrangler)
- PostgreSQL + Drizzle ORM
- Redis + BullMQ queues

---

## GAPS — What's Missing (G0DM0D3 + Onyx inspired)

### G0DM0D3 gaps
- [ ] ULTRAPLINIAN mode: query 10/24/36/45/51 models in parallel, composite scoring, tier selector
- [ ] GODMODE CLASSIC: fixed battle-tested prompt+model combos (5 combos race, best wins)
- [ ] Parseltongue: red-team input perturbation engine (leetspeak, braille, morse, unicode, phonetic)
- [ ] AutoTune: EMA-based adaptive sampling (temperature, top_p, top_k etc.) with thumbs feedback loop
- [ ] STM output normalization modules (Hedge Reducer, Direct Mode, Curiosity Bias)
- [ ] Hacker themes: Matrix (green/black), Glyph (purple/mystical) in addition to current dark UI
- [ ] Easter eggs / Konami code

### Onyx gaps
- [ ] Deep Research end-to-end UI flow (lib exists, needs frontend + report export)
- [ ] One-command deploy script (curl install.sh | bash)
- [ ] Chrome extension
- [ ] Mobile app (PWA at minimum)
- [ ] Connector sync dashboard (UI for managing + monitoring 50+ connectors)

### Technical debt / polish
- [ ] .env.example with all required vars documented
- [ ] Onboarding flow (first-run wizard: API keys, first connector, first chat)
- [ ] Frontend-backend wiring audit (which routes are fully connected vs stubbed)
- [ ] Electron vs Tauri — pick primary, document the other as secondary
- [ ] README overhaul: platform focus, not just Electron desktop focus
- [ ] E2E test coverage for core flows (deliberation, RAG, MCP)
- [ ] Vespa setup guide (complex self-host, most users will need help)
- [ ] API docs auto-generated from Swagger (already have @fastify/swagger, just need to expose)

---

## PHASE 1 — Polish & Ship the Foundation
Priority: get it actually running end-to-end for a new user

- [ ] Write .env.example (all services, all providers, minimal required set)
- [ ] One-command Docker deploy (single docker-compose.yml that just works)
- [ ] First-run onboarding wizard in frontend (API key setup, provider test, first chat)
- [ ] README rewrite: platform overview, quick start, architecture diagram
- [ ] Swagger UI exposed at /api/docs (already wired, just needs enabling)
- [ ] Audit and fix all frontend routes that call non-existent backend endpoints
- [ ] Basic E2E test: /ask endpoint + frontend chat flow

---

## PHASE 2 — G0DM0D3 Mode Features
Priority: power user differentiation, hacker aesthetic

- [ ] ULTRAPLINIAN mode backend: tier config (10/24/36/45/51 models), composite scorer,
      latency + quality + token weighting, winner selection
- [ ] ULTRAPLINIAN mode frontend: tier picker, parallel response grid, composite score UI
- [ ] GODMODE CLASSIC: 5 hardcoded combo objects (model + system prompt), race UI
- [ ] Parseltongue engine: 33 trigger words, 6 techniques, 3 intensity tiers
      (src/lib/parseltongue.ts + route + frontend toggle)
- [ ] AutoTune service: query classifier (5 context types), param selector,
      EMA learning loop, thumbs feedback endpoint
- [ ] STM pipeline: hedge reducer, direct mode, curiosity bias — post-process hook on all outputs
- [ ] Theme engine: Matrix (green/black), Glyph (purple/mystical), add to existing settings
- [ ] Easter eggs

---

## PHASE 3 — Onyx Feature Parity
Priority: become a real Onyx alternative

- [ ] Deep Research UI: multi-step research flow, progress view, markdown report export, PDF export
- [ ] Connector sync dashboard: list all 50+ connectors, sync status, last synced, manual trigger
- [ ] Connector onboarding: OAuth flows for Notion, GitHub, Slack, Google Drive, Linear
- [ ] Knowledge base manager UI polish (DocumentSetManager component — already exists, needs wiring)
- [ ] Agent builder: drag-and-drop tool assignment, instruction editor, knowledge attachment
- [ ] Chrome extension (content script that sends selected text to Judica)
- [ ] PWA manifest + service worker (offline-capable, installable on mobile)
- [ ] One-command install script: curl -fsSL https://judica.app/install.sh | bash

---

## PHASE 4 — Beyond Both (Judica-unique)
Priority: features neither G0DM0D3 nor Onyx have

- [ ] Simulation environment UI (backend fully built): scenario creator, persona editor,
      replay viewer, report generator
- [ ] What-if scenario explorer frontend
- [ ] Multi-user deliberation rooms (backend: rooms.ts, roomParticipants schema)
- [ ] Prediction registry + accuracy tracking over time
- [ ] Member evolution: track per-model reliability scores over time, auto-demote bad models
- [ ] Blind council mode frontend (backend: blindCouncil.ts — removes model identity during eval)
- [ ] Anti-sycophancy dashboard: show where models agreed vs where they actually disagreed
- [ ] Council checkpoint browser: step through a deliberation round-by-round
- [ ] Prompt DNA editor: visual editor for systemPrompt + steeringRules + consensusBias + critiqueStyle

---

## IMMEDIATE NEXT (this session)

1. .env.example
2. Docker one-liner
3. Frontend wiring audit
4. ULTRAPLINIAN backend + frontend (biggest G0DM0D3 win)

---

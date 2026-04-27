<div align="center">

# Judica — Development Roadmap

**Multi-Agent Deliberative Intelligence Platform**

A living document. Ordered by what matters to building a genuinely great product — not by what's sellable. Business features come last.

</div>

---

## Core Principles

These apply to every feature built, without exception:

**Never silently increase cost.**
- Features that add extra prompts, filters, injections, or background processing are **off by default**
- They must be opt-in via an explicit toggle, visible in the chat UI
- When enabled, the user knows it is running — nothing hidden
- Automatic/invisible cost increases are not acceptable regardless of the feature's value

**Reducing cost is always fine to do silently.**
- Compaction, semantic caching, prompt compression, token optimisation — these can run transparently
- The goal is: user pays less than they would on a raw API, never more

**Toggles live in the chat, not buried in settings.**
- If a feature affects a conversation, its toggle is accessible directly from that conversation

**User pays only for their AI provider API key. Nothing else, ever.**
- Every feature that uses an external paid service (web search, scraping, reranking, TTS, STT, image/video generation, embeddings) must have a **free/self-hosted alternative** that is the default
- Paid services are opt-in upgrades, never the only path
- A visible warning is shown on every feature that costs tokens or credits beyond the base LLM call — before the user enables it, not after
- If a feature has no free alternative yet, it cannot ship until one exists
- See the **[Free Alternatives Map](#free-alternatives-map)** below

---

## What's Already Built

Everything below is fully implemented and shipped in the current codebase.

### Core Deliberation
- Multi-agent council deliberation (4–7 concurrent agents across multiple LLM providers)
- 14 built-in agent archetypes: Architect, Contrarian, Empiricist, Ethicist, Futurist, Pragmatist, Historian, Empath, Outsider, Strategist, Minimalist, Creator, Judge, Devil's Advocate
- Pairwise conflict detection with severity scoring (1–5 scale)
- Structured debate: critique → rebuttal → concession tracking
- Reliability scoring per model, persisted across sessions and weighted at synthesis
- 5 deliberation modes: Standard, Socratic, Red/Blue Team, Hypothesis, Confidence
- Bloom Gate (prevents round quality degradation)
- Cold validator for final hallucination check
- Single AI mode — `summon` a specific archetype to skip the council
- Base AI mode — no persona, raw model output via the `default` council member
- SSE streaming for real-time deliberation progress

### Intelligence
- 5-stage RAG pipeline: HyDE, parent-child chunking, federated search, adaptive k selection, Cohere reranking + RRF
- Three-layer agentic memory: active context → session summaries → long-term pgvector HNSW
- Cross-conversation topic graph with LLM-extracted topic linking
- Temporal decay (14-day half-life) + contradiction resolution with versioned audit trails
- Deep research mode: autonomous multi-step research with web search, scraping, synthesis
- Semantic response caching (LRU + pgvector similarity)

### Agent Capabilities
- Goal decomposition engine with DAG, cycle detection, topological sort, failure cascading
- Long-running background agents with checkpointing, pause/resume, progress streaming
- Human-in-the-loop gates (4 gate types: approval, review, confirmation, escalation)
- Tool chains: 6 tool types, sequential execution with output piping
- Visual workflow engine: 12 node types, drag-and-drop canvas, server-side topological execution
- Built-in tools: web search (Tavily + SerpAPI), calculator, datetime, Wikipedia, read_webpage
- User-defined Python skills
- Collaborative AI rooms: multiple users chat with the council together in real-time

### Providers & Routing
- 13+ LLM provider adapters: OpenAI, Anthropic, Gemini, Groq, Ollama, OpenRouter, Mistral, Cerebras, NVIDIA, Perplexity, Fireworks, Together, DeepInfra, Azure
- Custom OpenAI-compatible provider support (EMOF, UI-configurable)
- Smart routing: complexity classification, free/paid tier chains, Opossum circuit breaker
- Offline mode via Ollama — full local operation with no external API calls
- Per-query token and cost tracking

### Data & Storage
- PostgreSQL 16 + pgvector HNSW indexes
- Redis 7 + BullMQ with dead-letter queue (4 queues: ingestion, research, repo-indexing, compaction)
- Knowledge base management: PDF, DOCX, XLSX, CSV, images, audio ingestion
- GitHub repository indexing and semantic code search
- Multi-file uploads with MIME-type validation

### Connectors
- Web scraping connector (Playwright + content extraction)
- GitHub connector (code search, PR context, repo indexing)
- Apify connector (structured web data)
- Confluence connector (team knowledge bases)
- MCP server + client (bidirectional Model Context Protocol)
- Plugin SDK (custom tools, webhooks, middleware hooks, tool federation)

### Platform
- React 19 + Vite 7 + Tailwind CSS frontend with 18 views
- JWT + OAuth2 (Google, GitHub) authentication with MFA
- RBAC: admin, member, viewer
- Community marketplace (prompts, workflows, personas, tools)
- Prompt IDE with versioning
- Analytics dashboard + execution trace viewer
- Audio transcription (Whisper + Google Speech-to-Text) and TTS
- Code sandbox: JS (isolated-vm) + Python (bubblewrap + seccomp-bpf) — git, npm, make all work
- Prometheus + Grafana observability with auto-provisioned dashboards
- Docker Compose + multi-stage Dockerfile + GitHub Actions CI/CD

---

## Phase 0: Frontend Polish & Core UX ✅

> Immediate fixes completed.

| # | Feature | Status |
|---|---|---|
| 1 | Marketplace interactivity — star, install/uninstall, publish | Completed |
| 2 | Marketplace download as JSON | Completed |
| 3 | Marketplace filter layout (starred, my items, installed) | Completed |
| 4 | Always-visible action buttons on cards | Completed |
| 5 | Publish to Marketplace dialog | Completed |

---

## Phase 1: User Control & Customisation

> Give users real power over how the system thinks and behaves.

| # | Feature | Notes |
|---|---|---|
| 1 | **Profanity & 18+ content toggle** — Per-user settings: block profanity, block adult content, or allow both. Applied as a filter layer before input reaches models and after output returns. Toggle in settings, persisted on account. | *Ref: [LLM Guard](https://github.com/protectai/llm-guard) (MIT, 1.2k stars) — input/output scanners for toxicity, profanity, and content moderation. [Perspective API](https://github.com/conversationai/perspectiveapi) — Google's toxicity scoring model.* |
| 2 | **Per-member AI toggle (mid-session on/off)** — Toggle any individual council member on or off during a live chat session. When toggled off, that member finishes its current response then stops participating. When toggled back on, it receives: all user messages sent while it was off, plus the final consensus of each round it missed (not other members' individual replies). It catches up autonomously — no user instruction needed, just a toggle. **Cost warnings:** turning on shows a tooltip: "Re-enabling on this chat will use credits to process missed context." Turning off shows: "Turning this back on later will cost credits regardless of whether you use it — it needs to learn what it missed." If the chat is long, an additional warning: "This is a large conversation — catch-up context will be significant." | *Ref: [LibreChat](https://github.com/danny-avila/LibreChat) (MIT, 22k stars) — implements conversation pause/resume patterns. Standard audio conferencing mute/unmute UX (Zoom, Discord).* |
| 3 | **Custom skill builder** — Users define their own callable tools: name, description, input schema, JS/Python body. Skills are stored, versioned, and injected into the council's tool list. Can be published to marketplace. Extends the existing Python skills system. | *Ref: [Dify](https://github.com/langgenius/dify) (Apache 2.0, 70k stars) custom tool builder. [Toolformer](https://arxiv.org/abs/2302.04761) (Meta, 2023) — foundational paper on teaching LLMs to use tools.* |
| 4 | **Adversarial prompt filter + prompt engineering layer** — Every user input passes through a filter that: (1) detects prompt injection attempts, (2) restructures the input into a clean, unambiguous form, (3) proofreads for clarity. Toggle to skip for power users who want raw input. Token-conservative rewrite model used. | *Ref: [Rebuff](https://github.com/protectai/rebuff) (Apache 2.0) — self-hardening prompt injection detector. [LLM Guard](https://github.com/protectai/llm-guard) (MIT) — scanner framework for prompt injection, jailbreak, and invisible text detection.* |
| 5 | **Token conservation mode** — A toggle in the prompt layer that compresses/rewrites prompts to reduce token spend without losing meaning. Separate toggle to disable entirely for users who want their exact words sent. | *Ref: [LLMLingua](https://github.com/microsoft/LLMLingua) (MIT, Microsoft, 5k stars) — prompt compression with up to 20x ratio while preserving performance. [LongLLMLingua](https://arxiv.org/abs/2310.06839) for long-context compression.* |
| 6 | **Specialisation mode** — Mark a conversation or session as a specific domain (code, legal, medical, creative, research). Council composition, persona weighting, and tool selection adapt to the domain. Not generic — opinionated defaults per domain. | *Ref: [CrewAI](https://github.com/crewAIInc/crewAI) (MIT, 27k stars) — role-based agent specialisation with domain-specific tool assignment. [AutoGen](https://github.com/microsoft/autogen) (MIT, Microsoft, 40k stars) — domain-adaptive multi-agent conversations.* |
| 7 | **Switchable context (conversation branches)** — Fork any conversation at any message. Like git branches: you can explore a different direction without losing the original thread. Switch between branches, merge insights back. Each branch is a full conversation with its own history. | *Ref: [Loom](https://github.com/socketteer/loom) (MIT) — tree-based conversation branching and exploration for LLMs. [oobabooga/text-generation-webui](https://github.com/oobabooga/text-generation-webui) (AGPL, 42k stars) — implements conversation tree navigation.* |
| 8 | **Editable memory** — UI to view, edit, tag, and delete all memories the system has stored about you. Includes session summaries, extracted facts, and topic graph nodes. Full user ownership of their memory. | *Ref: [mem0](https://github.com/mem0ai/mem0) (Apache 2.0, 25k stars) — memory management with CRUD operations and user-facing memory dashboard. [Letta / MemGPT](https://github.com/letta-ai/letta) (Apache 2.0) — agent-managed memory with explicit read/write/delete operations.* |
| 9 | **Multi-quote comment composer** — Select any text in any message (council member or user) and a floating comment icon appears. Click it to add a comment/annotation on that specific text. Repeat across multiple messages — accumulate as many quoted-and-commented selections as needed before sending. A popover appears above the input box (with an apostrophe/quote icon) listing all your selections: the quoted text, who said it, and your comment on each. The input box itself can contain an optional master instruction ("look into all my comments" / "address these sequentially" / etc.) or be left empty. Minimum 1 quote to send. Sent as structured JSON so the council knows exactly what was quoted, from whom, and what the user's comment on each was. | *Ref: [Telegram quote-reply UX](https://core.telegram.org/) — multi-quote accumulation pattern. [Quill](https://github.com/slab/quill) (BSD, 44k stars) — rich text editor with quote/selection primitives. [Hypothesis](https://github.com/hypothesis/h) (BSD, 3k stars) — web annotation with text selection and commenting.* |
| 10 | **Epistemic status tags** — Every factual claim in a response is tagged before delivery: `[speculation]` `[working hypothesis]` `[contested]` `[established]`. The council stops collapsing everything into one confident-sounding answer — you see the actual certainty level of each claim. Off by default, toggle in chat. | *Ref: [Elicit](https://elicit.com/) — research assistant that surfaces uncertainty and evidence quality per claim. Inspired by Gwern's [epistemic status annotations](https://gwern.net/about#confidence-tags).* |
| 11 | **Conversation weather** — A single at-a-glance indicator of the epistemic health of a conversation. Stormy = high council disagreement, many open questions. Sunny = strong consensus, high confidence. Foggy = low information, models are guessing. No extra cost — derived from existing conflict scores and confidence values. | *Derived from existing deliberation metrics. Ref: [Argilla](https://github.com/argilla-io/argilla) (Apache 2.0, 4k stars) — data quality indicators and annotation confidence visualisations.* |
| 12 | **Hypothesis tracker** — Mark any statement as a hypothesis. The system tracks it across sessions: when later conversations confirm or deny it, the tracker updates. View open hypotheses and their current status. Off by default. | *Ref: [Metaculus](https://www.metaculus.com/) — prediction tracking and calibration platform. [Fatebook](https://fatebook.io/) — lightweight prediction tracking with resolution tracking.* |
| 13 | **Idea evolution tree** — An idea raised in one conversation and revisited or branched in later ones is shown as a visual tree: original node, branches explored, what was dropped, what survived. Passively built from cross-session topic linking. | *Ref: [Markmap](https://github.com/markmap/markmap) (MIT, 9k stars) — interactive mindmaps from Markdown. [D3.js](https://github.com/d3/d3) (ISC, 110k stars) — tree/graph visualisation primitives.* |
| 14 | **Socratic mode** — The council never answers directly. It only asks questions that guide you to the answer yourself. Useful when the goal is learning, not just getting an answer. Off by default, toggle in chat. | *Ref: [Khanmigo](https://www.khanacademy.org/khan-labs) (Khan Academy) — Socratic AI tutoring that guides via questions, never gives direct answers. [Stanford Alpaca](https://github.com/tatsu-lab/stanford_alpaca) (Apache 2.0) — instruction-following patterns adaptable to Socratic prompting.* |
| 15 | **OpenAPI tool definitions** — Define custom tools for the council by pasting an OpenAPI spec. Automatically parses endpoints, parameters, and auth schemes into callable tools. No code needed. | *Ref: [Onyx](https://github.com/onyx-dot-app/onyx) custom tool actions.* |
| 16 | **LLM spending limits** — Per-user and per-group token rate limits and cost caps. Admins set hard limits; users see their usage. Prevents runaway spend on long council sessions. | *Ref: [Onyx](https://github.com/onyx-dot-app/onyx) EE spending limits.* |
| 17 | **God Mode — raw parallel view** — A toggle that switches from council deliberation mode to a split-pane view: every active council member's raw, unfiltered response in its own visible pane simultaneously. No synthesis, no deliberation — just all of them at once. User reads all, picks what they want. Type once, all get the same prompt. Different from A/B (2 models) — this is all N members, all visible in full. Optionally: a "synthesise selected" button to run consensus only on the panes the user chose. | *Ref: [GodMode](https://github.com/smol-ai/GodMode).* |
| 18 | **Workspace system** — Isolated namespaces above conversations. A workspace has its own document set, agent configuration, LLM settings, memory, and tools — completely separate from other workspaces. "Work" and "Personal" workspaces don't bleed into each other. Conversations belong to a workspace, not the global account. | *Ref: [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm).* |
| 19 | **Intelligent skill selection** — The council dynamically loads only the tools it actually needs for a given query, not the full tool roster every time. A small classifier evaluates the query and selects relevant skills before the council runs. Reduces tool-related token usage by up to 80% on queries that don't need most tools. ⚠️ off by default — user can force full tool load. | *Ref: [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) Intelligent Skill Selection.* |
| 20 | **SOP-driven agent mode** — Council follows a user-defined or auto-generated Standard Operating Procedure: a step-by-step procedure where each stage produces a specific artifact (brief → research → outline → draft → review → final). Each stage is a separate council run. No skipping stages. Useful for writing, software projects, research reports. | *Ref: [MetaGPT](https://github.com/geekan/MetaGPT) SOP-driven approach.* |
| 21 | **Automated moderation** — For multi-user rooms and shared workspaces: track user behaviour patterns (repeated abuse, prompt injection attempts, spam). Configurable thresholds for warnings and temporary suspensions. Admin dashboard for review. | *Ref: [LibreChat](https://github.com/danny-avila/LibreChat) automated moderation system.* |
| 22 | **Session templates / council presets** — One-click session setup: "Research", "Debate", "Coding", "Writing", "Legal review" — each pre-configures council composition, active tools, memory scope, deliberation mode, and domain specialisation. User can save and share their own presets to the marketplace. | *Ref: [TypingMind](https://www.typingmind.com/) — chat presets with saved model configs, system prompts, and tool sets. [Open WebUI](https://github.com/open-webui/open-webui) (MIT, 70k stars) — model presets and workspace templates.* |
| 23 | **Export deliberation as structured report** — Export any council run as a formatted PDF, DOCX, or Markdown document: consensus clearly marked, each member's position summarised, disagreements highlighted, citations listed, key decisions extracted. The deliberation becomes a deliverable, not just a chat log. | *Ref: [docx](https://github.com/dolanmiu/docx) (MIT, 5k stars) — programmatic DOCX generation in JS. [Puppeteer](https://github.com/puppeteer/puppeteer) (Apache 2.0, 90k stars) — headless Chrome for PDF generation. [Pandoc](https://github.com/jgm/pandoc) (GPL, 36k stars) — universal document converter.* |
| 24 | **Response verbosity control** — A visible slider or preset (Brief / Normal / Detailed / Exhaustive) the user sets per-conversation or globally. Controls how much the council writes without changing what it reasons. Pure prompt instruction, zero extra cost. Accessible directly from the chat input area. | *Ref: [Open WebUI](https://github.com/open-webui/open-webui) (MIT) — per-chat system prompt overrides for controlling response length and style.* |
| 25 | **Keyboard shortcut system** — Full hotkey coverage for power users: new conversation, send message, toggle God Mode, cycle archetypes, copy last response, open search, jump to Build tab. All bindings configurable. Shown in a help overlay (Ctrl+?). No cost. | *Ref: [tinykeys](https://github.com/jamiebuilds/tinykeys) (MIT, 3.5k stars) — lightweight keybinding library (400B). [Mousetrap](https://github.com/ccampbell/mousetrap) (Apache 2.0, 11.7k stars) — keyboard shortcut handling for web apps.* |
| 26 | **Prompt favourites & history** — Any prompt can be starred. Recent and starred prompts are accessible from a quick-access panel at the compose bar. Re-send with one click. Search across history. Stored locally, no extra API cost. | *Ref: [TypingMind](https://www.typingmind.com/) prompt library and favourites. [ChatGPT](https://chatgpt.com/) recent conversations UX pattern.* |
| 27 | **Interface language (i18n)** — Full internationalisation: UI strings, error messages, onboarding, and system-level prompt templates translated. Community-contributed translations via simple JSON locale files. AI responses follow whatever language the user writes in — this covers only the platform shell, not the council itself. | *Ref: [i18next](https://github.com/i18next/i18next) (MIT, 8k stars) — battle-tested i18n framework for JS/React. [react-i18next](https://github.com/i18next/react-i18next) — React bindings. [Tolgee](https://github.com/tolgee/tolgee-platform) (Apache 2.0, 2k stars) — open-source localisation platform with community translation support.* |
| 28 | **Connected AI accounts (app-within-app)** — Users sign up via Google and connect their own OpenAI, Claude, or Gemini accounts via OAuth. Each connected service appears as a visible member in the council right panel. During deliberation: (1) Connected services receive the user's prompt directly. (2) They reply independently. (3) Their replies feed into the consensus and subsequent rounds. (4) They can see only the user's messages and the consensus after each round — never other AIs' individual replies. (5) Every new Judica chat creates a corresponding new chat in the user's connected AI account. (6) The conversation genuinely stores in the user's own account on that platform — they can access it outside Judica (just their messages + consensus). Judica does not access or store the user's data from those platforms beyond the session. | *Ref: [Passport.js](https://github.com/jaredhanson/passport) (MIT, 23k stars) — already in your stack for OAuth. [GodMode](https://github.com/smol-ai/GodMode) — multi-provider connected-account pattern. OpenAI, Anthropic, and Google all offer OAuth-based API access.* |

---

## Phase 2: Memory, Context & Knowledge

> The system should remember. Not just within a chat — across everything.

| # | Feature | Notes |
|---|---|---|
| 1 | **Hierarchical compression** — Multi-level context compression: recent messages → session summaries → long-term facts. Old context doesn't disappear; it compresses into structured knowledge. Users see the compression level and can force-expand. | *Ref: [LLMLingua](https://github.com/microsoft/LLMLingua) (MIT, Microsoft) — multi-level prompt compression. [MemWalker](https://arxiv.org/abs/2310.05029) (2023) — hierarchical memory tree for long-context navigation.* |
| 2 | **User knowledge graph** — Personal graph of concepts, entities, and relationships extracted across all conversations. Nodes are facts, edges are relationships. New conversations can query it to recall relevant prior knowledge. Visualised as an interactive graph in the UI. | *Ref: [Microsoft GraphRAG](https://github.com/microsoft/graphrag) (MIT, 25k stars) — graph-based retrieval-augmented generation with entity/relationship extraction. [Neo4j](https://github.com/neo4j/neo4j) (GPL, 13k stars) — production graph database. [Apache AGE](https://github.com/apache/age) (Apache 2.0) — graph extension for PostgreSQL (already in your stack).* |
| 3 | **Cross-chat memory sharing** — Opt-in: insights, facts, and preferences discovered in one conversation can be referenced in another. User controls what is shared and what stays private to a single conversation. | *Ref: [mem0](https://github.com/mem0ai/mem0) (Apache 2.0, 25k stars) — cross-session memory with user-level, session-level, and agent-level scopes. [Zep](https://github.com/getzep/zep) (Apache 2.0, 3k stars) — long-term memory for AI assistants with cross-session fact extraction.* |
| 4 | **Evolving preference model** — Over time, the system learns how you like responses: length, tone, depth, format. Built from explicit feedback (thumbs up/down) and implicit signals (do you edit the output? do you ask follow-ups?). Preferences visible and editable. | *Ref: [RLHF / DPO](https://arxiv.org/abs/2305.18290) (Rafailov et al., 2023) — Direct Preference Optimisation from human feedback. [Argilla](https://github.com/argilla-io/argilla) (Apache 2.0, 4k stars) — human feedback collection and preference labelling platform.* |
| 5 | **User feedback reinforcement** — Every message can be rated. Ratings feed into council member reliability scores: an archetype that consistently gives bad answers for your use case gets weighted down for you personally. Aggregate anonymised feedback also improves global defaults. | *Ref: [TruLens](https://github.com/truera/trulens) (MIT, 2.5k stars) — feedback functions for LLM evaluation and scoring. [Thumbs up/down → ELO rating](https://lmsys.org/blog/2023-05-03-arena/) — LMSYS Chatbot Arena approach to model ranking from user preferences.* |
| 6 | **Local memory (on-device, Ollama mode)** — When running fully offline via Ollama, memory is stored in local SQLite rather than the server database. Nothing leaves the machine. Syncs back when online if user opts in. | *Ref: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (MIT, 5.5k stars) — fastest SQLite3 driver for Node.js. [sql.js](https://github.com/sql-js/sql.js) (MIT) — SQLite compiled to WASM for browser/embedded use. [LanceDB](https://github.com/lancedb/lancedb) (Apache 2.0) — embedded vector DB, no server process needed.* |
| 7 | **Memory decay visualiser** — Memories approach a decay threshold before they disappear. Instead of facts silently vanishing at the half-life, the UI shows which memories are fading. User can confirm them to reset the clock, or let them go. | *Ref: [Ebbinghaus forgetting curve](https://en.wikipedia.org/wiki/Forgetting_curve) — the foundational model for time-based memory decay. [Anki](https://github.com/ankitects/anki) (AGPL, 20k stars) — spaced repetition with user-confirmed retention, similar "confirm to keep" pattern.* |
| 8 | **Context injection from goal document** — User writes a short document: where they're going, what they're building toward. When enabled, every conversation gets this injected silently into context so the council always knows the direction and can flag conflicts. Off by default, explicit toggle, cost shown when active. | *Ref: [Cursor](https://www.cursor.com/) `.cursorrules` — project-level context injection into every AI interaction. [CLAUDE.md](https://docs.anthropic.com/en/docs/claude-code/memory) — persistent context files that shape all subsequent conversations.* |
| 9 | **Triple-store hybrid memory** — Every memory stored simultaneously in three places: (1) vector DB for semantic search, (2) key-value store for fast exact lookup, (3) graph DB for relationship traversal. Retrieval queries all three and merges. Faster, richer, and more accurate than vector-only memory. | *Ref: [mem0](https://github.com/mem0ai/mem0) hybrid architecture.* |
| 10 | **Three memory scope levels** — Explicit separation: **User-level** (persists across all sessions forever), **Session-level** (this conversation only, gone after), **Agent-level** (specific council member's own memory). Each scope is searchable and editable independently. | *Ref: [mem0](https://github.com/mem0ai/mem0) multi-level memory.* |
| 11 | **Fine-tuning pipeline from council outputs** — Use your highest-rated council responses as training data to fine-tune a small local model (via Ollama). Over time, your personal model is shaped by what the council learned about how you think and what you value. Runs locally, data never leaves your machine. Off by default, runs when enough rated sessions exist. | *Ref: [DSPy](https://github.com/stanfordnlp/dspy) self-improving pipeline concept (MIT, Stanford).* |
| 12 | **DSPy-powered prompt auto-optimisation** — Instead of hand-writing system prompts for each archetype, use DSPy to automatically find better prompts by optimising against your personal feedback history. The Contrarian's prompt gets better the more you rate its responses. **Never runs automatically — user manually triggers it.** Before running, the system shows a token/cost estimate and the user must approve. After running, shows a diff of what changed with a one-click revert option. Requires 50+ rated responses to produce meaningful improvement. | *Ref: [DSPy](https://github.com/stanfordnlp/dspy) (MIT, Stanford, 23k stars).* |
| 13 | **Self-editing memory** — The council can actively modify its own memory blocks mid-conversation: promote a fact to long-term, demote something it was wrong about, merge two contradictory memories, delete a stale entry. Not just passive storage — the agent manages its own memory like an OS manages RAM. | *Ref: [Letta / MemGPT](https://github.com/letta-ai/letta) (Apache 2.0).* |
| 14 | **Agent YAML config profiles** — Export any council configuration (archetypes, tools, memory settings, deliberation mode, system prompts) as a single YAML file. Import it anywhere. Share on the marketplace. Reproducible, version-controllable agent setups. | *Ref: [SWE-agent](https://github.com/SWE-agent/SWE-agent) (MIT, Princeton).* |
| 15 | **HuggingFace Hub as tool and agent source** — Pull tools and agents directly from HuggingFace Hub and inject them into the council's tool list. Massive free ecosystem of community-built tools — image classifiers, audio processors, code evaluators, and more — available with one line. | *Ref: [smolagents](https://github.com/huggingface/smolagents) (Apache 2.0, HuggingFace).* |
| 16 | **Memory import / export** — Export all stored memories (long-term facts, session summaries, knowledge graph nodes) as a portable JSON file. Import from a file to restore or migrate between accounts. Full data portability — you own your memory, not the platform. | *Ref: [GDPR Article 20](https://gdpr-info.eu/art-20-gdpr/) — right to data portability. [ActivityPub](https://www.w3.org/TR/activitypub/) — W3C standard for portable social data. [mem0](https://github.com/mem0ai/mem0) — memory export/import APIs.* |
| 17 | **Video / media transcript ingestion** — Paste a YouTube URL or any video/podcast URL. Transcript is extracted (free via [yt-dlp](https://github.com/yt-dlp/yt-dlp) + Whisper locally) and added to the knowledge base. Council can answer questions about the content. Works fully offline if the media file is downloaded locally. | *Ref: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense, 100k+ stars) — video downloader. [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT) — CTranslate2-based Whisper for fast local transcription. [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) (MIT) — C/C++ port of Whisper for CPU inference.* |

---

## Phase 3: Connectors & Integrations

> Connect the council to the world's data.

| # | Feature | Notes |
|---|---|---|
| 1 | **Custom connector builder** — Users define their own connectors: base URL, auth method (API key, OAuth, Bearer), endpoints, response mapping. Stored, versioned, shareable on the marketplace. No code required — form-based builder with a JSON schema editor for advanced users. | *Ref: [Nango](https://github.com/NangoHQ/nango) (Apache 2.0, 5k stars) — unified API for 300+ integrations with auth management, sync, and proxy. [Airbyte](https://github.com/airbytehq/airbyte) (MIT, 17k stars) — connector builder with low-code connector SDK.* |
| 2 | **Google Workspace connector** — Gmail (read/send), Google Calendar (read/create events), Google Drive (read/upload files), Google Docs (read/edit). Full OAuth2 flow per user. Council can reference emails and calendar context in responses. | *Ref: [googleapis](https://github.com/googleapis/google-api-nodejs-client) (Apache 2.0, 12k stars) — official Google API client for Node.js. [Nylas](https://github.com/nylas/nylas-nodejs) — unified email/calendar/contacts API.* |
| 3 | **Notion connector** — Read pages, databases, and blocks. Write back summaries or AI outputs directly into Notion. OAuth2. | *Ref: [notion-sdk-js](https://github.com/makenotion/notion-sdk-js) (MIT, 5k stars) — official Notion API client. [Onyx](https://github.com/onyx-dot-app/onyx) Notion connector implementation.* |
| 4 | **Slack connector** — Read channel history for context, post AI summaries and responses to channels or DMs. Webhook-based + OAuth2. | *Ref: [Bolt for JavaScript](https://github.com/slackapi/bolt-js) (MIT, 3k stars) — official Slack app framework. [Slack Web API](https://api.slack.com/web) — events, conversations, and message posting.* |
| 5 | **Linear / Jira connector** — Read issues, create issues from council output, link conversations to tickets. | *Ref: [Linear SDK](https://github.com/linear/linear) (MIT) — official Linear API client with GraphQL. [Jira REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/) — Atlassian's issue tracker API. [Nango](https://github.com/NangoHQ/nango) has pre-built Linear and Jira integrations.* |
| 6 | **Sandbox artifact browser** — All files created in the code sandbox (PDFs, generated code, scripts, images, spreadsheets) are indexed and accessible in a dedicated **Artifacts** tab. Browse without loading the original chat. Direct download or preview. Inspired by Replit/Devin. | *Ref: [Artifacts (Anthropic Claude)](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) — in-conversation artifact panel. [Open Interpreter](https://github.com/OpenInterpreter/open-interpreter) (AGPL, 58k stars) — code execution with file output management. [E2B](https://github.com/e2b-dev/e2b) (Apache 2.0, 5k stars) — sandboxed code execution with artifact handling.* |
| 7 | **File generator (any format)** — Explicit "generate a file" intent: user asks for a PDF report, CSV, Excel sheet, ZIP of code, MP3, etc. Council plans it, sandbox executes it, artifact lands in the Artifacts tab. No format restrictions — whatever the sandbox can produce. | *Ref: [jsPDF](https://github.com/parallax/jsPDF) (MIT, 30k stars) — client-side PDF generation. [ExcelJS](https://github.com/exceljs/exceljs) (MIT, 14k stars) — Excel workbook creation. [Archiver](https://github.com/archiverjs/node-archiver) (MIT, 2.8k stars) — ZIP/tar file generation in Node.js.* |
| 8 | **Document sets** — Curated subsets of the knowledge base. Scope a specific agent or conversation to only a defined set of documents — e.g. "only search our legal docs" or "only the Q3 reports." Prevents irrelevant knowledge contaminating focused tasks. | *Ref: [Onyx](https://github.com/onyx-dot-app/onyx) document sets.* |
| 9 | **Connector sync modes** — Three modes per connector: **Load** (full bulk index on demand), **Poll** (incremental time-range updates), **Slim** (lightweight pruning check — removes deleted docs without re-indexing). Keeps the knowledge base current without thrashing. | *Ref: [Onyx](https://github.com/onyx-dot-app/onyx) connector architecture.* |
| 10 | **Multi-surface access** — The council everywhere: Chrome extension (sidebar + new tab, keyboard shortcut), Slack bot, Discord bot, embeddable website widget, desktop app. Same agents, same knowledge base, same council — just accessible from wherever the user is. | *Ref: [Onyx Anywhere](https://github.com/onyx-dot-app/onyx-chrome-extension).* |
| 11 | **Hook extensions** — Code injection points for compliance use cases: PII scrubbing before indexing, content filtering before delivery, query transformation before the council sees it. Runs without forking the core product. Admin-configurable. | *Ref: [Onyx](https://github.com/onyx-dot-app/onyx) EE hook extensions.* |
| 12 | **Natural language web selectors** — Describe what you want from a page in plain language instead of writing CSS selectors or XPath. AI locates the element on the live page. Queries self-heal when the website UI changes — no broken automation after a redesign. Same query works across different sites with similar content. | *Ref: [AgentQL](https://github.com/tinyfish-io/agentql).* |
| 13 | **Structured web data extraction** — Define the exact schema of data you want from a URL (fields, types, nesting). The extraction layer navigates the page and returns clean structured output — not raw HTML to parse yourself. Works on authenticated pages, infinite scroll, dynamically generated content. | *Ref: [AgentQL](https://github.com/tinyfish-io/agentql).* |
| 14 | **Stealth browser mode** — When web connectors or research agents scrape sites, optionally run in stealth mode that spoofs browser fingerprints to bypass anti-bot detection. User-controlled toggle — off by default. | *Ref: [tf-playwright-stealth](https://github.com/tinyfish-io/tf-playwright-stealth).* |
| 15 | **Mobile web app** — Progressive web app (PWA) version of the full interface, optimised for mobile. Same agents, same knowledge base, same council. | *Ref: [Locally Uncensored](https://github.com/PurpleDoubleD/locally-uncensored) mobile web app support.* |
| 16 | **IMAP/SMTP email connector** — Generic email access for non-Google users: Outlook, ProtonMail (via bridge), Fastmail, any IMAP-capable server. Council reads and summarises emails, drafts replies. OAuth2 or app password auth, credentials stored encrypted per user. Separate from the Google Workspace connector. | *Ref: [ImapFlow](https://github.com/postalsys/imapflow) (MIT) — modern IMAP client for Node.js with idle support. [Nodemailer](https://github.com/nodemailer/nodemailer) (MIT, 17k stars) — battle-tested SMTP email sending for Node.js.* |
| 17 | **RSS / Atom feed connector** — Subscribe to any feed (news blogs, arXiv, GitHub releases, Hacker News, product changelogs). Background polling at a user-defined interval via the existing BullMQ queue. Council surfaces items matching relevance filters the user defines in plain language. No extra cost beyond polling. | *Ref: [rss-parser](https://github.com/rbren/rss-parser) (MIT, 1.5k stars) — lightweight RSS/Atom parser for Node.js. [Miniflux](https://github.com/miniflux/v2) (Apache 2.0, 7k stars) — minimalist self-hosted feed reader with a clean API. [Feedbin](https://github.com/feedbin/feedbin) (MIT, 3.5k stars) — full-featured RSS backend.* |

---

## Phase 4: The Build Tab — Council as a Team

> The council doesn't just answer questions. It builds things together.

This is the agentic multi-agent work system. The council operates as a real software team.

| # | Feature | Notes |
|---|---|---|
| 1 | **Task graph with claiming + locking** — A task is created and appears in the Build tab. Any council member can claim it. Once claimed, the task is locked — no other agent touches it. The claiming agent breaks it into subtasks, which become claimable themselves. | *Ref: [CrewAI](https://github.com/crewAIInc/crewAI) (MIT, 27k stars) — task delegation with agent claiming and hierarchical subtask breakdown. [Taskade](https://www.taskade.com/) — AI-powered task graphs with agent assignment.* |
| 2 | **Subtask distribution and assist mode** — If a council member finishes all their subtasks and others are still running, they can pick up unclaimed subtasks from peers. No idle members. No interference with in-progress work. | *Ref: [AutoGen](https://github.com/microsoft/autogen) (MIT, Microsoft, 40k stars) — multi-agent task routing with dynamic work stealing. [CrewAI](https://github.com/crewAIInc/crewAI) — agent assist/delegation patterns.* |
| 3 | **Task submission and merge** — When a member completes a task, they submit it. A designated reviewer agent (or human gate) reviews and either merges or sends back for revision. Final merge produces the deliverable. | *Ref: [MetaGPT](https://github.com/geekan/MetaGPT) (MIT, 48k stars) — SOP-driven review stages where agents review each other's work before merge. [GitHub pull request model](https://docs.github.com/en/pull-requests) — submit → review → approve → merge workflow.* |
| 4 | **Build tab UI** — Live view of the task board: tasks, their owners, subtask trees, statuses (planned → claimed → in progress → review → done). Like a Kanban board but driven by the council, not humans. | *Ref: [React Flow](https://github.com/xyflow/xyflow) (MIT, 28k stars) — already in your stack, can power the task graph visualisation. [dnd-kit](https://github.com/clauderic/dnd-kit) (MIT, 13k stars) — drag-and-drop for Kanban boards in React.* |
| 5 | **Continuous background tasks** — Long-running tasks that persist beyond a chat session: monitoring a repo for changes, summarising new emails daily, watching a topic and alerting when relevant news appears. Checkpointed, resumable. | *Ref: [BullMQ](https://github.com/taskforcesh/bullmq) (MIT, 6k stars) — already in your stack; repeatable jobs with cron expressions. [Temporal](https://github.com/temporalio/temporal) (MIT, 13k stars) — durable workflow execution with checkpointing and resume across failures.* |
| 6 | **Auto-debugging agent** — When code in the sandbox throws an error, a dedicated debugging agent picks it up, reads the stack trace, hypothesises the cause, attempts a fix, and re-runs. Repeats up to N attempts before escalating to human-in-the-loop. | *Ref: [Aider](https://github.com/paul-gauthier/aider) (Apache 2.0, 30k stars) — AI pair programmer with auto-fix loop on test failures. [SWE-agent](https://github.com/SWE-agent/SWE-agent) (MIT, Princeton) — autonomous bug-fixing agent. [OpenHands](https://github.com/All-Hands-AI/OpenHands) (MIT) — autonomous error recovery and iterative fix attempts.* |
| 7 | **Zapier-level workflow builder** — Visual trigger → action pipeline builder. Triggers: new message, webhook, schedule, file upload, connector event. Actions: run council query, call tool, send to connector, write file. More capable than Zapier because actions can be full council deliberations. | *Ref: [n8n](https://github.com/n8n-io/n8n) (fair-code, 55k stars) — visual workflow automation with 400+ integrations. [Activepieces](https://github.com/activepieces/activepieces) (MIT, 12k stars) — open-source Zapier alternative. [Windmill](https://github.com/windmill-labs/windmill) (AGPLv3, 12k stars) — developer-first workflow engine.* |
| 8 | **Personal knowledge graph (agent-maintained)** — The build system automatically extracts and updates your personal knowledge graph as it works. Facts discovered during tasks are stored as nodes. The graph grows passively as you use the system. | *Ref: [Microsoft GraphRAG](https://github.com/microsoft/graphrag) (MIT, 25k stars) — automated entity and relationship extraction from text into knowledge graphs. [LightRAG](https://github.com/HKUDS/LightRAG) (MIT, 20k stars) — lightweight graph-based RAG with incremental knowledge graph construction.* |
| 9 | **Craft: build apps with your own knowledge** — A dedicated agent that generates full web applications and polished documents from natural language — but unlike generic code generators, it has read access to your indexed knowledge base (emails, Slack, Confluence, Drive, repos, etc.). Ask it to build a dashboard and it can seed it with real data from your connectors. Generates Next.js + React UIs, DOCX documents, scripts. Outputs go to the Artifacts tab with live preview. | *Ref: [Onyx Craft](https://github.com/onyx-dot-app/onyx).* |
| 10 | **Workflow execution logs** — Every workflow run produces a full structured log: each node's input, output, duration, retry count, error path taken. Visible in a dedicated run history panel. Step through a past run like a debugger. | *Ref: [n8n](https://github.com/n8n-io/n8n) execution logs.* |
| 11 | **WhatsApp + Telegram bot surface** — Deploy the council as a bot on WhatsApp or Telegram. Users send messages, the council responds. Same agents, same memory, same tools — just through a messaging app. | *Ref: [Flowise](https://github.com/FlowiseAI/Flowise) native WhatsApp/Telegram integrations.* |
| 12 | **Reusable subgraph components** — Bundle any sequence of agent steps into a named, reusable subgraph. Drag it into any workflow like a Lego brick. A "document processing" subgraph, a "research + summarise" subgraph, a "code review" subgraph — build once, use everywhere. | *Ref: [LangGraph](https://github.com/langchain-ai/langgraph) subgraph architecture (MIT).* |
| 13 | **Computer use / browser agent** — The council controls an actual browser autonomously: click, type, navigate, fill forms, extract data, interact with web apps. Completes real-world tasks on the web, not just researches them. Free self-hosted via [Browser-Use](https://github.com/browser-use/browser-use) (MIT, 60k stars). ⚠️ user must explicitly authorise each browser session — no background browsing without consent. | *Ref: [Browser-Use](https://github.com/browser-use/browser-use) (MIT, 60k stars) — AI-native browser control. [Playwright](https://github.com/microsoft/playwright) (Apache 2.0) — already in the codebase for headless browser automation. [Stagehand](https://github.com/browserbase/stagehand) (MIT) — AI web browsing framework.* |
| 14 | **A2A Protocol (Agent-to-Agent)** — Google's open standard for agents on different platforms to communicate. Your council can receive tasks from external agents (Gemini, Claude agents, others) and delegate subtasks to them. Interoperability layer between judica and the broader agent ecosystem. | *Ref: [Agent2Agent Protocol](https://github.com/google-deepmind/agent2agent) (Apache 2.0).* |
| 15 | **Reactive / event-driven agents** — Agents that wake up when something happens, not when the user asks. Triggers: new email matching a filter, repo commit to a branch, news about a keyword, price crossing a threshold, calendar event starting. Agent runs, does its task, optionally notifies the user. More precise than scheduled background tasks — driven by events, not time. | *Ref: [BullMQ](https://github.com/taskforcesh/bullmq) (MIT) — already in the stack; supports event-driven job triggering. [Inngest](https://github.com/inngest/inngest) (Apache 2.0) — event-driven durable functions. [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) (Apache 2.0) — event-driven background jobs for TypeScript.* |
| 16 | **Code agents (actions as Python, not JSON)** — Instead of the council outputting structured JSON tool calls, a code agent writes Python code as its action, which is sandboxed and executed. Measurably more efficient: 30% fewer steps, better at multi-step tasks requiring logic. Runs in the existing sandbox. | *Ref: [smolagents](https://github.com/huggingface/smolagents) (Apache 2.0, HuggingFace).* |
| 17 | **GitHub issue → automated PR pipeline** — User pastes a GitHub issue URL. The council reads the issue and codebase context, writes a fix in the sandbox, runs tests, and opens a draft PR against the repo. Based on state-of-the-art SWEBench results (77.6% issue resolution rate). | *Ref: [OpenHands](https://github.com/All-Hands-AI/OpenHands) (MIT) and [SWE-agent](https://github.com/SWE-agent/SWE-agent) (MIT, Princeton).* |
| 18 | **EnIGMA cybersecurity mode** — Specialised council mode for security work: finding vulnerabilities, analysing exploits, reviewing code for security issues, CTF challenges. Council composition shifts to security-focused archetypes. **Off by default, requires explicit activation.** Clear scope: analysis and defence only, not exploitation. | *Ref: [SWE-agent EnIGMA](https://github.com/SWE-agent/SWE-agent) (MIT, Princeton).* |
| 19 | **Audit log per agent action** — Every action the council or any agent takes is logged with: action type, inputs, outputs, timestamp, model used, token cost. Queryable, exportable, tamper-evident. Distinct from traces (which are about deliberation quality) — this is a compliance-grade action record. | *Ref: [Agno](https://github.com/agno-agi/agno) (Apache 2.0, 39.7k stars).* |
| 20 | **Push + in-app notification system** — When a background agent, workflow, or research task finishes, the user is notified: browser push notification (opt-in), in-app notification bell, and optionally an email summary. Users see what finished, how long it took, and any output artifact — without needing to keep the tab open. Integrates with Phase 4 #5 (continuous background tasks) and Phase 4 #15 (reactive agents). | *Ref: [web-push](https://github.com/web-push-libs/web-push) (MIT, 3.3k stars) — Web Push protocol for Node.js. [Novu](https://github.com/novuhq/novu) (MIT, 36k stars) — open-source notification infrastructure (push, email, in-app, SMS).* |
| 21 | **Self-healing workflow nodes** — If a workflow node fails, a recovery agent diagnoses the error and attempts an automated fix: retry with adjusted parameters, swap to a fallback tool, or rewrite the failing prompt. Falls through to human-in-the-loop only after N failed auto-fix attempts (user-configurable). Full recovery attempts are logged in the workflow execution log. | *Ref: [Temporal](https://github.com/temporalio/temporal) (MIT, 13k stars) — built-in retry policies, fallback activities, and saga compensation. [Inngest](https://github.com/inngest/inngest) (Apache 2.0, 5k stars) — durable step functions with automatic retries and error recovery.* |

---

## Phase 5: Simulation Mode — Spawn Worlds, Rehearse Futures

> Inspired by [MiroFish](https://github.com/666ghj/MiroFish) — a swarm intelligence platform that builds a high-fidelity parallel digital world populated with autonomous agents to simulate and predict outcomes.

The council today answers questions. Simulation mode lets it *inhabit* a world — spawn any number of agents with distinct identities, memories, and goals, run them forward, and observe what happens. Use it to stress-test decisions, model human behaviour, explore "what if" scenarios, or just build something wild.

| # | Feature | Notes |
|---|---|---|
| 1 | **On-the-fly persona spawning** — Spin up any persona mid-conversation: a specific person, a role, a fictional character, a demographic, a company, a nation. Each spawned persona gets a name, backstory, goals, and behavioural constraints defined either by the user or auto-generated from a description. No pre-built list — any persona, any time. | *Ref: [Generative Agents](https://github.com/joonspk-research/generative_agents) (MIT, Stanford/Google, 18k stars) — believable simulacra of human behaviour with memory, reflection, and planning. [CAMEL](https://github.com/camel-ai/camel) (Apache 2.0, 6k stars) — role-playing agent framework with persona injection.* |
| 2 | **Simulation environment setup** — Define the world the personas inhabit: rules, constraints, starting conditions, available information. Seed it from real data (news, reports, documents via connectors), fictional premises, or a mix. The environment is a structured context that all agents share. | *Ref: [AgentScope](https://github.com/modelscope/agentscope) (Apache 2.0, Alibaba, 6k stars) — multi-agent simulation with environment abstractions. [ChatArena](https://github.com/chatarena/chatarena) (Apache 2.0) — multi-agent language game environments.* |
| 3 | **Multi-agent world simulation** — Run N personas simultaneously in the defined environment. Each agent acts from its own perspective, with its own goals and memory. Agents can interact with each other. The council orchestrates — not as participants but as the simulation engine. | *Ref: [Generative Agents: Interactive Simulacra](https://arxiv.org/abs/2304.03442) (Park et al., 2023, Stanford) — the foundational paper on LLM-powered agent societies. [TinyTroupe](https://github.com/microsoft/TinyTroupe) (MIT, Microsoft) — LLM-powered multiagent persona simulation for business insights.* |
| 4 | **What-if scenario runner** — Inject a variable mid-simulation: a policy change, a market event, a character decision, a piece of new information. Observe how the world and its agents respond. Branch the simulation to compare outcomes from different variables. | *Ref: [MiroFish](https://github.com/666ghj/MiroFish) — swarm intelligence with counterfactual branching. [Scenario](https://www.scenario.com/) — simulation branching concepts. The "forking" metaphor from [git worktrees](https://git-scm.com/docs/git-worktree) applies: branch state, mutate, compare.* |
| 5 | **Chat with individual agents** — During or after a simulation, talk directly to any spawned persona. They respond from within their role, memory, and the simulation context — not as a generic AI. Useful for interviewing a persona to understand their reasoning. | *Ref: [Character.AI](https://character.ai/) — conversational AI with persistent character personas. [SillyTavern](https://github.com/SillyTavern/SillyTavern) (AGPL, 9k stars) — multi-character chat with persistent persona memory.* |
| 6 | **Simulation report generation** — After a run, the council synthesises: what happened, why, what the key decision points were, what patterns emerged, what the likely outcomes are. Structured report, downloadable. | *Ref: [Pandoc](https://github.com/jgm/pandoc) (GPL, 36k stars) — for rendering reports in multiple formats. [WeasyPrint](https://github.com/Kozea/WeasyPrint) (BSD, 7.5k stars) — HTML/CSS to PDF for polished report generation.* |
| 7 | **Simulation branching and replay** — Fork a simulation at any point to explore alternate timelines. Step back through a run to see state at each tick. Compare branches side by side. | *Ref: [LangGraph](https://github.com/langchain-ai/langgraph) (MIT) — checkpoint-based time-travel and state forking. [Redux DevTools](https://github.com/reduxjs/redux-devtools) (MIT, 14k stars) — time-travel debugging pattern for state inspection and replay.* |
| 8 | **Use cases built on top** — Scenario planning / risk forecasting, creative writing (run characters through a plot to find inconsistencies), interview prep (spawn a tough interviewer), debate prep (spawn the strongest opposition), product research (spawn your target users and ask them), historical simulation (seed with historical data, run forward). | *Ref: [TinyTroupe](https://github.com/microsoft/TinyTroupe) (MIT, Microsoft) — persona simulation for product testing, market research, and brainstorming. [AI Town](https://github.com/a16z-infra/ai-town) (MIT, a16z, 8k stars) — interactive agent town for exploring emergent social behaviour.* |

---

## Phase 6: Voice & Real-time Interaction

> Talk to the council. Hear it talk back.

| # | Feature | Notes |
|---|---|---|
| 1 | **Voice-to-voice mode** — Speak to the council, hear the response. STT via Whisper (local or API), TTS via ElevenLabs/Azure/OpenAI. Full conversation loop without typing. | *Ref: [LiveKit](https://github.com/livekit/livekit) (Apache 2.0, 12k stars) — real-time audio/video infrastructure, powers many voice AI apps. [Vapi](https://github.com/VapiAI) — voice AI platform with turn-taking and interruption handling. [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) — speech-to-speech with function calling.* |
| 2 | **Voice personas per council member** — Each archetype has a distinct voice: pitch, speed, tone. The Contrarian sounds different from the Empath. Users can customise or swap voices. | *Ref: [Coqui TTS](https://github.com/coqui-ai/TTS) (MPL 2.0, 36k stars) — multi-speaker voice synthesis with voice cloning. [OpenVoice](https://github.com/myshell-ai/OpenVoice) (MIT, MyShell, 30k stars) — instant voice cloning with fine-grained control over style, accent, and emotion.* |
| 3 | **Council call mode** — Immersive audio experience: the council members speak in sequence, as if you're on a call with a team. Each member announces themselves, delivers their position, others respond. A "common frequency" shared channel. | *Ref: [NotebookLM Audio Overview](https://notebooklm.google/) (Google) — multi-voice AI audio discussions. [Podcast.ai](https://github.com/AshishJangra27/Podcast.ai) — AI-generated multi-speaker audio content.* |
| 4 | **Live AI toggle in voice mode** — Mute/unmute individual council members mid-conversation. The muted member's position is excluded from consensus until re-enabled. | *Ref: Standard audio conferencing UX (Zoom, Discord, Teams). [LiveKit components](https://github.com/livekit/components-js) (Apache 2.0) — pre-built participant mute/unmute controls.* |
| 5 | **Image generation** — `generate: image` intent routes to image models (DALL-E, Stable Diffusion, Flux). Generated images appear inline in chat and in the Artifacts tab. | *Ref: [FLUX](https://github.com/black-forest-labs/flux) (Apache 2.0, Black Forest Labs) — state-of-the-art open image generation. [ComfyUI](https://github.com/comfyanonymous/ComfyUI) (GPL, 70k stars) — node-based image gen workflow engine. [Fal.ai](https://github.com/fal-ai/fal) (Apache 2.0) — fast inference for image models.* |
| 6 | **Video & audio generation** — `generate: video` and `generate: audio` intents. Video via Runway/Kling API. Audio/music via Suno/Udio API. Outputs in Artifacts tab. | *Ref: [CogVideoX](https://github.com/THUDM/CogVideo) (Apache 2.0, Tsinghua) — open-source video generation. [Wan 2.1](https://github.com/Wan-Video/Wan2.1) (Apache 2.0) — strong open video model. [AudioCraft](https://github.com/facebookresearch/audiocraft) (MIT, Meta, 22k stars) — music and audio generation (MusicGen, AudioGen).* |
| 7 | **Image-to-image and image-to-video** — Feed an existing image as input: transform it (style transfer, inpainting, upscaling) or animate it into a short video clip. Distinct from text-to-image — you provide the starting visual. | *Ref: [Locally Uncensored](https://github.com/PurpleDoubleD/locally-uncensored) i2i/i2v workflows.* |
| 8 | **Accessibility mode** — Full keyboard navigation, screen reader compatibility with ARIA-live regions for streaming token delivery, high-contrast mode toggle, and reduced-motion option. Streaming responses are chunked in a way screen readers can follow in real-time. Tested against WCAG 2.1 AA. Not an add-on — built into the core layout. | *Ref: [WCAG 2.1 AA](https://www.w3.org/WAI/WCAG21/quickref/) — W3C accessibility guidelines. [axe-core](https://github.com/dequelabs/axe-core) (MPL 2.0, 6k stars) — automated accessibility testing engine. [Radix UI](https://github.com/radix-ui/primitives) (MIT, 16k stars) — accessible component primitives for React.* |

---

## Phase 7: Quality, Reliability & Honesty

> The council should be right. And honest about when it might not be.

| # | Feature | Notes |
|---|---|---|
| 1 | **Citation-first architecture** — Every factual claim in a council response must carry a `[source]` marker. Unsourced claims are flagged as `[unverified]`. Synthesis step cannot promote an unsourced claim to a consensus position. | *Ref: [Perplexity](https://www.perplexity.ai/) — inline citation pattern where every claim links to a source. [ALCE](https://github.com/princeton-nlp/ALCE) (MIT, Princeton) — benchmark and methods for citation-based LLM generation.* |
| 2 | **Verifiable pipelines** — Each step in a council deliberation is logged with inputs, outputs, and timestamps. The full trace is cryptographically chained. Anyone with access can replay and verify the deliberation. | *Ref: [OpenTelemetry](https://github.com/open-telemetry/opentelemetry-js) (Apache 2.0, CNCF) — distributed tracing standard. [Langfuse](https://github.com/langfuse/langfuse) (MIT, 19k stars) — LLM-specific trace recording with step-by-step replay. [Rekor](https://github.com/sigstore/rekor) (Apache 2.0) — tamper-evident transparency log for cryptographic chaining.* |
| 3 | **Fallback model chains** — If a provider fails or returns a degraded response, the query automatically re-routes to the next model in a configured chain. User sees a small indicator when a fallback was used. | *Ref: [LiteLLM](https://github.com/BerriAI/litellm) (MIT, 16k stars) — unified LLM API with automatic fallback chains and load balancing across 100+ providers. Already compatible with your multi-provider architecture.* |
| 4 | **Perfect negation handling** — The system tracks negations explicitly ("don't do X", "never Y", "stop Z"). A negation extractor runs on every instruction and persists the constraint. Re-affirmed in the system context on every subsequent turn. | *Ref: [NeMo Guardrails](https://github.com/NVIDIA/NeMo-Guardrails) (Apache 2.0, NVIDIA, 4.5k stars) — programmable constraint rails that enforce "do not" rules across conversation turns.* |
| 5 | **Anti-sycophancy layer** — The council is explicitly prompted and trained (via feedback reinforcement) to disagree with the user when evidence supports it. Confidence scores are reported honestly. The Contrarian archetype is always included in high-stakes decisions. | *Ref: [Anthropic sycophancy research](https://arxiv.org/abs/2310.13548) (2023) — "Towards Understanding Sycophancy in Language Models." [Constitutional AI](https://arxiv.org/abs/2212.08073) (Anthropic, 2022) — self-supervised alignment that resists user-pleasing over truthfulness.* |
| 6 | **Uncensored truthfulness mode** — On sensitive or controversial topics: the council gives the honest, evidence-based answer without corporate hedging. No refusals based on topic discomfort alone. Misinformation guardrails still active. User-controlled opt-in. | *Ref: [NeMo Guardrails](https://github.com/NVIDIA/NeMo-Guardrails) (Apache 2.0, NVIDIA) — configurable guardrails that separate safety from over-cautious refusals. Inspired by [Llama Guard](https://github.com/meta-llama/PurpleLlama) (Meta) — fine-grained content safety classification.* |
| 7 | **Symbolic reasoning engine** — For logic-heavy queries (math proofs, legal reasoning, formal arguments), a symbolic layer supplements the LLM: structured premises, rule application, contradiction checking. Reduces hallucination on formal tasks. | *Ref: [Z3 Theorem Prover](https://github.com/Z3Prover/z3) (MIT, Microsoft, 11k stars) — SAT/SMT solver for formal logic and constraint satisfaction. [SymPy](https://github.com/sympy/sympy) (BSD, 13k stars) — symbolic mathematics in Python. [Lean](https://github.com/leanprover/lean4) (Apache 2.0, 5k stars) — theorem prover and proof assistant.* |
| 8 | **Hallucination scoring** — Every response gets a hallucination risk score based on: source availability, model confidence, cross-agent agreement, and claim verifiability. High-risk responses are flagged before delivery. | *Ref: [Vectara HHEM](https://huggingface.co/vectara/hallucination_evaluation_model) (Apache 2.0) — hallucination evaluation model, fine-tuned cross-encoder. [TruLens](https://github.com/truera/trulens) (MIT, 2.5k stars) — groundedness and hallucination scoring for RAG pipelines. [RAGAS](https://github.com/explodinggradients/ragas) (Apache 2.0, 8k stars) — RAG evaluation framework with faithfulness scoring.* |
| 9 | **Human-in-the-loop improvements** — More gate types, configurable escalation paths, async approval via email/Slack, audit log of all human decisions in a workflow. | *Ref: [LangGraph](https://github.com/langchain-ai/langgraph) (MIT) — interrupt/approve/reject patterns with human-in-the-loop at any graph node. [Humanloop](https://humanloop.com/) — human feedback integration for LLM pipelines.* |
| 10 | **Blind council** — Council members write responses without seeing what others said. Only the synthesis step sees all of them. Eliminates anchoring bias — the first member's framing can't drag the rest. Off by default, toggle in chat. | *Ref: [Delphi method](https://en.wikipedia.org/wiki/Delphi_method) — structured blind forecasting technique where experts respond independently before aggregation. [Society of Mind (Minsky, 1986)](https://en.wikipedia.org/wiki/Society_of_Mind) — parallel independent reasoning agents.* |
| 11 | **Council minority report** — After consensus is reached, the most dissenting member always gets a visible footnote: their actual position, not absorbed into the consensus. You always see the strongest objection even after it was outvoted. | *Ref: [Mixture of Agents (MoA)](https://arxiv.org/abs/2406.04692) (Together AI, 2024) — multi-agent aggregation that preserves individual agent contributions. Inspired by [Supreme Court dissenting opinions](https://en.wikipedia.org/wiki/Dissenting_opinion) — the minority view is always published alongside the majority.* |
| 12 | **Anti-echo chamber detection** — Across sessions, if the system detects a pattern of consistent agreement on a topic with no challenge to your framing, it flags it and surfaces a reframe you haven't seen. Requires cross-session pattern detection. Off by default. | *Ref: [Anthropic's "Discovering Language Model Behaviors with Model-Written Evaluations"](https://arxiv.org/abs/2212.09251) — detecting sycophantic patterns. [AllSides](https://www.allsides.com/) — multi-perspective framing on the same topic.* |
| 13 | **Council member evolution** — Each archetype tracks its reliability score per user over time. If a member consistently gets low personal feedback from you, it gets replaced in your council with a different archetype. Your council adapts to how you actually use it. | *Ref: [Multi-Armed Bandit](https://en.wikipedia.org/wiki/Multi-armed_bandit) — exploration/exploitation framework for agent selection. [ELO rating system](https://en.wikipedia.org/wiki/Elo_rating_system) — used by LMSYS Chatbot Arena for dynamic model ranking from user preferences.* |
| 14 | **Prompt archaeology** — Given an output, reverse-engineer what prompt most likely produced it. Useful for replicating a good response you can't remember how you got, and for understanding why a response went wrong. | *Ref: [Promptfoo](https://github.com/promptfoo/promptfoo) (MIT, 5k stars) — prompt testing and comparison, useful for prompt analysis. [LangSmith](https://docs.smith.langchain.com/) / [Langfuse](https://github.com/langfuse/langfuse) — full prompt → response trace replay.* |
| 15 | **A/B model comparison** — Run any query against two different models or council configurations simultaneously, side by side. Compare outputs, latency, and cost. Useful for choosing providers and for catching model regressions. | *Ref: [Locally Uncensored](https://github.com/PurpleDoubleD/locally-uncensored) A/B comparison tools.* |
| 16 | **Reasoning depth control** — A slider for how deeply the council reasons before answering. Low depth = fast, single-pass answer. High depth = multiple iterative reasoning loops, each pass refining the previous. Based on the recurrent-depth transformer concept: more loops = better compositional reasoning, at higher compute cost. User-visible cost indicator. | *Ref: [OpenMythos](https://github.com/kyegomez/OpenMythos) Recurrent-Depth Transformer / test-time compute scaling.* |
| 17 | **Webview-based AI fallback (no API key mode)** — In the desktop app, embed the actual web UIs of AI services (ChatGPT, Claude, Gemini) as authenticated webviews. User logs in once in the webview; prompts get injected automatically. Zero API cost, no keys needed. Fallback when a user has no provider API keys configured. | *Ref: [GodMode](https://github.com/smol-ai/GodMode) webview approach.* |
| 18 | **Interrupt-modify-resume** — Pause any in-progress council run or workflow at any node, inspect and edit the current state, then resume from that exact point with the modified state. More precise than just human-in-the-loop approval — you can actually change intermediate results mid-run. | *Ref: [LangGraph](https://github.com/langchain-ai/langgraph) interrupt pattern (MIT).* |
| 19 | **Prediction registry** — When the council makes a falsifiable prediction ("X will happen by Y date"), a parser extracts it and logs it as a tracked claim with a target date. When that date arrives, the system resurfaces the prediction and prompts the user to mark it: correct / incorrect / unclear. Builds an empirical accuracy record per archetype over time. No extra cost — derived from response parsing at delivery time. | *Ref: [Metaculus](https://www.metaculus.com/) — prediction tracking with calibration scoring. [PredictionBook](https://predictionbook.com/) — log predictions, track accuracy over time. [Manifold Markets](https://manifold.markets/) — prediction market mechanics for probability calibration.* |

---

## Phase 8: Performance & Infrastructure

> Fast, cheap, and stable at scale.

| # | Feature | Notes |
|---|---|---|
| 1 | **Parallel execution with speculative decoding** — Council members run in parallel (already true). Add speculative branch: fast small model generates a draft, full council validates/expands. Reduces perceived latency on simple queries. | *Ref: [Speculative Decoding (Leviathan et al., 2023)](https://arxiv.org/abs/2211.17192) — foundational paper on draft-then-verify for faster inference. [Medusa](https://github.com/FasterDecoding/Medusa) (Apache 2.0) — multi-head speculative decoding for LLMs.* |
| 2 | **Advanced semantic caching** — Cache at multiple levels: exact query, semantic similarity (pgvector), and council configuration. Hit rate metrics in the analytics dashboard. | *Ref: [GPTCache](https://github.com/zilliztech/GPTCache) (MIT, 7k stars) — semantic caching layer for LLM queries with embedding-based similarity matching. [Redis Vector Search](https://redis.io/docs/latest/develop/interact/search-and-query/query/vector-search/) — vector similarity on your existing Redis stack.* |
| 3 | **Intelligent task routing** — Classify query complexity before sending to the council. Simple factual queries → single fast model. Complex reasoning → full council. Classification is transparent and overridable. | *Ref: [RouteLLM](https://github.com/lm-sys/RouteLLM) (MIT, LMSYS, 3k stars) — cost-effective LLM routing based on query complexity classification. [Martian](https://withmartian.com/) — intelligent model routing for cost/quality optimisation.* |
| 4 | **DNS rebinding protection** — SSRF target IP validated at connection time, not just at input validation time | *Ref: [ssrf-req-filter](https://github.com/nicolo-ribaudo/ssrf-req-filter) — Node.js SSRF protection with DNS rebinding mitigation. [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).* |
| 5 | **Per-tool rate limiting in MCP client** | *Ref: [MCP Specification](https://modelcontextprotocol.io/specification) — Model Context Protocol rate limiting guidance.* |
| 6 | **Field-level encryption** for conversation content (PII in chat messages) | *Ref: [Mongoose Field-Level Encryption](https://www.mongodb.com/docs/manual/core/csfle/) pattern. [node-seal](https://github.com/nicolo-ribaudo/node-seal) — homomorphic encryption library. For Drizzle ORM: custom column transformers with AES-256-GCM (already used in your crypto layer).* |
| 7 | **JWT refresh token single-use enforcement** (prevent parallel refresh race) | *Ref: [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html) — refresh token rotation best practices. [Auth.js](https://github.com/nextauthjs/next-auth) (ISC, 26k stars) — implements single-use refresh token rotation.* |
| 8 | **SBOM generation** and `npm audit` enforcement in CI | *Ref: [CycloneDX](https://github.com/CycloneDX/cyclonedx-node-npm) (Apache 2.0) — SBOM generation for npm projects. [Syft](https://github.com/anchore/syft) (Apache 2.0, 6.5k stars) — SBOM generation for containers and filesystems. [Grype](https://github.com/anchore/grype) (Apache 2.0, 9k stars) — vulnerability scanner against SBOMs.* |
| 9 | **Reduce `any` types** in adapter layer (ongoing lint debt) | *Ref: [typescript-strict-plugin](https://github.com/nicolo-ribaudo/typescript-strict-plugin) — incremental strictness enforcement. [ts-reset](https://github.com/total-typescript/ts-reset) (MIT, 8k stars) — stricter TypeScript defaults. Run `tsc --noUncheckedIndexedAccess` incrementally per module.* |
| 10 | **Sandbox session lifecycle state machine** — Pre-provisioned sandbox sessions with defined states: `provisioning → ready → running → idle → sleeping → restored`. Sessions persist across conversations, snapshot/restore on wake. No cold-start penalty on repeated sandbox use. | *Ref: [Onyx Craft](https://github.com/onyx-dot-app/onyx) sandbox session management.* |
| 11 | **Evals framework** — Automated quality testing for council deliberations against labeled datasets. LLM-as-judge scoring. Builds toward a publishable benchmark for internal enterprise RAG. | *Ref: [Onyx EnterpriseRAG-Bench](https://github.com/onyx-dot-app/EnterpriseRAG-Bench).* |
| 12 | **Local benchmarking tools** — Run a standardised benchmark suite against any locally-installed model (Ollama, LM Studio, etc.) to compare quality, speed, and token throughput before committing to using it. Results stored per model version. | *Ref: [Locally Uncensored](https://github.com/PurpleDoubleD/locally-uncensored) local benchmarking.* |
| 13 | **Durable graph execution + per-step checkpointing** — Every step of every council run and workflow is saved as a checkpoint. If the server crashes mid-deliberation, the run resumes exactly from the last saved step — no lost work, no re-running from scratch. Checkpoints organised by thread (conversation). | *Ref: [LangGraph](https://github.com/langchain-ai/langgraph) durable execution (MIT).* |
| 14 | **Time-travel debugging** — Roll back any workflow or council run to any past checkpoint and replay it with modified state or different parameters. Not just viewing history — actually re-running from a chosen point. Useful for debugging why a run went wrong and testing fixes. | *Ref: [LangGraph](https://github.com/langchain-ai/langgraph) time-travel (MIT).* |
| 15 | **LLM observability layer (self-hosted)** — Full tracing of every LLM call: prompt in, response out, latency, token count, cost, model used. Persisted per run, searchable, exportable. Free self-hosted via [Langfuse](https://github.com/langfuse/langfuse) (MIT) or [Arize Phoenix](https://github.com/Arize-ai/phoenix) (Apache 2.0). Paid cloud option opt-in only. | *Ref: Langfuse / Arize Phoenix as free alternatives to LangSmith.* |

---

## Phase 9: Business & Multi-Tenant *(last, intentionally)*

> Only matters once the product is genuinely worth paying for.

| # | Feature | Notes |
|---|---|---|
| 1 | **SAML / OIDC SSO** — Federated login for enterprise identity providers (Okta, Azure AD, Auth0) | *Ref: [Keycloak](https://github.com/keycloak/keycloak) (Apache 2.0, 25k stars) — open-source identity provider with SAML + OIDC. [node-saml](https://github.com/node-saml/node-saml) (MIT) — SAML 2.0 for Node.js. [openid-client](https://github.com/panva/node-openid-client) (MIT) — certified OIDC relying party for Node.js.* |
| 2 | **Org-level API Keys** — Scoped keys with per-key rate limits and full audit trails | *Ref: [Unkey](https://github.com/unkeyed/unkey) (Apache 2.0, 4k stars) — open-source API key management with rate limiting, analytics, and per-key permissions.* |
| 3 | **Self-hosted Helm Chart** — Kubernetes deployment with horizontal scaling | *Ref: [Helm](https://github.com/helm/helm) (Apache 2.0, 27k stars) — Kubernetes package manager. [Bitnami Charts](https://github.com/bitnami/charts) (Apache 2.0) — production-ready Helm charts for PostgreSQL, Redis, etc. that complement your stack.* |
| 4 | **Data residency controls** — Configurable regions for vector storage and conversation data | *Ref: [CockroachDB](https://github.com/cockroachdb/cockroach) (BSL → Apache 2.0 core) — multi-region SQL with data domiciling. For PostgreSQL: [Citus](https://github.com/citusdata/citus) (AGPL, 11k stars) — distributed PostgreSQL with tenant-based sharding.* |
| 5 | **Tenant isolation** — Per-tenant database schemas, encryption keys, pgvector namespaces | *Ref: [PostgreSQL Row-Level Security (RLS)](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — built-in tenant isolation at the database level. [Nile](https://www.thenile.dev/) — tenant-aware PostgreSQL. [Drizzle ORM RLS](https://orm.drizzle.team/) supports row-level security policies.* |
| 6 | **Usage-based billing** — Stripe + metered billing per deliberation and per token | *Ref: [Stripe Metered Billing](https://docs.stripe.com/billing/subscriptions/usage-based) — official usage-based billing guide. [Lago](https://github.com/getlago/lago) (AGPL, 8k stars) — open-source usage-based billing engine, alternative to Stripe Billing for metered pricing.* |
| 7 | **Onboarding wizard** — Guided setup: provider keys, first council, sample deliberation | *Ref: [Shepherd.js](https://github.com/shepherd-pro/shepherd) (MIT, 13k stars) — guided tour library for web apps. [React Joyride](https://github.com/gilbarbara/react-joyride) (MIT, 7k stars) — step-by-step guided tours for React.* |
| 8 | **Admin super-dashboard** — Cross-tenant usage metrics, health checks, feature flags | *Ref: [Grafana](https://github.com/grafana/grafana) (AGPL, 67k stars) — already in your stack for metrics dashboards. [Unleash](https://github.com/Unleash/unleash) (Apache 2.0, 12k stars) — open-source feature flag management. [PostHog](https://github.com/PostHog/posthog) (MIT, 24k stars) — product analytics with feature flags.* |
| 9 | **Audit log export** — Compliance-ready export of all actions per tenant | *Ref: [OpenTelemetry](https://github.com/open-telemetry/opentelemetry-js) (Apache 2.0, CNCF) — structured event export. [Audit-log best practices](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) (OWASP). For immutable audit trails: [Amazon QLDB concepts](https://en.wikipedia.org/wiki/Merkle_tree) or append-only PostgreSQL tables with hash chaining.* |
| 10 | **White-label** — Custom branding, custom domain, removable Judica attribution | *Ref: [next-themes](https://github.com/pacocoursey/next-themes) (MIT, 6k stars) — theming patterns for React apps. CSS custom properties (`--brand-*`) for runtime theme swapping. [Caddy](https://github.com/caddyserver/caddy) (Apache 2.0, 62k stars) — automatic HTTPS reverse proxy for custom domains.* |

---

## Ideas Under Research

Things worth building but need more thought before committing to an approach:

- **Sensor / environment integration** — AI that can read from IoT sensors, camera feeds, or device state. Interesting for personal assistant use cases. Requires a hardware abstraction layer. *Ref: [Home Assistant](https://github.com/home-assistant/core) (Apache 2.0, 77k stars) — open-source home automation with 2000+ integrations and sensor APIs. [MQTT](https://mqtt.org/) — lightweight IoT messaging protocol.*
- **Offline-first architecture** — Everything that runs against Ollama today could run fully local with local vector DB, local Redis alternative, local auth. Useful for air-gapped environments. *Ref: [PouchDB](https://github.com/pouchdb/pouchdb) (Apache 2.0, 17k stars) — offline-first database that syncs. [Yjs](https://github.com/yjs/yjs) (MIT, 18k stars) — CRDT framework for offline collaboration. [KeyDB](https://github.com/Snapchat/KeyDB) (BSD, 11k stars) — Redis-compatible drop-in for local use.*
- **Evaluation harness** — Automated benchmarking of council accuracy against labeled datasets. Needs labeled data collection first. *Ref: [Promptfoo](https://github.com/promptfoo/promptfoo) (MIT, 5k stars) — LLM eval framework with custom test suites. [RAGAS](https://github.com/explodinggradients/ragas) (Apache 2.0, 8k stars) — RAG evaluation metrics. [DeepEval](https://github.com/confident-ai/deepeval) (Apache 2.0, 4k stars) — unit testing framework for LLMs.*
- **Deliberation replay** — Step-through replay of past councils with claim-level diff view. *Ref: [LangGraph](https://github.com/langchain-ai/langgraph) (MIT) — checkpoint-based replay. [Redux DevTools](https://github.com/reduxjs/redux-devtools) — time-travel state inspection pattern.*
- **A/B council configs** — Run two council configurations side-by-side and compare consensus quality. *Ref: [Promptfoo](https://github.com/promptfoo/promptfoo) — side-by-side prompt/config comparison with scoring. [LMSYS Chatbot Arena](https://arena.lmsys.org/) — blind A/B model comparison methodology.*
- **Federated signal aggregation** — Opt-in anonymised feedback pooling: council members improve from aggregate signal across all users without any private data leaving any user's account. Differential privacy applied before any signal is shared. *Ref: [Flower](https://github.com/adap/flower) (Apache 2.0, 6k stars) — federated learning framework. [OpenDP](https://github.com/opendp/opendp) (MIT, Harvard) — differential privacy library.*
- **AI-assisted spec writer** — User describes a feature or goal in plain language; the council formalises it into a requirements doc, user stories, and acceptance criteria in the format of choice (BDD Gherkin, Agile user stories, RFC, PRD). Output goes to Artifacts tab. *Ref: [Cucumber / Gherkin](https://github.com/cucumber/common) (MIT) — BDD specification language. [MetaGPT](https://github.com/geekan/MetaGPT) (MIT, 48k stars) — generates PRDs, design docs, and user stories from natural language.*
- **Offline-first sync** — Progressive sync when connectivity is intermittent: queue messages and tool results locally, flush when back online. Useful for mobile, poor-connection environments, or air-gapped periods. *Ref: [Yjs](https://github.com/yjs/yjs) (MIT, 18k stars) — CRDT-based sync framework. [PowerSync](https://github.com/powersync-ja/powersync-js) (Apache 2.0) — offline-first sync for PostgreSQL. [WatermelonDB](https://github.com/Nozbe/WatermelonDB) (MIT, 11k stars) — reactive offline-first database for React.*

---

## Free Alternatives Map

Every paid external service used in the platform must have a free/self-hosted alternative. This table is the source of truth. Before shipping any feature that depends on an external service, a free option must be listed here and implemented as the default.

> **Warning indicators:** Features marked ⚠️ in the UI mean "this costs extra credits/tokens beyond your LLM API key." The user must see this before enabling, not after.

### Web Search
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [SearXNG](https://github.com/searxng/searxng) | Free — self-host | Open source meta-search, runs locally in Docker |
| Free | [Brave Search API](https://brave.com/search/api/) | Free tier (2,000 req/mo) | No tracking, independent index |
| Free | DuckDuckGo (scrape) | Free | Fragile, no official API |
| Paid (opt-in) | Tavily | Paid | Higher quality, real-time results |
| Paid (opt-in) | SerpAPI / Serper | Paid | Google results |

### Web Scraping & Crawling
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | Playwright (built-in) | Free — self-host | Already in the codebase |
| Free | [Scrapling](https://github.com/D4Vinci/Scrapling) | Free | Fast, resilient scraping with auto-matching |
| Free | [Crawlee](https://github.com/apify/crawlee) | Free | Open-source, Playwright + Cheerio, Apify's own OSS |
| Free | Scrapy | Free — self-host | Python, mature, extensible |
| Paid (opt-in) | Firecrawl | Paid | Clean markdown extraction, managed |
| Paid (opt-in) | AgentQL | Free tier + paid | Natural language selectors |
| Paid (opt-in) | Apify | Paid | Managed scraping infrastructure |

### Embeddings (for RAG / vector search)
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [nomic-embed](https://ollama.com/library/nomic-embed-text) via Ollama | Free — local | 768-dim, excellent quality, runs offline |
| Free | [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) | Free — local | sentence-transformers, fast |
| Free | [mxbai-embed-large](https://ollama.com/library/mxbai-embed-large) via Ollama | Free — local | High quality, local |
| Paid (opt-in) | OpenAI text-embedding-3-small | Paid | Strong baseline, cheap |
| Paid (opt-in) | Cohere embed | Paid | Good multilingual |

### Reranking
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [bge-reranker](https://huggingface.co/BAAI/bge-reranker-base) | Free — local | Cross-encoder, runs via sentence-transformers |
| Free | [ms-marco-MiniLM](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2) | Free — local | Fast cross-encoder reranker |
| Paid (opt-in) | Cohere Rerank | Paid | High quality, managed |

### Text-to-Speech (TTS) ⚠️
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [Piper TTS](https://github.com/rhasspy/piper) | Free — local | Fast neural TTS, many voices, runs offline |
| Free | [Coqui TTS](https://github.com/coqui-ai/TTS) | Free — local | High quality, voice cloning support |
| Free | edge-tts | Free | Uses Microsoft Edge's cloud TTS, no key needed |
| Paid (opt-in) | ElevenLabs | Paid | Best quality, voice cloning |
| Paid (opt-in) | OpenAI TTS | Paid | Good quality, 6 voices |
| Paid (opt-in) | Azure TTS | Paid | Many voices, enterprise |

### Speech-to-Text (STT) ⚠️
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Free — local | Whisper reimplemented in CTranslate2, 4x faster |
| Free | [Vosk](https://github.com/alphacep/vosk-api) | Free — local | Offline, lightweight, many languages |
| Paid (opt-in) | OpenAI Whisper API | Paid | Managed, no local GPU needed |
| Paid (opt-in) | Google Speech-to-Text | Paid | High accuracy, real-time |

### Image Generation ⚠️
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [Stable Diffusion](https://github.com/AUTOMATIC1111/stable-diffusion-webui) | Free — local | Self-hosted, full control |
| Free | [ComfyUI](https://github.com/comfyanonymous/ComfyUI) + FLUX | Free — local | Node-based, powerful, supports FLUX models |
| Free | [Ollama image models](https://ollama.com) | Free — local | llava and similar |
| Paid (opt-in) | DALL-E 3 | Paid | OpenAI, high quality |
| Paid (opt-in) | Stability AI API | Paid | Managed SD |

### Video Generation ⚠️
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [CogVideoX](https://github.com/THUDM/CogVideo) | Free — local | Open-source video gen, GPU required |
| Free | [LTX-Video](https://github.com/Lightricks/LTX-Video) | Free — local | Fast, high quality, local |
| Free | [Wan 2.1](https://github.com/Wan-Video/Wan2.1) | Free — local | Strong open-source video model |
| Paid (opt-in) | Runway | Paid | Best quality managed |
| Paid (opt-in) | Kling | Paid | Good quality, affordable |

### Memory & Vector Storage
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | pgvector (self-hosted) | Free | Already in the codebase |
| Free | [LanceDB](https://github.com/lancedb/lancedb) | Free — embedded | Serverless, no separate process, stores alongside app data |
| Free | [Chroma](https://github.com/chroma-core/chroma) | Free — local | Simple, embedded vector DB |
| Free | [Qdrant](https://github.com/qdrant/qdrant) | Free — self-host | Fast, feature-rich |
| Free | [mem0 OSS](https://github.com/mem0ai/mem0) | Free — self-host | Hybrid triple-store memory layer (vector + KV + graph) |
| Paid (opt-in) | Pinecone | Paid | Managed, no infra |

### Research / Deep Web
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | SearXNG + Playwright (built-in) | Free | Combined: search + scrape |
| Paid (opt-in) | Firecrawl | Paid | Clean extraction |
| Paid (opt-in) | Tavily research | Paid | AI-optimised search |

### Workflow Automation
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [n8n](https://github.com/n8n-io/n8n) (self-hosted) | Free — self-host | Full workflow engine, 12k records/min, branching, retries, webhooks |
| Free | [Flowise](https://github.com/FlowiseAI/Flowise) | Free — self-host | Visual LLM pipeline builder, WhatsApp/Telegram native |
| Free | [Langflow](https://github.com/logspace-ai/langflow) | Free — self-host | RAG-focused visual flow builder |
| Free | [Dify](https://github.com/langgenius/dify) | Free — self-host | Agent + RAG pipelines, 100+ LLM support |
| Paid (opt-in) | Zapier | Paid | Managed, 6000+ app integrations |

### LLM Observability & Tracing
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [Langfuse](https://github.com/langfuse/langfuse) | Free — self-host (MIT) | Full tracing, prompt versioning, LLM-as-judge eval, 19k stars |
| Free | [Arize Phoenix](https://github.com/Arize-ai/phoenix) | Free — Docker (Apache 2.0) | Single container, full observability, no license keys |
| Free | [OpenLLMetry](https://github.com/traceloop/openllmetry) | Free — open source | OpenTelemetry-based, works with any tracing backend |
| Paid (opt-in) | LangSmith | Paid (not open source) | Self-host requires Enterprise license |

### Browser Automation / Computer Use
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [Browser-Use](https://github.com/browser-use/browser-use) | Free — open source (MIT) | AI-native browser control, 60k stars, referenced in Phase 4 |
| Free | [Playwright](https://github.com/microsoft/playwright) | Free — open source | Already in codebase; headless Chromium/Firefox/WebKit |
| Free | [Puppeteer](https://github.com/puppeteer/puppeteer) | Free — open source | Chrome DevTools Protocol, mature, large ecosystem |
| Paid (opt-in) | BrowserBase | Paid | Managed cloud browser sessions, no local infra |

### Graph Database (for Knowledge Graph / Triple-Store Memory)
| Tier | Provider | Cost | Notes |
|---|---|---|---|
| **Free (default)** | [Apache AGE](https://github.com/apache/age) | Free — open source (Apache 2.0) | Graph extension for PostgreSQL — no new DB process; already using PG |
| Free | [Neo4j Community](https://neo4j.com/licensing/) | Free — self-host | Most widely used graph DB; Cypher query language |
| Free | [ArangoDB Community](https://arangodb.com/community-server/) | Free — self-host | Multi-model: graph + document + key-value in one process |
| Paid (opt-in) | Neo4j Enterprise | Paid | Clustering, hot backups, advanced security |

---

**[Back to README](./README.md)** · [Documentation](./DOCUMENTATION.md) · [Report a Bug](https://github.com/Yash-Awasthi/judica/issues) · [Request a Feature](https://github.com/Yash-Awasthi/judica/issues)

</div>

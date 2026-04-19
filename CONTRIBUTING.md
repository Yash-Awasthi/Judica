# Contributing to AIBYAI

Thanks for your interest in contributing! AIBYAI is a multi-agent deliberative intelligence platform — a council of AI models that argue, critique each other, and produce a scored consensus.

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Architecture Overview](#architecture-overview)
- [Submitting Changes](#submitting-changes)
- [Good First Issues](#good-first-issues)

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **Docker & Docker Compose** (for Postgres + Redis)
- At least one AI provider API key (OpenAI, Anthropic, or Google)

### Local setup

```bash
# 1. Clone
git clone https://github.com/Yash-Awasthi/aibyai.git
cd aibyai

# 2. Copy env and fill in the required fields
cp .env.example .env
# Edit .env — minimum required:
#   DATABASE_URL, JWT_SECRET, MASTER_ENCRYPTION_KEY
#   At least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY

# 3. Start Postgres + Redis
docker compose up db redis -d

# 4. Run database migrations
npm run db:push

# 5. Install dependencies
npm install
cd frontend && npm install && cd ..

# 6. Start both backend + frontend (hot reload)
npm run dev:all
```

The backend runs on `http://localhost:3000` and the frontend on `http://localhost:5173`.

### Full Docker setup (production-like)

```bash
cp .env.example .env  # fill in values
docker compose up     # spins up app, db, redis, prometheus, grafana
```

---

## Project Structure

```
aibyai/
├── src/                        # Backend (Fastify + TypeScript)
│   ├── adapters/               # Per-provider LLM adapters (OpenAI, Anthropic, Gemini…)
│   ├── agents/                 # Orchestrator, shared memory, fact graph
│   ├── config/                 # Env validation, quotas, archetypes
│   ├── db/schema/              # Drizzle ORM schemas
│   ├── lib/
│   │   ├── council.ts          # Core deliberation loop
│   │   ├── reasoningModes.ts   # Socratic / Red-Blue / Hypothesis / Confidence
│   │   ├── archetypes.ts       # Built-in archetype definitions
│   │   ├── providers.ts        # Provider types + routing
│   │   └── ...
│   ├── middleware/             # Auth, rate limiting, quota, validation
│   ├── processors/             # File processors (image, PDF, audio, text)
│   ├── routes/                 # Fastify route plugins
│   ├── services/               # Business logic (conversation, council, artifacts…)
│   └── index.ts                # Entry point
│
├── frontend/src/               # React 19 + Vite + Tailwind
│   ├── components/             # UI components (ChatArea, MessageList, …)
│   ├── hooks/                  # useDeliberation, useCouncilMembers, …
│   ├── views/                  # Page-level views
│   └── router.tsx              # React Router config
│
├── tests/                      # Vitest tests (2700+ test cases)
│   ├── config/                 # Archetype + config tests
│   ├── routes/                 # Route handler unit tests
│   ├── services/               # Service-layer unit tests
│   └── integration/            # Integration tests (require live DB)
│
├── docker-compose.yml
├── eslint.config.js
├── tsconfig.json
└── drizzle.config.ts
```

---

## Development Workflow

### Backend only

```bash
npm run dev          # tsx with hot reload, reads .env
npm run typecheck    # tsc --noEmit (no emit, just check)
npm run lint         # eslint src/**/*.ts
```

### Frontend only

```bash
cd frontend
npm run dev          # Vite dev server on :5173
npm run build        # production build
```

### Database

```bash
npm run db:push      # push schema changes to DB (dev)
npm run db:generate  # generate migration files
npm run db:studio    # open Drizzle Studio in browser
```

---

## Running Tests

```bash
npm test                          # run all tests once
npm run test:watch                # watch mode
npm run test:ci                   # verbose + bail on first failure
npm run test:coverage             # with coverage report
```

Tests use **Vitest** with heavy mocking — no live database required for unit tests. Integration tests in `tests/integration/` do require a running Postgres instance.

When adding a feature, add tests in the matching `tests/` subdirectory. The project targets >90% coverage on new services.

---

## Code Style

- **TypeScript strict mode** is on — avoid `any` where possible (existing warnings are known debt)
- **No `console.log`** in `src/` — use the pino `logger` from `src/lib/logger.ts`
- **Fastify route params**: unused `request`/`reply` args must be prefixed `_request`/`_reply`
- **Imports**: remove unused imports before committing — CI runs ESLint and will warn
- **Error re-throws**: always pass `{ cause: err }` when wrapping a caught error

ESLint runs automatically on `npm run lint`. CI will fail on any `error`-level lint findings (warnings are acceptable for now).

---

## Architecture Overview

### The deliberation loop

```
User question
     │
     ▼
┌─────────────────────────────────────┐
│  Router (classifyQuery)             │  ← selects SUMMONS archetype set
│  Reasoning mode dispatcher          │  ← standard / socratic / red_blue / …
└─────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────────────────────┐
│  Council members (Provider[])                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Agent A  │  │ Agent B  │  │ Agent C  │  …        │
│  └──────────┘  └──────────┘  └──────────┘           │
│        ↕ peer review (N rounds)                      │
└──────────────────────────────────────────────────────┘
     │
     ▼
┌────────────────────────────┐
│  Master synthesizer        │  ← final verdict + confidence score
└────────────────────────────┘
     │
     ▼
SSE stream → frontend
```

### Key concepts

| Concept | File | Description |
|---------|------|-------------|
| **Provider** | `src/lib/providers.ts` | Unified LLM interface (OpenAI, Anthropic, Gemini, Groq…) |
| **Archetype** | `src/config/archetypes.ts` | Persona + system prompt template for a council member |
| **SUMMONS** | `src/lib/archetypes.ts` | Named sets of archetypes grouped by query type |
| **Council** | `src/lib/council.ts` | Orchestrates the deliberation loop |
| **Reasoning mode** | `src/lib/reasoningModes.ts` | Pluggable strategies (Socratic, Red/Blue, Hypothesis, Confidence) |
| **Router** | `src/lib/router.ts` | Classifies questions and selects appropriate SUMMONS |

### Adding a new AI provider

1. Create `src/adapters/myprovider.adapter.ts` — implement `callProvider()` and `streamProvider()`
2. Register it in `src/router/index.ts` under the provider routing table
3. Add the API key variable to `.env.example`
4. Add tests in `tests/adapters/`

### Adding a new reasoning mode

1. Add your mode to `ReasoningMode` union in `src/lib/reasoningModes.ts`
2. Implement `runMyMode(question, members)` in the same file
3. Wire it into `src/routes/ask.ts` (both POST `/` and POST `/stream`)
4. Add the mode to the `deliberation_mode` enum in `src/middleware/validate.ts`
5. Add the option to `CouncilConfigPanel` in the frontend

### Adding a new archetype

Archetypes live in `src/config/archetypes.ts`. Add a new entry to the `ARCHETYPES` map and include it in the relevant `SUMMONS` category. Run `npm test` — the archetype tests will validate the shape automatically.

---

## Submitting Changes

1. **Fork** the repo and create a branch: `git checkout -b feat/my-feature`
2. Make your changes with tests
3. Run `npm test && npm run lint && npm run typecheck` — all must pass
4. Open a PR with a clear description of what and why
5. Keep PRs focused — one feature or fix per PR

### Commit style

```
feat(scope): short description
fix(scope): short description
chore: short description
docs: short description
```

Examples: `feat(reasoning): add devil's advocate mode`, `fix(auth): handle expired JWT gracefully`

---

## Good First Issues

If you're new to the codebase, these areas are well-contained and good starting points:

- **Reduce `no-explicit-any` warnings** — pick any file in `src/adapters/` and replace `any` with proper types
- **Add a new archetype** — add a persona to `src/config/archetypes.ts` and its SUMMONS membership
- **Improve streaming UI** — the frontend doesn't yet visualize `mode_phase` SSE events from reasoning modes
- **Write missing tests** — `tests/services/` has good coverage; `tests/routes/` always needs more cases
- **Empty catch blocks** — a few `// no-op` catch blocks in strategies could log a debug message instead

---

## Questions?

Open a [GitHub Discussion](https://github.com/Yash-Awasthi/aibyai/discussions) or file an [issue](https://github.com/Yash-Awasthi/aibyai/issues).

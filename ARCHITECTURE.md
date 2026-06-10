# Judica — Architecture

> Last updated: 2026-06-10

---

## Overview

Judica is a full-stack, self-hosted AI orchestration platform. It is composed of five independent deployable units that communicate over HTTP/SSE:

```
┌─────────────────────────────────────────────────────────┐
│                      Client Layer                       │
│  Browser (React Router 7)  │  Desktop (Electron/Tauri)  │
│  Chrome Extension          │  CLI (Node.js)             │
└────────────────┬────────────────────────────────────────┘
                 │ HTTP / SSE / WebSocket
┌────────────────▼───────────────────────────────────────┐
│              Fastify API Server  (src/)                 │
│  140+ route handlers  │  80+ services  │  Drizzle ORM   │
└──────┬──────────────────────────┬──────────────────────┘
       │                          │
┌──────▼──────┐           ┌───────▼──────┐
│  PostgreSQL │           │  Cloudflare  │
│  pgvector   │           │  Workers     │
│  Redis      │           │  (edge API)  │
└─────────────┘           └──────────────┘
```

---

## Repo Layout

```
Judica/
├── frontend/               # React Router 7 SPA
│   └── app/
│       ├── routes/         # 90+ file-based routes
│       ├── components/     # 38 shared components
│       ├── hooks/          # 5 custom hooks
│       ├── lib/            # Client-side utilities (council, deliberate, stm…)
│       ├── context/        # React context providers (Auth, Theme, Store)
│       └── schemas/        # Zod validation schemas
├── src/                    # Fastify backend
│   ├── app.ts              # Server bootstrap, plugin registration
│   ├── routes/             # 140+ route handlers (one file per domain)
│   ├── services/           # 80+ business-logic services
│   ├── db/                 # Drizzle schema + migrations
│   └── lib/                # Shared backend utilities
├── tests/
│   ├── e2e/                # Playwright end-to-end specs (55+ files)
│   └── services/           # Vitest unit + integration tests (80+ files)
├── electron/               # Desktop wrapper (Electron)
├── desktop/                # Alternative desktop wrapper (Tauri)
├── extensions/chrome/      # Chrome extension (esbuild bundle)
├── cli/                    # Node.js CLI tool
├── docs/                   # Extended documentation
│   ├── DOCUMENTATION.md    # Full API + setup reference
│   ├── CONTRIBUTING.md
│   ├── ROADMAP.md
│   ├── SECURITY.md
│   └── THREAT_MODEL.md
├── docker-compose.yml
├── Dockerfile
├── drizzle.config.ts
└── wrangler.jsonc          # Cloudflare Workers config
```

---

## Frontend Architecture

### Routing

React Router 7 with file-based routing. Every file in `app/routes/` auto-registers a route. The `app/routes.ts` manifest maps URL segments to files (e.g. `"dashboard" → "routes/home.tsx"`).

Root layout (`app/root.tsx`) wraps all authenticated routes with:
- `SidebarProvider` + `AppSidebar` (collapsible nav, 60+ links across 7 groups)
- `AuthProvider` → JWT cookie validation + redirect guard
- `ThemeProvider` → dark / light / matrix / glyph themes via CSS variables
- PWA service worker registration

Public paths (`/`, `/login`, `/register`, `/setup`) bypass the sidebar layout.

### State

No global state manager. State lives in:
- Component `useState` / `useReducer` for local UI state
- `localStorage` for user preferences, codegen sessions, project instructions, STM module selection
- API calls (fetch + SSE) for server state — no React Query, no SWR

### Streaming

SSE (Server-Sent Events) is used throughout for long-running AI operations:
- `deliberate()` → `/api/deliberate` → opinion + verdict streams
- `/api/parseltongue/analyze` → 5 parallel specialist streams
- `/api/codegen/generate` → code generation stream
- `/api/research/stream/:jobId` → deep research progress + report

Each SSE consumer follows the same pattern: `ReadableStreamDefaultReader` → `TextDecoder` → `buf.split("\n")` → `JSON.parse(line.slice(6))` → dispatch to state.

### Key Feature Components

| Component | Purpose |
|---|---|
| `DiffViewer` + `DiffBlock` | Myers diff algorithm, per-hunk accept/reject/edit, rollback |
| `ContextMention` + `useContextMention` | `@file:` / `@symbol:` / `@web:` inline context syntax with floating picker |
| `CitationRenderer` + `CitationBadge` + `CitationCard` | Inline `[N]` citation parsing, confidence badges, hover cards |
| `CitationsSidebar` | Collapsible citations panel in Deep Research |
| `RelatedQuestions` | Post-report follow-up chips |
| `ProjectMemoryPanel` | Per-project memory entries (fetch/add/forget) |
| `ProjectFileAttachments` | Drag-and-drop file attach (10 files, 5MB, 12 file types) |
| `ProjectInstructions` | Per-project system prompt + STM module toggles |
| `CodeEditor` | Syntax-highlighting textarea with copy/download |
| `PreviewPane` | Sandboxed iframe for live HTML/React/Vue preview |
| `ContinueEditingBar` | Resume codegen sessions from localStorage (7-day TTL) |
| `DiffSessionToolbar` | Accept all / reject all / rollback toolbar |

---

## Backend Architecture

### Server Bootstrap (`src/app.ts`)

Fastify instance with plugins registered in order:
1. `fastify-cors`, `@fastify/multipart`, `@fastify/cookie`
2. Auth plugin (JWT middleware, session validation)
3. Rate limiting + CSRF
4. Domain route plugins (each file in `src/routes/` registered with `fastify.register()`)

### Route Domains

| File | Endpoints |
|---|---|
| `auth.ts` | Login, register, OAuth callbacks, session refresh |
| `council.ts` | Council member CRUD, model presets |
| `deliberate.ts` | SSE deliberation engine, thread management |
| `parseltongue.ts` | Parallel specialist code analysis (SSE) |
| `codegen.ts` | SSE code generation, iterate, compile, sessions |
| `diff.ts` | Diff parse, apply to filesystem, snapshot/rollback |
| `context.ts` | File/symbol/web context search for `@` mentions |
| `research.ts` | Deep research job queue, SSE stream, related questions |
| `memory.ts` | Memory entries CRUD, semantic search, forget |
| `projects.ts` | Projects CRUD + file attachments |
| `autotune.ts` | Prompt optimizer SSE loop |
| `connectors.ts` | 50+ connector integrations (Slack, Notion, GitHub…) |
| `workflows.ts` | Visual workflow engine — node execution, scheduling |
| `knowledge-bases.ts` | RAG ingestion, chunking, vector search |
| `analytics.ts` | Usage metrics, provider stats, daily breakdowns |
| `billing.ts` | Stripe integration, usage limits, SCIM |
| `stm.ts` | Short-term memory modules, injection, history |

### Services Layer (`src/services/`)

Business logic is separated from route handlers into service classes. Services handle:
- LLM API calls (Anthropic, OpenAI, Gemini, Ollama, custom endpoints)
- Vector store operations (pgvector, Pinecone, Weaviate)
- Semantic caching
- Background agent orchestration
- Connector sync scheduling
- Evaluation scoring

### Database

Drizzle ORM with PostgreSQL 16 + pgvector extension.

Key tables: `users`, `threads`, `messages`, `council_members`, `projects`, `project_files`, `memory_entries`, `knowledge_bases`, `documents`, `workflows`, `workflow_runs`, `connectors`, `api_tokens`, `billing_events`, `notifications`, `audit_log`.

All schema in `src/db/schema.ts`. Migrations via `drizzle-kit generate`.

---

## Data Flow — Deliberation

```
User types prompt → Enter
        │
        ▼
POST /api/deliberate
        │
        ▼
CouncilService.deliberate(threadId, prompt, members)
        │
        ├──▶ [member 1] LLM call (streaming) ──▶ SSE: { type:"opinion", label, text }
        ├──▶ [member 2] LLM call (streaming) ──▶ SSE: { type:"opinion", label, text }
        └──▶ [member N] LLM call (streaming) ──▶ SSE: { type:"opinion", label, text }
                                                        (all parallel, Promise.all)
        │
        ▼
SynthesisService.synthesize(opinions) ──▶ SSE: { type:"verdict", text }
        │
        ▼
SSE: { type:"done", round, totalMs }
```

---

## Data Flow — @context Mentions

```
User types "@file:chat" in textarea
        │
        ▼
useContextMention hook detects /@(file|symbol|web):(.*)$/
        │
        ▼
ContextPickerOverlay debounces 150ms → GET /api/context/files?q=chat
        │
        ▼
context.ts → walks project files, fuzzy matches name
Returns: [{ name, path, size }]
        │
        ▼
User clicks result → ContextPill injected into textarea
        │
        ▼
On send → POST /api/context/resolve with mention list
Returns: file contents (up to 4k per file) prepended to prompt
```

---

## Data Flow — CodeGen + Diff

```
User describes component → Generate
        │
        ▼
POST /api/codegen/generate (SSE)
        │
        ▼
AnthropicService.stream() → chunks → client renders in CodeEditor
        │
        ▼
User clicks "Apply" → POST /api/diff/apply
        │
        ▼
diff.ts: snapshot current file → apply accepted hunks → write to filesystem
Returns: { rollbackId }
        │
        ▼
User can POST /api/diff/rollback { rollbackId } to revert
```

---

## Testing

| Layer | Tool | Location |
|---|---|---|
| Unit / integration | Vitest | `tests/services/` (80+ files) |
| E2E | Playwright | `tests/e2e/` (55+ files) |
| Frontend smoke | Playwright | `frontend/e2e/smoke.test.mjs` |

E2E test areas: auth, deliberation, god-mode, parseltongue, autotune, ultraplinian, workflows, connectors, deep-research, image-gen, kb-upload, marketplace, @context-mention, diff-ui, citations, projects, codegen.

---

## Environment

See `.env.example` for the full list (200+ variables). Essential ones:

```env
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
JWT_SECRET=...
SESSION_SECRET=...
REDIS_URL=redis://...
```

---

## Deployment

| Method | Command |
|---|---|
| Docker (production) | `docker compose up -d` |
| Dev (backend) | `npm run dev` (Fastify, port 3000) |
| Dev (frontend) | `cd frontend && npm run dev` (Vite, port 5173) |
| Desktop | `cd electron && npm start` |
| Edge (Cloudflare) | `wrangler deploy` |
| Chrome extension | `cd extensions/chrome && npm run build` → load `dist/` |

---

## Phase Delivery History

| Phase | Features |
|---|---|
| Phase 1 | `.env.example`, `install.sh`, onboarding wizard, README, 12 E2E specs |
| Phase 2 | ULTRAPLINIAN, God Mode Classic, Parseltongue, AutoTune, STM, PWA |
| Phase 3 | Analytics wiring, Settings backend, Chrome extension, Connector onboarding |
| Phase 4 | @context syntax + live picker, DiffViewer (Myers algo), CodeGen page, inline citations, projects detail panel (Memory/Files/Instructions), 5 new E2E specs |

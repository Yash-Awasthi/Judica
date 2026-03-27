# 🏛️ AI Council

A production-grade multi-model AI verdict engine. Ask any question — multiple AI models deliberate simultaneously, and a designated master synthesizes a final verdict.

Built to explore AI orchestration, multi-provider APIs, streaming responses, and secure backend architecture.

## What it does

- Sends any question to multiple AI models **simultaneously**
- Each model gives its own opinion (Opinions tab)
- A designated **Master** model reads all responses and writes a synthesized verdict
- **Streaming** — answers appear word by word as models respond (SSE)
- **Council templates** — pre-built councils for Debate, Research, Technical, and Creative tasks
- **Any AI provider** — NVIDIA, OpenAI, Anthropic, Google, Groq, OpenRouter, or any OpenAI-compatible API
- **Accounts** — login to save your council config and chat history per user
- **Encrypted API keys** — keys are AES-256 encrypted before hitting the database
- Works without an account too — guest mode for quick use

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js v20 + TypeScript |
| Backend | Express.js |
| Database | PostgreSQL via Prisma ORM |
| Auth | JWT + bcrypt |
| Streaming | Server-Sent Events (SSE) |
| Security | Helmet, Zod validation, AES-256 encryption, rate limiting |
| Frontend | Vanilla HTML/CSS/JS |
| Containerization | Docker + docker-compose |

## Supported AI Providers

| Provider | Type | Free Tier |
|---|---|---|
| NVIDIA (Kimi K2.5, GLM-5, MiniMax, Llama) | OpenAI-compatible | ✅ Yes |
| Google (Gemini 2.5 Flash) | Google API | ✅ Yes |
| OpenAI (GPT-4o, o3) | OpenAI-compatible | ❌ Paid |
| Anthropic (Claude) | Anthropic API | ❌ Paid |
| Groq, OpenRouter, any OpenAI-compatible | OpenAI-compatible | ✅ Some free |

## Project Structure
```
council-project/
├── src/
│   ├── config/
│   │   └── env.ts              # Env validation — crashes fast if misconfigured
│   ├── routes/
│   │   ├── ask.ts              # /ask — standard council endpoint
│   │   ├── stream.ts           # /stream — SSE streaming endpoint
│   │   ├── history.ts          # /history — per-user chat history
│   │   ├── auth.ts             # /auth — register, login, config save/load
│   │   └── templates.ts        # /templates — pre-built council templates
│   ├── middleware/
│   │   ├── auth.ts             # JWT verification (requireAuth / optionalAuth)
│   │   ├── rateLimit.ts        # Rate limiting per endpoint
│   │   ├── validate.ts         # Zod schema validation
│   │   └── errorHandler.ts     # Centralized error handling
│   ├── lib/
│   │   ├── providers.ts        # Universal AI provider adapter + streaming
│   │   ├── db.ts               # Prisma client
│   │   ├── crypto.ts           # AES-256 encrypt/decrypt for API keys
│   │   ├── logger.ts           # Pino structured logger
│   │   └── templates.ts        # Council template definitions
│   └── index.ts                # Express app entry point
├── prisma/
│   └── schema.prisma           # PostgreSQL schema
├── public/
│   └── index.html              # Frontend
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Getting Started

### Option A — Docker (recommended)
```bash
git clone https://github.com/Yash-Awasthi/ai-council.git
cd ai-council
cp .env.example .env
# Fill in JWT_SECRET and ENCRYPTION_KEY in .env
docker-compose up --build
```

Open `http://localhost:3000`

### Option B — Local

**Prerequisites:** Node.js v20+, PostgreSQL
```bash
git clone https://github.com/Yash-Awasthi/ai-council.git
cd ai-council
npm install
cp .env.example .env
# Fill in .env values
npm run db:migrate
npm run db:generate
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | ✅ | Min 16 chars, used to sign tokens |
| `ENCRYPTION_KEY` | ✅ | Exactly 32 chars, used to encrypt API keys |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `PORT` | ❌ | Defaults to 3000 |
| `NODE_ENV` | ❌ | development / production |
| `NVIDIA_API_KEY` | ❌ | Optional default key for NVIDIA models |

### Getting a Free NVIDIA API Key

1. Go to https://build.nvidia.com/settings/api-keys
2. Create a free account
3. Generate a key starting with `nvapi-`
4. Paste it into the API key field for each council member in the UI

## API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/ask` | Optional | Ask the council (standard) |
| POST | `/stream` | Optional | Ask the council (SSE streaming) |
| GET | `/history` | Required | Get user chat history |
| DELETE | `/history/:id` | Required | Delete a chat |
| POST | `/auth/register` | — | Register account |
| POST | `/auth/login` | — | Login |
| GET | `/auth/config` | Required | Load council config |
| POST | `/auth/config` | Required | Save council config |
| GET | `/templates` | — | List council templates |
| GET | `/health` | — | Server health check |

## How a Question Flows
```
User asks question
       ↓
Rate limiter checks request
       ↓
Zod validates request body
       ↓
Orchestrator fans out to all council members simultaneously (Promise.all)
       ↓
Each member streams response via SSE (word by word)
       ↓
Master model receives all responses + original question
       ↓
Master synthesizes a single verdict (also streamed)
       ↓
Chat saved to PostgreSQL
       ↓
User sees Verdict tab (default) or Opinions tab
```

## Security

- **Helmet** — sets 11 HTTP security headers
- **AES-256 encryption** — API keys encrypted before DB storage
- **Zod validation** — all request bodies schema-validated
- **JWT auth** — stateless, 7-day expiry
- **bcrypt** — passwords hashed with cost factor 12
- **Rate limiting** — 10 req/min on `/ask`, 20 req/15min on `/auth`
- **Input limits** — max 2000 char questions, 50kb request body
- **Centralized error handler** — no stack traces in production

## Council Templates

| Template | Description |
|---|---|
| Debate | Members argue opposing sides, master finds truth |
| Research | Deep analysis from multiple academic angles |
| Technical | Engineering and architecture decisions |
| Creative | Brainstorming and creative problem solving |

## What I Learned

- Orchestrating parallel async API calls with `Promise.all` across multiple providers
- Building a universal adapter for Anthropic, Google, and OpenAI-compatible APIs
- Server-Sent Events (SSE) for real-time streaming across concurrent connections
- JWT authentication and bcrypt password hashing from scratch
- PostgreSQL schema design and migrations with Prisma ORM
- Production hardening — rate limiting, input validation, encrypted secrets, graceful shutdown
- Working with alpha-stage SDKs (NemoClaw, announced March 2026)
- Docker + docker-compose for containerized deployment

## Roadmap

- [ ] Wire streaming into frontend UI
- [ ] Custom system prompts per council member in UI
- [ ] Export chat history as PDF
- [ ] Public council sharing via link
- [ ] Stitch UI redesign


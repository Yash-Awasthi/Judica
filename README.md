# AIbyAI — Multi-Agent AI Deliberation Engine

**AIbyAI** is an open-source platform where multiple AI agents debate, critique, and synthesize answers through a structured deliberation pipeline. Unlike single-model chatbots, AIbyAI produces mathematically validated consensus by pitting diverse AI perspectives against each other in real-time.

## Why AIbyAI?

| Single-Model Chat | AIbyAI Council |
|---|---|
| One perspective | 4+ agents with distinct archetypes |
| Trust the model blindly | Peer review + Cold Validation |
| No quality signal | Deterministic ML scoring (cosine similarity) |
| Groupthink by default | Anti-convergence protocol (Bloom Gate) |

## Quick Start

```bash
# Clone & install
git clone https://github.com/Yash-Awasthi/aibyai.git
cd aibyai && npm install
cd frontend && npm install && cd ..

# Configure (copy .env.example → .env and add your API keys)
cp .env.example .env

# Initialize database
npx prisma generate && npx prisma migrate dev --name init

# Run
npm run dev:all
```

Open [http://localhost:5173](http://localhost:5173)

## How Deliberation Works

`Query → Auto-Routing → Parallel Agents → Peer Review → Debate Rounds → Deterministic Scoring → Synthesis → Cold Validation → Verdict`

1. **Auto-Routing**: Classifies query type, selects optimal archetypes
2. **Parallel Generation**: 4+ agents process the query concurrently
3. **Peer Review**: Structured critiques `{target, claim, issue, correction}`
4. **Multi-Round Debate**: Iterative refinement with anti-convergence guard
5. **Scoring**: `final = 0.6 × Agreement + 0.4 × PeerRanking` (pure ML, zero LLM influence)
6. **Bloom Gate**: Halts if refinement degrades quality below previous round
7. **Synthesis**: Master model constructs final verdict from debate history
8. **Cold Validation**: Independent zero-context model checks for hallucinations

## Supported Providers

- **OpenAI** (GPT-4o, GPT-5.x) — via API
- **Anthropic** (Claude 3.5/4) — via API
- **Google** (Gemini 2.x) — via API
- **Ollama** (Llama, Mistral, etc.) — local models
- **OpenAI-Compatible** (Groq, Mistral API, NVIDIA NIM, Cerebras)

## Architecture

`Frontend (React + Vite) → Express API → Council Engine → Provider Adapters → ML Scoring (Transformers.js) → PostgreSQL + pgvector → Redis (cache + sessions)`

The project has been refactored into a clear, modular structure:
- `frontend/`: The React + Vite SPA using `react-router-dom` for mode navigation.
- `src/api/`: Express routes and middleware.
- `src/core/`: The multi-agent deliberation engine, deterministic scoring, and validation.
- `src/providers/`: The Universal Provider Adapter with real-time SSE streaming.
- `src/streaming/`: Dedicated SSE handling for the frontend connection.
- `src/services/`: Database and history services.
- `src/lib/`: Shared utilities, cache, and logger.

## API

```bash
# Streaming deliberation
POST /api/ask/stream
Content-Type: application/json

{
  "question": "What are the trade-offs of microservices?",
  "mode": "auto"
}
# Returns: SSE stream with opinion, peer_review, scored, verdict events
```

See `ARCHITECTURE.md` for full API reference.

## License

MIT
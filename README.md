[ 📖 README ](./README.md) | [ 🗺️ ROADMAP ](./ROADMAP.md)

# 🏛️ AI Council: Multi-Agent Deliberation Prototype

## Description

**A high-fidelity orchestration platform for AI reasoning, consensus building, and multi-agent deliberation.**

AI Council is an orchestration engine that allows you to pit multiple AI agents against each other in real-time deliberation. Instead of relying on a single model's output, Council leverages diverse perspectives from specialized archetypes (e.g., The Architect, The Contrarian, The Ethicist) to identify blind spots, reduce hallucinations, and produce a synthesized "Master Verdict".

---

## 🎯 Key Features

### 🚀 Core Capabilities

- **Deterministic Scoring Engine**: Mathematical consensus based on local ML embeddings (cosine similarity).
- **Hardened Peer Review**: Structured logic audit {target, claim, issue, correction} for every critique.
- **Round Quality Validation**: "Bloom Gate" prevents refinement rounds from degrading the previous best score.
- **Outlier Filtering**: Mathematically excludes agents with low agreement (< 0.5) to protect the consensus core.
- **Fallback Normalization**: Automatic 0.9x score penalty for fallback models.

### 🎭 Diverse Perspectives
- **12+ built-in archetypes** with unique thinking styles, system prompts, and tool access
- **True Multi-Round Deliberation**: Interactive peer feedback loops with iterative refinement
- **Streaming Architecture**: End-to-end SSE for real-time word-by-word streaming from multiple models

### 🧠 Robust Consensus Building
- **Deterministic Scoring Engine**: Evaluates agreement levels, identifies outliers, and detects early consensus
- **Cold Validator / Fresh Eyes**: Independent model validates final synthesis for hallucinations and logical gaps
- **Semantic Memory**: Persistent conversation history with pgvector for context-aware responses

### 🔧 Universal Provider Adapter
- **Seamless Integration**: Works with Google Gemini, Anthropic Claude, OpenAI-compatible APIs (NVIDIA NIM, Groq, Mistral, Cerebras), and local models
- **Built-in Fallbacks**: Graceful degradation when providers fail or rate limit

---

## 📊 System Architecture

```mermaid
flowchart TD
    subgraph "Frontend"
        UI[React Tabbed UI]
        PIIWarn[PII Warning Modal]
        Cost[Cost Tracker]
        Audit[Audit Logs]
    end
    
    subgraph "API Layer"
        Router[Express Router]
        PII[PII Middleware]
        Ask[/api/ask]
        Stream[/api/ask/stream]
        PiiRoute[/api/pii]
    end
    
    subgraph "Core Engine"
        Delib[Council Deliberator]
        MLWorker[ML Worker / Transformers.js]
        Score[Deterministic Scoring Engine]
        Controller[Deliberation Controller]
        Cold[Cold Validator]
        Arche[Archetype System]
    end
    
    subgraph "Providers"
        Remote[OpenAI/Claude/Gemini]
        Local[Ollama/Local AI]
    end
    
    subgraph "Data Layer"
        PG[(PostgreSQL + pgvector)]
        Redis[(Redis Cache)]
    end
    
    UI --> Router
    PIIWarn --> PII
    Router --> PII
    PII --> Ask
    Ask --> Delib
    Delib --> Score
    Score --> Cold
    Delib --> Arche
    Delib --> Remote
    Delib --> Local
    Delib --> PG
    Delib --> Redis
    Cold --> PG
```

---

## 🧰 Tech Stack

| **Scoring** | Deterministic ML | Average pairwise cosine similarity via local embeddings. |
| **ML Worker** | Transformers.js / Python | High-fidelity sentence embeddings (all-MiniLM-L6-v2). |
| **Logic Purge** | 100% Mathematical | Zero LLM-influence on consensus or early-halt decisions. |
| **Synthesis** | Gemini / OpenAI | Master model for final verdict synthesis. |

---

## � Quick Start (Docker - Recommended)

The easiest way to get AI Council running is via Docker Compose. This ensures all constraints and dependencies are perfectly isolated.

```bash
# Clone repository
git clone https://github.com/Yash-Awasthi/ai-council.git
cd ai-council

# Run with Docker Compose
docker-compose up -d
```

---

## 🛠️ Manual Installation

### 1. Install Dependencies
```bash
npm install
cd frontend && npm install && cd ..
```

### 2. Environment Setup
Copy `.env.example` to `.env` and fill in your API keys.

```env
JWT_SECRET=your_jwt_secret
ENCRYPTION_KEY=32_char_aes_key
DATABASE_URL="postgresql://user:pass@localhost:5432/ai_council"
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
ANTHROPIC_API_KEY=...
```

### 3. Initialize Database
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 4. Run Dev Servers
```bash
npm run dev:all
```

---

## ⚙️ Configuration

### Model Adapters
The Universal Provider Adapter supports multiple endpoint types out of the box, with built-in prefixes and fallback support:

- **OpenAI-Compatible**: NVIDIA NIM, Groq, OpenRouter, Mistral, Cerebras
- **Native Google**: Gemini models (Gemini 2.5 Flash used as default Master)
- **Native Anthropic**: Claude models

### Council Templates
Pre-configured templates define composition of councils:

- **Debate Council**: Contrarian, Architect, Pragmatist
- **Research Council**: Empiricist, Historian, Outsider
- **Technical Council**: Architect, Minimalist, Empiricist

### Key Environment Variables
```env
JWT_SECRET=your_jwt_secret
ENCRYPTION_KEY=32_char_aes_key
DATABASE_URL="postgresql://user:pass@localhost:5432/ai_council"
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
ANTHROPIC_API_KEY=...
```

---

## 🏛️ How It Works (The Deliberation Pipeline)

When a user submits a query, AI Council orchestrates a multi-step deliberation process:

### 1. Auto-Routing
The system automatically classifies queries and selects optimal archetypes using keyword and heuristic analysis.

### 2. Parallel Agent Generation
Multiple agents (e.g., The Contrarian, The Architect, The Ethicist) process the query concurrently, each streaming their distinct reasoning.

### 3. Initial Responses (Round 1)
Agents provide their first perspectives on the query, formatted as structured JSON with confidence scores.

### 4. Peer Review & Ranking
Agents review anonymized responses from their peers, formulating critiques and identifying blind spots.

### 5. Multi-Round Debate Refinement (Phases 4-9)
Agents receive their original answers plus summarized responses of other agents, then engage in iterative debate rounds:
- Identify flaws or gaps in other responses
- Compare with their own reasoning  
- Refine answers based on critique
- Maintain perspective unless strong evidence demands change
- Update confidence based on reasoning quality

### 6. Consensus & Scoring (Mathematical Purity)
A deterministic scoring engine evaluates agreement levels based on ML embeddings.
- **Formula**: `final_score = (0.6 * Agreement) + (0.4 * PeerRanking)`
- **Stopping Rule**: Deliberation halts ONLY when consensus hits the **0.85 (85%)** threshold.
- **Outlier Removal**: Responses with < 0.5 average agreement are excluded.

### 7. Final Synthesis
A Master Model reviews the entire debate history and constructs a cohesive, nuanced final response.

### 8. Cold Validation (Phase 21)
An independent, zero-context model validates the final synthesis for:
- Factual inaccuracies or hallucinations
- Unsupported claims without evidence
- Logical inconsistencies  
- Overconfidence or misleading tone
- Missing critical considerations

### 9. Real-Time Streaming
The entire process is fed back to the client via Server-Sent Events (SSE), allowing users to watch deliberation and synthesis unfold word-by-word.

### 10. Memory Integration
Session context is summarized and stored in pgvector for future reference, enabling the system to build upon previous discussions.

---

## 📡 API Reference

### /ask endpoint

Execute a council deliberation with configurable providers and modes.

#### `POST /api/ask`

**Request Body:**
```json
{
  "question": "What are the implications of quantum computing on cryptography?",
  "mode": "auto | manual",
  "userConfig": {
    "providers": [
      { 
        "name": "openai", 
        "enabled": true,
        "role": "master",
        "priority": 100 
      },
      { 
        "name": "ollama", 
        "enabled": true,
        "role": "member",
        "priority": 90 
      }
    ],
    "maxAgents": 4,
    "allowRPA": true,
    "preferLocalMix": false
  }
}
```

**Parameters:**
- `question` (string, required): The question or prompt for the council to deliberate
- `mode` (string, optional): 
  - `"auto"`: Use system defaults and automatic provider selection
  - `"manual"`: Use userConfig for explicit provider control
- `userConfig` (object, optional): Custom council configuration
  - `providers`: Array of provider configurations
    - `name`: Provider name (must match system provider)
    - `enabled`: Boolean to enable/disable this provider
    - `role`: `"master"` or `"member"` (default: `"member"`)
    - `priority`: Number for selection priority (higher = preferred)
  - `maxAgents`: Number of agents to include (1-6, default: 4)
  - `allowRPA`: Boolean to allow RPA providers (default: true)
  - `preferLocalMix`: Boolean to prefer local/API mix (default: false)

**Response:**
```json
{
  "verdict": "Based on the deliberation, quantum computing presents both opportunities and challenges for cryptography...",
  "opinions": [
    {
      "name": "OpenAI",
      "archetype": "architect", 
      "opinion": "Quantum computing threatens current cryptographic systems..."
    },
    {
      "name": "Ollama",
      "archetype": "contrarian",
      "opinion": "While quantum computing is promising, practical implementation remains distant..."
    }
  ],
  "tokensUsed": 2450,
  "duration": 8500
}
```

**Examples:**

1. **Auto mode with defaults:**
```json
{
  "question": "Explain machine learning",
  "mode": "auto"
}
```

2. **Manual mode with custom providers:**
```json
{
  "question": "Should we adopt remote work permanently?",
  "mode": "manual",
  "userConfig": {
    "providers": [
      { "name": "openai", "enabled": true, "role": "master" },
      { "name": "anthropic", "enabled": true, "role": "member" },
      { "name": "google", "enabled": true, "role": "member" }
    ],
    "maxAgents": 3
  }
}
```

3. **Local-only council:**
```json
{
  "question": "Analyze this codebase",
  "mode": "manual", 
  "userConfig": {
    "providers": [
      { "name": "ollama", "enabled": true, "role": "master" },
      { "name": "lmstudio", "enabled": true, "role": "member" }
    ],
    "maxAgents": 2,
    "allowRPA": false
  }
}
```

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/ask` | `POST` | Execute a council deliberation (synchronous). |
| `/api/ask/stream` | `POST` | Execute a council deliberation with SSE streaming. |
| `/api/council/archetypes` | `GET/POST/DELETE` | Manage council archetypes. |
| `/api/history` | `GET` | Retrieve past conversation history. |
| `/api/history/search` | `GET` | Search conversation history with filters. |
| `/api/pii/check` | `POST` | Check text for PII and get anonymized version. |
| `/api/audit/logs` | `GET` | Retrieve audit logs for requests. |
| `/api/metrics` | `GET` | Token usage and cost metrics. |
| `/api/benchmark` | `POST` | Run automated benchmark tests. |

---

## 🔌 Features

### 🤖 Auto-Routing System (Phase 12)
Automatically selects optimal council members based on query type using keyword and heuristic classification.

### 🧠 Multi-Round Debate Refinement (Phases 4-9)
Agents refine answers through iterative debate rounds with anti-convergence safeguards and confidence-based updates.

### 🛡️ Cold Validator (Phase 21)
Independent model validates final synthesis for factual errors, hallucinations, and logical gaps with strict fallback handling.

### �️ PII Detection & Enforcement (Phase 13)
- Client-side warnings with risk scoring
- Server-side blocking for high-risk PII (SSN, credit cards, API keys)
- Auto-anonymization with placeholder replacement

### 🖥️ RPA Setup (ChatGPT/Claude Desktop Apps)

RPA (Robotic Process Automation) allows AI Council to interact with ChatGPT and Claude via their web interfaces using Playwright automation.

**Install Playwright:**
```bash
npm install playwright
npx playwright install
```

**First-time Login (Required to create sessions):**
```bash
# Login to ChatGPT
npx playwright open https://chat.openai.com

# Login to Claude
npx playwright open https://claude.ai
```

**Sessions are stored in:**
```
./sessions/{provider}.json
```

**Usage in providers.json:**
```json
{
  "name": "chatgpt-rpa",
  "type": "rpa",
  "baseUrl": "rpa://chatgpt",
  "models": ["gpt-4"],
  "enabled": true
}
```

**Supported RPA providers:**
- `rpa://chatgpt` - ChatGPT web interface
- `rpa://claude` - Claude.ai web interface

**Limits & Warnings:**
- Max 1 ChatGPT + 1 Claude RPA provider (enforced by limits)
- Not suitable for high concurrency (synchronous browser automation)
- Slower than API providers (~5-10s response time)
- Sessions expire after ~24 hours (requires re-login)

**Common Failure Cases:**
- Login session expired → Re-run `npx playwright open`
- DOM changes on provider website → Update selector in `rpaConnector.ts`
- Rate limiting by provider → Automatic fallback to API providers

---

### ➕ Adding New Providers (DeepSeek, Gemini, etc.)

The provider system is **config-driven**. Adding a new model typically requires only editing `src/config/providers.json`.

**Step 1: Edit `src/config/providers.json`**

```json
{
  "name": "deepseek",
  "type": "api",
  "baseUrl": "https://api.deepseek.com/v1",
  "models": ["deepseek-chat", "deepseek-coder"],
  "defaultModel": "deepseek-chat",
  "priority": 100,
  "enabled": true
}
```

**Step 2: Add API Key to Environment**
```env
DEEPSEEK_API_KEY=sk-...
```

**Step 3: No code change needed!**

If the API is **OpenAI-compatible** (most are), the system will automatically route to the correct handler.

---

**When to Add Custom Handler:**

If the API is **NOT** OpenAI-compatible, add a handler in `src/lib/providers.ts`:

```typescript
// In askAPIProvider(), add a new case:
if (provider.name === "custom-provider") {
  return await askCustomProvider(provider, messages, maxTokens, signal);
}
```

Or create a new connector in `src/lib/connectors/`.

**Provider Types:**
- `"api"` - Cloud APIs (OpenAI, Anthropic, Google, DeepSeek, etc.)
- `"local"` - Local endpoints (Ollama, LMStudio)
- `"rpa"` - Browser automation (ChatGPT, Claude web apps)

---

### 🏠 Local AI Integration (Phase 22)
Native connectors for Ollama (`http://localhost:11434`) and OpenAI-compatible local endpoints with automatic fallback to remote providers.

### 🧪 Benchmark Framework (Phase 18)
Automated quality testing with keyword matching. Run via `npm run benchmark`.

### ��️ Tool System (SERP)
Agents can invoke web search and code execution with automatic decision logic.

### 🧠 Semantic Memory (pgvector)
Persistent conversation context with vector similarity search for relevant past discussions.

### 📊 Streaming Architecture
End-to-end SSE for real-time word-by-word streaming with stateful `done` events containing final verdict.

### � Cost Tracking (Phase 17)
Real-time cost ledger with color tiers: green (<$0.01), yellow ($0.01–$0.05), red (>$0.05).

### �� Security & Reliability
- AES-256 encryption for API keys
- CSP protection and Zod schema validation
- Graceful provider fallbacks and rate limit handling
- Comprehensive error mapping and logging

---

## 🎯 Future Improvements / Known Limitations

### Minor Limitations
- **Benchmark CLI-only**: Automated testing runs via command line only; not integrated into web UI
- **ChatArea State**: When using MainTabs standalone, state persists only within that component instance
- **Desktop App Connectors**: Phase 22 partially complete — local AI (Ollama) implemented, OS-level desktop app automation not implemented

### Planned Enhancements
- Enhanced scoring engine with weighted agreement metrics
- Dynamic archetype configuration based on user feedback
- Advanced consensus detection algorithms
- Performance benchmarking visualization in UI
- Plugin system for custom archetypes and tools

---

## 📸 Screenshots

*(Coming soon: Place UI screenshots here)*

---

## 🤝 Contributing

We welcome contributions! Please check our community health files in `.github/` folder:

- [Security Policy](.github/SECURITY.md)
- [Contributing Guidelines](.github/CONTRIBUTING.md)

---

## 📜 License

Built with ❤️ by **Yash Awasthi**. Licensed under the MIT License.
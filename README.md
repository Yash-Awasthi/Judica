[ 📖 README ](./README.md) | [ 🗺️ ROADMAP ](./ROADMAP.md)

# 🏛️ AI Council: Multi-Agent Deliberation Engine

## Description

**A production-grade orchestration platform for high-fidelity AI reasoning, consensus building, and decentralized deliberation.**

AI Council is a state-of-the-art orchestration engine that allows you to pit multiple AI agents against each other in real-time deliberation. Instead of relying on a single model's output, the Council leverages diverse perspectives from specialized archetypes (e.g., The Architect, The Contrarian, The Ethicist) to identify blind spots, reduce hallucinations, and produce a synthesized "Master Verdict" of superior quality.

### Key Value Propositions
- **Diverse Perspectives**: 12+ built-in archetypes with unique thinking styles and system prompts.
- **True Multi-Round Deliberation**: Unlike side-by-side comparison tools, AI Council enforces interactive peer feedback loops. Agents review each other's claims and refine their positions before final synthesis.
- **Streaming Architecture**: End-to-end SSE (Server-Sent Events) for word-by-word streaming from multiple models simultaneously, with stateful `<think>`-block parsing.
- **Universal Provider Adapter**: Seamlessly integrates with Google Gemini, Anthropic Claude, OpenAI-compatible APIs (NVIDIA NIM, Groq, Mistral, Cerebras), and local models.

---

## 📊 System Architecture

### Orchestration Flow
```mermaid
graph TD
    User([User]) --> WebUI[React Frontend]
    WebUI -- SSE / JSON --> API[Express Backend]
    API -- Prisma --> DB[(PostgreSQL)]
    API -- Node-Cache --> Redis[(Redis)]
    
    subgraph "Orchestration Engine"
        Router[Router <br/><i>(planned)</i>]
        Deliberator[Council Deliberator]
        Critic[Critic Model <br/><i>(planned split)</i>]
        Synthesizer[Master/Synthesis Model]
    end
    
    API --> Router
    Router --> Deliberator
    Deliberator -- Parallel Calls --> P1[Provider 1]
    Deliberator -- Parallel Calls --> P2[Provider 2]
    Deliberator -- Parallel Calls --> P3[Provider 3]
    
    P1 & P2 & P3 -- Stream --> Deliberator
    Deliberator -- Opinion Feedback --> Critic
    Critic -- Directive --> Deliberator
    Deliberator -- Final Context --> Synthesizer
    Synthesizer -- SSE Stream --> API
    API -- Real-time Updates --> WebUI
```

---

## 🧰 Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Backend** | Node.js / Express / TypeScript | Robust logic engine with high-concurrency SSE support. |
| **Frontend** | React / Vite / Tailwind | Premium UI with dynamic identity generation and tabbed result panes. |
| **Database** | PostgreSQL + Prisma | Persistent conversation history, user configs, and metadata. |
| **Cache** | Redis / Node-Cache | High-speed deliberation state management and session caching. |
| **Security** | AES-256 / Helmet / Zod | Encrypted API keys, CSP protection, and strict schema validation. |
| **Auth** | JWT / bcryptjs | Hardened authentication with silent-refresh. |
| **Synthesis** | Gemini 2.5 Flash | Fast, efficient master model for final verdict synthesis. |

---

## Installation

### 📦 Quick Start (Docker - Recommended)
The easiest way to get the Council running is via Docker Compose. This ensures all constraints and dependencies are perfectly isolated.
```bash
# Clone the repository
git clone https://github.com/Yash-Awasthi/ai-council.git
cd ai-council

# Run with Docker Compose
docker-compose up -d
```

### 🛠️ Manual Installation
1.  **Install dependencies**:
    ```bash
    npm install
    cd frontend && npm install && cd ..
    ```
2.  **Environment Setup**:
    Copy `.env.example` to `.env` and fill in your API keys.
3.  **Initialize Database**:
    ```bash
    npx prisma generate
    npx prisma migrate dev --name init
    ```
4.  **Run Dev Servers**:
    ```bash
    npm run dev:all
    ```

---

## ⚙️ Configuration

### Model Adapters
The Universal Provider Adapter supports multiple endpoint types out of the box, with built-in prefixes and fallback support:
-   **OpenAI-Compatible**: NVIDIA NIM, Groq, OpenRouter, Mistral, Cerebras.
-   **Native Google**: Gemini models (Gemini 2.5 Flash used as default Master).
-   **Native Anthropic**: Claude models.

### Council Templates
Pre-configured templates define the composition of the council:
- **Debate Council**: Contrarian, Architect, Pragmatist.
- **Research Council**: Empiricist, Historian, Outsider.
- **Technical Council**: Architect, Minimalist, Empiricist.

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

AI Council's primary differentiator is **interactive consensus building**.

### The Final Target Pipeline
1.  **PII Check (planned)**: Pre-flight scan of user prompt for sensitive data.
2.  **Router (planned)**: Auto-classifies query to select optimal archetype subset.
3.  **Parallel Agent Responses**: All council members formulate initial positions concurrently.
4.  **Peer Review + Anonymized Ranking (planned)**: Agents critique and rank anonymized responses.
5.  **Scoring Engine (planned)**: Deterministic evaluation based on agreement, confidence, and rankings.
6.  **Multi-Round Refinement**: Repeated debate loops (with a planned Consensus Metric to halt early).
7.  **Tool Use (planned)**: Agents invoke web search or code execution.
8.  **Final Synthesis**: The Master Model reviews the entire debate history and constructs a cohesive verdict.
9.  **Cold Validator / Fresh Eyes (planned)**: A distinct, zero-context model validates the final synthesis for hallucinations or logic gaps.
10. **Memory Update (planned)**: Session context summarized and stored in pgvector.
11. **Cost + Audit Log (planned)**: Detailed ledger of tokens used and exact prompts sent.

*(Note: Features marked "planned" are detailed in `ROADMAP.md`)*

### <think>-Block Streaming
Some models (e.g. DeepSeek, QwQ) emit verbose `<think>` reasoning blocks before their final answer. The backend SSE pipeline features a stateful parser that strips these blocks from the user-facing UI while preserving them for the Master Model's synthesis context.

---

## 🔌 API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/ask` | `POST` | Execute a council deliberation (synchronous). |
| `/api/ask/stream` | `POST` | Execute a council deliberation with SSE streaming. |
| `/api/council/archetypes` | `GET/POST/DELETE` | Manage council archetypes. |
| `/api/history` | `GET` | Retrieve past conversation history. |

---

## 📸 Screenshots
*(Coming soon: Place UI screenshots here)*

---

## 🤝 Contributing
We welcome contributions! Please check our community health files in the `.github/` folder:
- [Security Policy](.github/SECURITY.md)

---

## 📜 License
Built with ❤️ by **Yash Awasthi**. Licensed under the MIT License.
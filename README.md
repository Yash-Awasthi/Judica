# 🏛️ AI Council: Multi-Agent Deliberation Engine

**A production-grade orchestration platform for high-fidelity AI reasoning, consensus building, and decentralized deliberation.**

---

## 🏛️ Project Overview

AI Council is a state-of-the-art orchestration engine that allows you to pit multiple AI agents against each other in real-time deliberation. Instead of relying on a single model's output, the Council leverages diverse perspectives from specialized archetypes (e.g., The Architect, The Contrarian, The Ethicist) to identify blind spots, reduce hallucinations, and produce a synthesized "Master Verdict" of superior quality.

### Key Value Propositions
- **Diverse Perspectives**: 12+ built-in archetypes with unique thinking styles and system prompts.
- **Real-Time Deliberation**: Multi-round peer feedback loops with consensus-detection logic.
- **Streaming Architecture**: End-to-end SSE (Server-Sent Events) for word-by-word streaming from multiple models simultaneously.
- **Provider Agnostic**: Seamlessly integrates with Google Gemini, Anthropic Claude, OpenAI, and NVIDIA NIM (OpenAI-compatible).

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
        Deliberator[Council Deliberator]
        Critic[Critic Model]
        Synthesizer[Master/Synthesis Model]
    end
    
    API --> Deliberator
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

## 🏛️ How It Works (The Deliberation Pipeline)

The AI Council follows a rigorous deliberation protocol inspired by multi-agent research and collaborative decision-making frameworks:

1.  **The Summoning**: Based on the selected **Council Template** (Technical, Legal, Creative, etc.), the system prepares an array of council members. Each member is assigned a specific **Archetype** (e.g., The Architect focuses on system design, The Contrarian challenges the status quo).
2.  **Parallel Deliberation**: Council members process the query simultaneously. Our **Universal Provider Adapter** handles the specificities of different AI APIs.
3.  **State-Aware Streaming**: Opinions are streamed back via SSE. A custom **`<think>` block parser** identifies internal reasoning blocks, stripping them from the user view but preserving the full context for the Master model.
4.  **The Critic Phase**: In multi-round sessions, the Master model (Gemini 2.5 Flash) reviews all initial opinions as a "Critic," identifying contradictions and providing a "Directive" for the next round.
5.  **Consensus Detection**: If the Critic detects the council has reached a definitive agreement, it flags `CONSENSUS_REACHED` to terminate the loop early.
6.  **Master Synthesis**: The deliberation history is fed into the Master model, which synthesizes the diverse viewpoints into a comprehensive, high-fidelity final verdict.

---

## 🧰 Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Backend** | Node.js / Express | Robust logic engine with high-concurrency SSE support. |
| **Frontend** | React / Vite / Tailwind | Premium, glassmorphic UI with dynamic identity generation. |
| **Orchestration** | TypeScript | Full type-safety across multi-agent workflows. |
| **Database** | PostgreSQL + Prisma | Persistent conversation history, user configs, and metadata. |
| **Cache** | Redis / Node-Cache | High-speed deliberation state management and session caching. |
| **Security** | AES-256-GCM | User-provided API keys are encrypted at rest using industry standards. |
| **Auth** | JWT / Helmet | Hardened authentication with silent-refresh and CSP protection. |

---

## 🚀 Getting Started

### 📦 Quick Start (Docker)
The easiest way to get the Council running is via Docker Compose:
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
    Copy `.env.example` to `.env` and fill in your API keys (OpenAI, Anthropic, Google).
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
The Universal Provider Adapter supports multiple endpoint types:
-   **OpenAI-Compatible**: Supports NVIDIA NIM, Groq, OpenRouter, and Local LLMs (Ollama/LM Studio).
-   **Native Google**: Optimized for Gemini 2.0 Pro and 1.5 Flash.
-   **Native Anthropic**: Full support for Claude 3.5 Sonnet/Haiku.

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

## 🛡️ Security Layers
- **AES-256 Encryption**: Every API key provided by the user is encrypted with a unique IV before being stored in the database.
- **SSRF Protection**: All custom base URLs are validated to prevent internal network scanning.
- **Rate-Limiting**: Distributed rate-limiting on sensitive endpoints to prevent API abuse.

---

## 📸 Screenshots
*(Coming soon: Place UI screenshots here)*

---

## 🤝 Contributing
We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) to get started with local development and submit a PR.

---

## 📜 License
Built with ❤️ by **Yash Awasthi**. Licensed under the [MIT License](LICENSE).

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
        Router[Router]
        Deliberator[Council Deliberator]
        Critic[Critic Model]
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

*(Note: The Router is planned — see ROADMAP.md)*

---

## 🧰 Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Backend** | Node.js / Express / TypeScript | Robust logic engine with high-concurrency SSE support. |
| **Frontend** | React / Vite / Tailwind | Premium UI with dynamic identity generation. |
| **Database** | PostgreSQL + Prisma | Persistent conversation history, user configs, and metadata. |
| **Cache** | Redis / Node-Cache | High-speed deliberation state management and session caching. |
| **Security** | AES-256 / Helmet / Zod | Encrypted API keys, CSP protection, and strict schema validation. |
| **Auth** | JWT / bcryptjs | Hardened authentication with silent-refresh. |
| **Synthesis** | Gemini 2.5 Flash | Fast, efficient master model for final verdict synthesis. |

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
-   **OpenAI-Compatible**: NVIDIA NIM, Groq, OpenRouter, Mistral, Local LLMs.
-   **Native Google**: Gemini models (Gemini 2.5 Flash used as default Master).
-   **Native Anthropic**: Claude models.

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

The AI Council follows a rigorous deliberation protocol inspired by multi-agent research and collaborative decision-making frameworks. Here is the current and planned state of the pipeline:

1.  **The Summoning & Router (Planned)**: The system will classify the query and map it to optimal model archetypes using a dynamic router. Currently, it prepares the council members based on the selected **Council Template** and assigning Archetypes.
2.  **Parallel Deliberation**: All models in the council are queried simultaneously using our **Universal Provider Adapter**. This step is currently partially parallelized but will be made fully concurrent (see ROADMAP.md).
3.  **State-Aware Streaming**: Opinions are streamed back via SSE. A custom **`<think>` block parser** identifies internal reasoning blocks, stripping them from the user view but preserving the full context for the Master model.
4.  **Peer Review + Ranking (Planned)**: Agents will evaluate each other anonymously and rank responses.
5.  **Scoring (Planned)**: A deterministic scoring engine will evaluate agreement, confidence, and peer rankings to filter responses.
6.  **The Critic Phase**: In multi-round sessions, the Master model (e.g. Gemini 2.5 Flash) reviews all initial opinions as a "Critic," identifying contradictions and providing a "Directive" for the next round. This will eventually be split into Critic, Scorer, and Controller roles with deterministic consensus tracking (see ROADMAP.md).
7.  **Tool Use (Planned)**: Agents will be able to execute tools (code, web search) as needed.
8.  **Final Synthesis**: The deliberation history is fed into the Master model, which synthesizes the diverse viewpoints into a comprehensive, high-fidelity final verdict.
9.  **Memory Update (Planned)**: The system will update short-term and long-term context memory.

**FINAL TARGET PIPELINE:**
User Query → Router → Parallel Responses → Peer Review + Ranking → Scoring → Multi-Round Refinement → Tool Use if needed → Final Synthesis → Memory Update

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
We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) to get started with local development and submit a PR.

---

## 📜 License
Built with ❤️ by **Yash Awasthi**. Licensed under the MIT License.

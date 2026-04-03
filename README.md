# 🏛️ AI Council: Multi-Agent Deliberation Engine

[![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)](https://github.com/Yash-Awasthi/ai-council)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Refactor](https://img.shields.io/badge/refactor-v3.0-orange.svg)](https://github.com/Yash-Awasthi/ai-council/releases/tag/v3.0)

**AI Council** is a production-grade orchestration platform that allows you to pit multiple AI agents against each other in real-time deliberation. A "Master" model then synthesizes their collective reasoning into a single, high-fidelity verdict.

---

## ⚡ What's New in v3.0?
The v3.0 refactor introduced a state-of-the-art architecture for real-time AI collaboration:
- **SSE Streaming**: Responses now flow instantly (word-by-word) from every agent simultaneously.
- **Unified Auth**: Hardened JWT-based security with automatic silent-refresh and 401 interceptors.
- **Modern UI**: A premium, glassmorphic React interface with dynamic, naming-hashed member identities.

---

## 🏛️ How the Council Works

1.  **The Question**: You ask a question (e.g., "Should we adopt a monorepo strategy?").
2.  **The Summoning**: You choose a council template (Debate, Technical, Legal, Creative).
3.  **The Deliberation**: Multiple AI Agents (Architect, Contrarian, Ethicist, etc.) begin arguing their perspectives in parallel.
4.  **The Master Synthesis**: A "Master" model reads all opinions, identifies contradictions, and outputs the final definitive verdict.

---

## 🧰 Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Backend** | Node.js / Express | Robust logic engine with SSE capability. |
| **Frontend** | React / Vite / Tailwind | Premium, ultra-responsive modern UI. |
| **Core** | TypeScript | Type-safety across the entire network boundary. |
| **Database** | PostgreSQL + Prisma | Persistent conversation history and user configs. |
| **Cache** | Redis | High-speed response and session caching. |
| **Realtime** | Server-Sent Events | Low-latency word-by-word streaming. |

---

## 🚀 Getting Started

### 1. Pre-flight Checklist
Make sure you have **Node.js v18+** and a running **PostgreSQL** instance.

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/Yash-Awasthi/ai-council.git
cd ai-council

# Install all dependencies
npm install
cd frontend && npm install && cd ..
```

### 3. Configure Environment
Create a `.env` file in the root directory:
```env
# Security
JWT_SECRET=add_a_strong_random_string
ENCRYPTION_KEY=add_a_32_character_aes_key

# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/ai_council"

# AI Provider Keys
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
ANTHROPIC_API_KEY=...
```

### 4. Initialize Database
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 5. Run the Engine
You can run both the backend and frontend simultaneously with one command:
```bash
npm run dev:all
```
The interface will be available at `http://localhost:5173`.

---

## 🧱 Project Structure

```text
ai-council/
├── frontend/             # React Application (Vite/Tailwind)
│   ├── src/hooks/        # Custom SSE & API hooks
│   ├── src/context/      # Global Authentication State
│   └── src/components/   # Component Library
├── src/                  # Express SDK
│   ├── lib/              # Multi-Agent Orchestration & SSE Drivers
│   ├── routes/           # API Endpoints (Auth, History, Ask)
│   └── middleware/       # Rate Limiting, Redacting & Logging
├── prisma/               # Database Schema Definitions
└── scripts/              # Infrastructure & DevOps Utilities
```

---

## 🛡️ Security & Scalability
- **AES-256 Encryption**: User-provided API keys are encrypted before storage.
- **Rate-Limiting**: Integrated IPv6-aware protection on `/api/ask` and `/api/auth`.
- **Zod Validation**: Strict schema enforcement on all incoming network payloads.
- **Helmet CSRF/CSP**: Hardened headers to prevent cross-site scripting.

---

## 🏗️ Deployment
To deploy a production-ready single process:
```bash
npm run build
npm start
```

---

## 🤝 Contributing
Contributions are welcome! If you have ideas for new **Archetypes** or **Council Templates**, please open a Pull Request.

---

## 📝 License
Built with passion by **Yash Awasthi**. Licensed under the [MIT License](LICENSE).

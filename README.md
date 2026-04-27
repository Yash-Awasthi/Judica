<div align="center">

# Judica

### Multi-AI Deliberation Desktop App

[![Electron](https://img.shields.io/badge/Electron-30-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-Local-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=for-the-badge)](https://github.com/Yash-Awasthi/Judica/releases)

<br />

**Send one message. Get three independent answers from ChatGPT, Gemini, and Claude — using your own accounts, no API keys needed. Judica runs a council, compares positions, and synthesizes a verdict.**

[Download](#download) · [How It Works](#how-it-works) · [Build from Source](#build-from-source) · [Architecture](#architecture)

</div>

---

## What Is Judica?

Most people already pay for ChatGPT Plus, Gemini Advanced, or Claude Pro. They still paste the same prompt into three browser tabs, manually compare answers, and guess which one is right.

Judica is a desktop app that does this for you — automatically. It embeds real AI provider websites inside a native window, injects your message into all of them simultaneously, waits for each to finish, then produces a synthesized verdict.

**No API keys. No extra subscriptions. Uses the accounts you already have.**

| | Pasting Into Tabs | Judica |
|---|---|---|
| **Effort** | Copy-paste 3 times | Type once |
| **Accounts used** | Your own | Your own |
| **Cost** | Your existing subs | Your existing subs |
| **Comparison** | Manual, in your head | Automatic, synthesized verdict |
| **Follow-ups** | Re-paste context each time | Carries context across rounds |
| **History** | None | Local SQLite, private |

---

## How It Works

```
Your message
    │
    ├──► ChatGPT  (your account, your session)
    ├──► Gemini   (your account, your session)
    └──► Claude   (your account, your session)
              │
              ▼
    Judica reads all three responses
              │
              ▼
    Synthesizes verdict with confidence notes
              │
              ▼
    Follow-up? Carries summarized context into next round
```

### Multi-Round Deliberation

When you continue a conversation, Judica doesn't dump full transcripts into each AI. It builds a compact context block from the previous round's summaries and injects it cleanly:

```
[Round 1 context]
ChatGPT said: <3-sentence summary>
Gemini said: <3-sentence summary>
Claude said: <3-sentence summary>
Verdict: <synthesis summary>

Follow up: your new question
```

This keeps context tight, avoids hitting context limits, and makes each AI aware of what the others concluded.

### Compaction

After 5+ rounds, older rounds get compacted into a single summary block. Your thread stays fast and coherent indefinitely without manual management.

### Verdict Rotation

Each round, a different AI is nominated as verdict synthesizer (ChatGPT → Gemini → Claude → repeat). This prevents any single model from dominating the synthesis.

### Glass Mode

Toggle the embedded AI panels to appear/disappear in the window. Off by default — you don't need to watch the panels, Judica handles the automation. Turn it on if you want to see exactly what's happening.

---

## Download

Pre-built binaries are attached to each [GitHub Release](https://github.com/Yash-Awasthi/Judica/releases).

| Platform | File |
|---|---|
| macOS | `Judica-x.x.x.dmg` |
| Windows | `Judica-Setup-x.x.x.exe` |
| Linux | `Judica-x.x.x.AppImage` or `.deb` |

On first launch, sign in to ChatGPT, Gemini, and Claude inside Judica's embedded panels. Sessions persist across restarts via dedicated browser partitions (`persist:chatgpt`, `persist:gemini`, `persist:claude`).

---

## Architecture

```
judica/
├── electron/                   # Main process (Node.js + Electron)
│   └── src/
│       ├── main/
│       │   ├── index.ts        # Window, BrowserViews, IPC handlers, deliberation orchestrator
│       │   └── preload.ts      # contextBridge — exposes window.molecule to renderer
│       ├── providers/
│       │   └── index.ts        # Injection scripts, selectors, context builders per provider
│       └── db.ts               # SQLite schema + CRUD (better-sqlite3)
│
└── frontend/                   # Renderer process (React + React Router 7)
    └── app/
        ├── routes/
        │   ├── chat.tsx        # Main deliberation UI
        │   ├── home.tsx        # Dashboard with chat history
        │   └── settings.tsx    # Provider keys, deliberation preferences
        ├── lib/
        │   └── deliberate.ts   # IPC bridge — calls window.molecule
        └── context/
            └── AuthContext.tsx # Local identity (localStorage, no server)
```

### Data Flow

```
React UI → window.molecule.deliberate()
         → IPC → main process
         → inject script into each BrowserView
         → window.__molecule.send(message)
         → wait for DOM response
         → emit IPC events: deliberation:opinion, deliberation:verdict
         → React UI receives streaming updates
         → verdict saved to SQLite
```

### Local Storage

Everything stays on your machine. No server, no cloud sync, no account.

```
~/.judica/judica.db

Tables:
  threads     — conversation list (id, title, created_at, updated_at)
  messages    — all messages + summaries per round
  compactions — compacted round summaries per thread
  memory      — arbitrary key/value for long-term memory
```

---

## Build from Source

### Prerequisites

- Node.js 20+
- Bun (for frontend)
- npm (for electron)

### Dev

```bash
git clone https://github.com/Yash-Awasthi/Judica.git
cd judica/electron

npm install
npm run dev
```

This starts the frontend dev server and launches Electron against it.

### Production Build

```bash
cd electron
npm run dist         # current platform
npm run dist:all     # mac + win + linux
```

Outputs to `electron/release/`.

### CI / Release

Push a tag to trigger the GitHub Actions release workflow:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Builds `.dmg`, `.exe`, `.msi`, `.AppImage`, `.deb` and attaches them to the GitHub release.

---

## Supported Providers

| Provider | URL injected | Selector used |
|---|---|---|
| ChatGPT | `chat.openai.com` | `#prompt-textarea` |
| Gemini | `gemini.google.com` | `.ql-editor` |
| Claude | `claude.ai` | `.ProseMirror` |

Sessions are isolated per provider using Electron's persistent session partitions. Signing in once is enough — credentials survive restarts.

---

## Privacy

- **No telemetry.** No data leaves your machine except to the AI providers you're already using.
- **No account required.** First launch asks for a display name, stored in localStorage.
- **No API keys.** The AI providers are accessed through their normal web interfaces.
- **Local database.** All history is in `~/.judica/judica.db` — you can delete it anytime.

---

## Contributing

1. Fork and clone the repo
2. `cd electron && npm install`
3. `npm run dev` to launch in development mode
4. Open a PR with a clear description of what changed and why

---

<div align="center">

*Judica — Latin: "Judge. Vindicate. Decide."*

[Releases](https://github.com/Yash-Awasthi/Judica/releases) · [Issues](https://github.com/Yash-Awasthi/Judica/issues)

</div>

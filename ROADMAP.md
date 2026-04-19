<div align="center">

# AIBYAI — Development Roadmap

**Multi-Agent Deliberative Intelligence Platform**

[![Phase 10](https://img.shields.io/badge/Phase_10-Planned-3B82F6?style=flat-square)](#phase-10-multi-modal-input)
[![Phase 11](https://img.shields.io/badge/Phase_11-Planned-3B82F6?style=flat-square)](#phase-11-agent-marketplace--sharing)
[![Phase 12](https://img.shields.io/badge/Phase_12-Planned-3B82F6?style=flat-square)](#phase-12-workspace-roles--audit-logs)
[![Phase 13](https://img.shields.io/badge/Phase_13-Planned-3B82F6?style=flat-square)](#phase-13-advanced-reasoning-modes)

</div>

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔄 | In Progress |
| 🔵 | Planned |

---

## Phase 10: Multi-Modal Input

> Extend the deliberation council to reason over images, audio, and documents — not just text.

| Feature | Status |
|---------|--------|
| **File Attachment UI** — paperclip button in InputArea; preview chips with remove; drag-and-drop | 🔵 |
| **Inline Image Rendering** — user messages display image thumbnails; council receives base64 vision blocks | 🔵 |
| **Audio Transcription** — upload audio file → Whisper transcription → injected as text context | 🔵 |
| **Multi-modal Conflict Detection** — vision model extracts claims from images; conflict detector runs on mixed content | 🔵 |

---

## Phase 11: Agent Marketplace & Sharing

> Let users publish custom archetypes and council templates, and discover ones built by the community.

| Feature | Status |
|---------|--------|
| **Archetype Builder UI** — no-code form: system prompt, tools, icon, color, blind spot | 🔵 |
| **Publish to Marketplace** — one-click publish with version + changelog per archetype | 🔵 |
| **Council Template Export / Import** — share SUMMONS configs as portable JSON | 🔵 |
| **Ratings & Usage Stats** — star rating, fork count, weekly usage per published archetype | 🔵 |

---

## Phase 12: Workspace Roles & Audit Logs

> Structured access control and immutable audit trails for team deployments.

| Feature | Status |
|---------|--------|
| **Workspace Roles** — Owner / Admin / Member / Viewer with per-resource permission matrix | 🔵 |
| **Role-Based Route Guards** — middleware enforces minimum role per API endpoint | 🔵 |
| **Audit Log JSONL Export** — immutable export of every deliberation, approval, and config change event | 🔵 |
| **Role Management UI** — admin panel to invite, promote, and remove workspace members | 🔵 |

---

## Phase 13: Advanced Reasoning Modes

> New deliberation strategies beyond the round-robin debate loop.

| Feature | Status |
|---------|--------|
| **Socratic Dialogue Mode** — agents ask clarifying questions before forming opinions; second pass uses answers | 🔵 |
| **Red Team / Blue Team** — fixed two-faction structure with a neutral judge archetype | 🔵 |
| **Iterative Hypothesis Refinement** — agents propose, falsify, and revise hypotheses across rounds | 🔵 |
| **Confidence Calibration** — agents declare uncertainty levels; synthesis weights by calibrated confidence | 🔵 |

---

<div align="center">

**[Back to README](./README.md)** · [Report a Bug](https://github.com/Yash-Awasthi/aibyai/issues) · [Request a Feature](https://github.com/Yash-Awasthi/aibyai/issues)

</div>

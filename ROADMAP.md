<div align="center">

# AIBYAI — Development Roadmap

**Multi-Agent Deliberative Intelligence Platform**

[![Phase 10](https://img.shields.io/badge/Phase_10-Planned-3B82F6?style=flat-square)](#phase-10-multi-modal-input)
[![Phase 11](https://img.shields.io/badge/Phase_11-Planned-3B82F6?style=flat-square)](#phase-11-agent-marketplace--sharing)
[![Phase 12](https://img.shields.io/badge/Phase_12-Planned-3B82F6?style=flat-square)](#phase-12-enterprise--teams)
[![Phase 13](https://img.shields.io/badge/Phase_13-Planned-3B82F6?style=flat-square)](#phase-13-advanced-reasoning-modes)
[![Phase 14](https://img.shields.io/badge/Phase_14-Planned-3B82F6?style=flat-square)](#phase-14-native-mobile)

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
| **Image Upload & Vision Routing** — attach images to council prompts; route to vision-capable models | 🔵 |
| **PDF / Document Ingestion** — drag-drop PDF → auto-chunk → inject as RAG context for the council | 🔵 |
| **Audio Transcription** — record or upload audio; Whisper transcription feeds council as text | 🔵 |
| **Multi-modal Conflict Detection** — claim extractor handles image captions + text claims together | 🔵 |

---

## Phase 11: Agent Marketplace & Sharing

> Let users publish custom archetypes and council templates, and discover ones built by the community.

| Feature | Status |
|---------|--------|
| **Archetype Builder UI** — no-code form to define a new archetype (system prompt, tools, icon, color) | 🔵 |
| **Publish to Marketplace** — one-click publish; versioning + changelog per archetype | 🔵 |
| **Council Template Sharing** — export/import SUMMONS configs as shareable JSON links | 🔵 |
| **Ratings & Usage Stats** — star rating, fork count, and weekly usage per published archetype | 🔵 |

---

## Phase 12: Enterprise & Teams

> Workspace-level access control, audit trails, and SSO for organisation deployments.

| Feature | Status |
|---------|--------|
| **Workspace Roles** — Owner / Admin / Member / Viewer with per-resource permission matrix | 🔵 |
| **SSO / SAML 2.0** — Okta, Azure AD, Google Workspace integration | 🔵 |
| **Compliance Audit Log Export** — immutable JSONL export of every deliberation + approval event | 🔵 |
| **Private Model Endpoints** — bring-your-own model: point to internal Ollama / Azure OpenAI endpoint | 🔵 |

---

## Phase 13: Advanced Reasoning Modes

> New deliberation strategies beyond the round-robin debate loop.

| Feature | Status |
|---------|--------|
| **Socratic Dialogue Mode** — agents ask clarifying questions before forming opinions | 🔵 |
| **Red Team / Blue Team** — fixed two-faction structure with a neutral judge archetype | 🔵 |
| **Iterative Hypothesis Refinement** — agents propose, falsify, and revise hypotheses across rounds | 🔵 |
| **Confidence Calibration** — agents declare uncertainty levels; synthesis weights by calibrated confidence | 🔵 |

---

## Phase 14: Native Mobile

> First-class iOS and Android experience for on-the-go deliberations.

| Feature | Status |
|---------|--------|
| **React Native App** — shared business logic with the web frontend; push notifications for HITL gates | 🔵 |
| **Offline-First Council** — local SQLite cache; sync deliberation state when back online | 🔵 |
| **Voice-First Interface** — speak a prompt → transcribe → council deliberates → TTS response | 🔵 |
| **Biometric Auth** — Face ID / fingerprint unlock replacing password on mobile | 🔵 |

---

<div align="center">

**[Back to README](./README.md)** · [Report a Bug](https://github.com/Yash-Awasthi/aibyai/issues) · [Request a Feature](https://github.com/Yash-Awasthi/aibyai/issues)

</div>

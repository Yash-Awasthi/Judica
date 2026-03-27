# 🚀 AI Council Roadmap

This document outlines the planned enhancements and research directions for the AI Council platform. The goals are prioritized into four tiers based on implementation complexity and value to the deliberation quality.

---

## 🟢 Tier 1 — Quick Wins (< 1 day each)
*Low-hanging fruit that meaningfully improves the core user experience.*

### ✨ High-Fidelity UI Polishes
- **Copy to Clipboard**: One-click copy for the final verdict and individual member opinions.
- **Micro-Animations**: Smooth, liquid transitions between deliberation rounds and status updates (Inspired by **prijak/Ai-council**).
- **Dark/Light Mode**: Full theme customization using Tailwind's `prefers-color-scheme`.

### 📂 Export & Utility
- **Export to PDF/Markdown**: Professional report generation for council sessions.
- **Archetype Expansion**: Add 'Legal Counsel', 'Medical Board', and 'Debug Specialist' archetypes (Inspired by **prijak/Ai-council** persona library).

---

## 🟡 Tier 2 — Core Feature Gaps (1–3 days each)
*Features that solve common multi-agent deliberation pitfalls like "groupthink" and sycophancy.*

### 🔄 Multi-Stage Deliberation
- **Peer Review Cycle**: Before the final synthesis, agents are given each other's first drafts anonymously to critique (Inspired by **karpathy/llm-council**).
- **Anti-Sycophancy Protocols**: Inject system directives specifically designed to keep agents from agreeing too easily (Inspired by **focuslead/ai-council-framework**).

### 📊 Deliberation Analytics
- **Consensus Depth Indicator**: A visual meter showing the "distance" between the opinions of the council members.
- **Token Tracking**: Real-time cost estimation per session based on selected models.

---

## 🟠 Tier 3 — Architecture Upgrades (1 week+)
*Significant structural improvements to the multi-agent backbone.*

### 🧠 Persistent Conversation Memory
- **Multi-Turn Sessions**: Support for back-and-forth dialogue with the council where the history is preserved across turns.
- **Vector Search Context**: Integrate RAG (Retrieval Augmented Generation) to allow the council to deliberate over private documents.

### 🔗 Agent-to-Agent Referencing
- **Cross-Agent Dialogue**: Enable logic that allows agents to explicitly mention and build upon (or refute) other agents' arguments by name during the multi-round process.

### 🛠️ Advanced Tool Integration
- **Sandbox Code Execution**: Fully expose the `execute_code` tool to the 'Architect' and 'Pragmatist' archetypes with a secure Docker sandbox.

---

## 🔴 Tier 4 — Research-Grade Extensions
*Stretch goals focused on benchmarking and LLM-as-judge scoring.*

### ⚖️ LLM-as-Judge Scoring
- **Rubric-Based Evaluation**: The Master model scores each agent's contribution based on a custom rubric (factuality, creativity, logic) (Inspired by **PolyCouncil**).

### 🤖 Auto-Council Composition
- **Dynamic Summoning**: Implement a "Router" model that analyzes the user's query and automatically selects the optimal archetypes to summon for that specific topic (Inspired by **llm-council** concept).

### 📈 Benchmark Suite
- **Hallucination Testing**: A set of stress-test queries to benchmark different council templates against each other for factual accuracy.

---

## 🤝 Contribution
If you're interested in working on any of these items, please check the [Issue Tracker](https://github.com/Yash-Awasthi/ai-council/issues) or start a discussion!

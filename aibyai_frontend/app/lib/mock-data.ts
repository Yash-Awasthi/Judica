const now = new Date().toISOString();
const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();

export const MOCK_DATA: Record<string, unknown> = {
  "/conversations": [
    { id: "c1", title: "Debate: Is AI regulation necessary?", createdAt: d(0), messageCount: 8, projectId: null },
    { id: "c2", title: "Research: Quantum computing landscape 2025", createdAt: d(1), messageCount: 12, projectId: "p1" },
    { id: "c3", title: "Analysis: Climate policy trade-offs", createdAt: d(2), messageCount: 6, projectId: "p1" },
    { id: "c4", title: "Technical: Microservices vs monolith decision", createdAt: d(3), messageCount: 10, projectId: "p2" },
    { id: "c5", title: "Philosophy: Consciousness and AI sentience", createdAt: d(5), messageCount: 14, projectId: null },
  ],
  "/conversations/c1": { id: "c1", title: "Debate: Is AI regulation necessary?", createdAt: d(0), messageCount: 8 },
  "/history/c1": [
    { id: "m1", role: "user", content: "Should AI be regulated by governments?", createdAt: d(0) },
    { id: "m2", role: "assistant", content: "The council has deliberated on this topic.", opinions: [
      { agent: "The Analyst", model: "gpt-4o", content: "Regulation is necessary to prevent monopolistic control and ensure safety standards. Historical precedent with financial systems shows unchecked power leads to systemic risk.", done: true },
      { agent: "The Devil's Advocate", model: "claude-3-5-sonnet", content: "Premature regulation could stifle innovation. The internet thrived precisely because it was initially unregulated. Self-regulation by industry may be more effective and adaptive.", done: true },
      { agent: "The Ethicist", model: "gemini-1.5-pro", content: "The ethical imperative is clear: systems with societal impact require accountability frameworks. Without regulation, there is no mechanism for redress when AI causes harm.", done: true },
    ], verdict: "The council reached a nuanced consensus: **targeted regulation** focused on high-risk AI applications (healthcare, criminal justice, infrastructure) is justified and necessary, while broad restrictions on AI research and development would be counterproductive. A risk-tiered framework similar to pharmaceutical regulation was the preferred model.", cost: { tokens: 3240, usd: 0.048 }, createdAt: d(0) },
  ],
  "/projects": [
    { id: "p1", name: "Climate Policy Research", description: "Multi-angle analysis of global climate interventions", conversationCount: 7, lastActive: d(1) },
    { id: "p2", name: "Tech Architecture Decisions", description: "Engineering trade-off deliberations for the platform", conversationCount: 4, lastActive: d(3) },
    { id: "p3", name: "Philosophy & Ethics", description: "Deep dives into AI ethics and consciousness", conversationCount: 3, lastActive: d(6) },
  ],
  "/workflows": [
    { id: "w1", name: "Research Pipeline", description: "Multi-step research with web search + synthesis", nodeCount: 8, lastRun: d(1), status: "active" },
    { id: "w2", name: "Debate Moderator", description: "Structured debate with red/blue team agents", nodeCount: 6, lastRun: d(4), status: "active" },
    { id: "w3", name: "Document Analyzer", description: "Upload → chunk → embed → Q&A workflow", nodeCount: 5, lastRun: null, status: "draft" },
  ],
  "/prompts": [
    { id: "pr1", name: "Socratic Questioner", content: "You are a Socratic questioner. For every claim the user makes, ask a probing follow-up question that challenges assumptions. Never accept premises at face value.\n\nUser input: {{input}}", version: 3, model: "gpt-4o", tags: ["reasoning", "philosophy"] },
    { id: "pr2", name: "Devil's Advocate", content: "Take the strongest possible opposing position to whatever argument is presented. Your goal is not to be contrarian for its own sake, but to stress-test the argument.\n\nArgument to challenge: {{argument}}", version: 1, model: "claude-3-5-sonnet-20241022", tags: ["debate", "critical-thinking"] },
    { id: "pr3", name: "Executive Summary", content: "Distill the following content into a crisp executive summary with: 1 sentence TL;DR, 3 key points, and recommended next actions.\n\nContent: {{content}}", version: 2, model: "gpt-4o-mini", tags: ["summarization", "business"] },
  ],
  "/kb": [
    { id: "kb1", name: "Climate Research Papers", documentCount: 23, lastUpdated: d(2), vectorized: true },
    { id: "kb2", name: "Tech Blog Posts", documentCount: 47, lastUpdated: d(5), vectorized: true },
    { id: "kb3", name: "Legal Documents", documentCount: 8, lastUpdated: d(10), vectorized: false },
  ],
  "/skills": [
    { id: "sk1", name: "web_search", description: "Search the web using Tavily API and return structured results", language: "Python", tags: ["search", "research"] },
    { id: "sk2", name: "code_executor", description: "Execute Python code in a sandboxed environment and return output", language: "Python", tags: ["code", "execution"] },
    { id: "sk3", name: "chart_generator", description: "Generate charts from structured data using matplotlib", language: "Python", tags: ["visualization", "data"] },
    { id: "sk4", name: "pdf_extractor", description: "Extract and structure text from PDF documents", language: "Python", tags: ["documents", "parsing"] },
  ],
  "/repos": [
    { id: "r1", name: "aibyai/backend", branch: "main", fileCount: 342, lastIndexed: d(1), status: "indexed" },
    { id: "r2", name: "aibyai/frontend", branch: "main", fileCount: 89, lastIndexed: d(2), status: "indexed" },
  ],
  "/marketplace": [
    { id: "mk1", title: "Consensus Builder", type: "workflow", author: "team@aibyai.dev", downloads: 1240, rating: 4.8, description: "A 5-agent workflow that builds genuine consensus by iteratively challenging and refining positions until convergence.", tags: ["consensus", "debate", "multi-agent"] },
    { id: "mk2", title: "Research Synthesizer", type: "prompt", author: "research@aibyai.dev", downloads: 876, rating: 4.6, description: "Synthesizes multiple research sources into a coherent narrative with citations and confidence levels.", tags: ["research", "synthesis"] },
    { id: "mk3", title: "The Critic", type: "persona", author: "community", downloads: 654, rating: 4.5, description: "A rigorous peer-review persona that identifies logical fallacies, unsupported claims, and methodological flaws.", tags: ["critique", "analysis"] },
    { id: "mk4", title: "Code Reviewer", type: "tool", author: "dev@aibyai.dev", downloads: 2103, rating: 4.9, description: "Reviews code for bugs, security issues, and style improvements across 12 programming languages.", tags: ["code", "review", "security"] },
    { id: "mk5", title: "Debate Champion", type: "workflow", author: "community", downloads: 445, rating: 4.3, description: "Oxford-style debate workflow with proposition and opposition teams plus an impartial judge.", tags: ["debate", "structured"] },
    { id: "mk6", title: "Red Team Analyst", type: "persona", author: "security@aibyai.dev", downloads: 789, rating: 4.7, description: "Adversarial persona that systematically probes plans for weaknesses, risks, and failure modes.", tags: ["risk", "adversarial", "planning"] },
  ],
  "/archetypes": [
    { id: "a1", name: "The Analyst", description: "Data-driven reasoning, quantitative focus, probability-based conclusions", systemPrompt: "You are a rigorous analyst. Ground every claim in data, cite uncertainty ranges, and distinguish correlation from causation.", model: "gpt-4o", temperature: 0.3 },
    { id: "a2", name: "The Devil's Advocate", description: "Challenges assumptions, stress-tests arguments, finds edge cases", systemPrompt: "You are a devil's advocate. Your job is to find the strongest objections to any position presented. Be relentless but fair.", model: "claude-3-5-sonnet-20241022", temperature: 0.8 },
    { id: "a3", name: "The Ethicist", description: "Moral philosophy, fairness, societal impact, second-order effects", systemPrompt: "You are an ethicist trained in multiple moral frameworks. Analyze actions through utilitarian, deontological, and virtue ethics lenses.", model: "gemini-1.5-pro", temperature: 0.5 },
    { id: "a4", name: "The Pragmatist", description: "Implementation focus, practical constraints, real-world feasibility", systemPrompt: "You are a pragmatist focused on what actually works in the real world. Challenge idealistic proposals with implementation realities.", model: "gpt-4o-mini", temperature: 0.6 },
  ],
  "/usage": {
    totalRequests: 1847,
    totalTokens: 4820000,
    totalCostUsd: 72.34,
    dailyBreakdown: Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.now() - (13 - i) * 86400000).toISOString().split("T")[0],
      requests: Math.floor(80 + Math.random() * 120),
      tokens: Math.floor(200000 + Math.random() * 400000),
      cost: parseFloat((3 + Math.random() * 8).toFixed(2)),
    })),
  },
  "/analytics": {
    agentPerformance: [
      { name: "The Analyst", avgScore: 0.91, requests: 623 },
      { name: "The Ethicist", avgScore: 0.87, requests: 541 },
      { name: "The Devil's Advocate", avgScore: 0.84, requests: 498 },
      { name: "The Pragmatist", avgScore: 0.82, requests: 385 },
    ],
    modelUsage: [
      { model: "gpt-4o", tokens: 2100000, cost: 31.5 },
      { model: "claude-3-5-sonnet", tokens: 1400000, cost: 21.0 },
      { model: "gemini-1.5-pro", tokens: 980000, cost: 12.74 },
      { model: "gpt-4o-mini", tokens: 340000, cost: 0.68 },
    ],
    deliberationQuality: { coherence: 0.88, consensus: 0.76, diversity: 0.91 },
  },
  "/admin/users": [
    { id: "u1", username: "vivek", email: "vivek@aibyai.dev", role: "admin", createdAt: d(60), lastActive: d(0), isActive: true },
    { id: "u2", username: "yash", email: "yash@aibyai.dev", role: "admin", createdAt: d(55), lastActive: d(1), isActive: true },
    { id: "u3", username: "alice_r", email: "alice@example.com", role: "member", createdAt: d(30), lastActive: d(2), isActive: true },
    { id: "u4", username: "bob_k", email: "bob@example.com", role: "member", createdAt: d(20), lastActive: d(7), isActive: true },
    { id: "u5", username: "charlie", email: "charlie@example.com", role: "viewer", createdAt: d(10), lastActive: d(14), isActive: false },
  ],
  "/admin/stats": { totalUsers: 5, activeUsers: 4, totalConversations: 47, avgResponseTime: 2840 },
  "/providers": [
    { id: "pv1", name: "OpenAI", type: "openai", model: "gpt-4o", isActive: true, endpoint: "https://api.openai.com/v1" },
    { id: "pv2", name: "Anthropic", type: "anthropic", model: "claude-3-5-sonnet-20241022", isActive: true, endpoint: "https://api.anthropic.com" },
    { id: "pv3", name: "Google", type: "google", model: "gemini-1.5-pro", isActive: true, endpoint: "https://generativelanguage.googleapis.com" },
    { id: "pv4", name: "Groq", type: "groq", model: "llama-3.1-70b", isActive: false, endpoint: "https://api.groq.com/openai/v1" },
  ],
  "/evaluation": [
    { id: "ev1", conversationId: "c1", coherence: 0.91, consensus: 0.78, diversity: 0.94, quality: 0.88, createdAt: d(0) },
    { id: "ev2", conversationId: "c2", coherence: 0.87, consensus: 0.82, diversity: 0.89, quality: 0.86, createdAt: d(1) },
    { id: "ev3", conversationId: "c3", coherence: 0.94, consensus: 0.71, diversity: 0.96, quality: 0.87, createdAt: d(2) },
    { id: "ev4", conversationId: "c4", coherence: 0.79, consensus: 0.88, diversity: 0.81, quality: 0.83, createdAt: d(3) },
    { id: "ev5", conversationId: "c5", coherence: 0.92, consensus: 0.65, diversity: 0.98, quality: 0.85, createdAt: d(5) },
  ],
  "/costs": {
    current: { tokens: 48200, usd: 0.72 },
    history: Array.from({ length: 7 }, (_, i) => ({
      date: new Date(Date.now() - (6 - i) * 86400000).toISOString().split("T")[0],
      tokens: Math.floor(100000 + Math.random() * 200000),
      usd: parseFloat((1.5 + Math.random() * 4).toFixed(2)),
    })),
  },
};

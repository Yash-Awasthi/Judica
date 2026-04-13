export interface Opinion {
  name: string;
  archetype: string;
  opinion: string;
}

export interface PeerReview {
  reviewer: string;
  ranking: string[];
  critique: string;
}

export interface ScoredOpinion {
  name: string;
  opinion: string;
  scores: {
    confidence: number;
    agreement: number;
    peerRanking: number;
    final: number;
  };
}

export interface ModelCost {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

export interface ChatMessage {
  id: string;
  question: string;
  verdict?: string;
  createdAt?: string;
  opinions?: Opinion[];
  peerReviews?: PeerReview[];
  scored?: ScoredOpinion[];
  costs?: ModelCost[];
  totalCostUsd?: number;
  durationMs?: number;
  cacheHit?: boolean;
}

export interface CouncilMember {
  id: string;
  name: string;
  type: "openai-compat" | "anthropic" | "google";
  apiKey: string;
  model: string;
  baseUrl?: string;
  active: boolean;
  role: string;
  tone: string;
  customBehaviour: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
}

export interface UserMetrics {
  totalRequests: number;
  totalConversations: number;
  cache: { hits: number; hitRatePercentage: number };
  performance: { averageLatencyMs: number; totalTokensUsed: number };
}

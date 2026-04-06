import { z } from "zod";

export const AgentOutputSchema = z.object({
  name: z.string().optional(), // Agent name for reference
  answer: z.string().min(10, "answer must be at least 10 characters").max(2000, "answer must not exceed 2000 characters"),
  reasoning: z.string().min(10, "reasoning must be at least 10 characters").max(3000, "reasoning must not exceed 3000 characters"),
  key_points: z.array(z.string().min(5).max(200)).min(1, "at least one key_point is required").max(10, "maximum 10 key points allowed"),
  assumptions: z.array(z.string().min(5).max(200)).max(10, "maximum 10 assumptions allowed").default([]),
  confidence: z.number().min(0.1, "confidence must be at least 0.1").max(1.0, "confidence must not exceed 1.0"),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export interface PeerReviewFlaw {
  target: string;
  claim: string;
  issue: string;
  correction: string;
  verifiability: "high" | "medium" | "low";
  type: "factual" | "logical" | "speculative";
}

export interface PeerReview {
  reviewer: string;
  ranking: string[];
  critique: string;
  identified_flaws: PeerReviewFlaw[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  confidence_adjustment: number;
  type: "logical" | "mathematical" | "code" | "fact";
}

export interface AdversarialResult {
  is_robust: boolean;
  failures: string[];
  stress_score: number;
}

export interface GroundingResult {
  grounded: boolean;
  unsupported_claims: string[];
}

export interface ValidatorResult {
  valid: boolean;
  issues: string[];
  confidence: number;
  summary: string;
}

export interface ScoredOpinion {
  name: string;
  opinion: string;
  structured: AgentOutput;
  scores: {
    confidence: number;
    agreement: number;
    peerRanking: number;
    validationPenalty: number;
    adversarialPenalty: number;
    groundingPenalty: number;
    final: number;
  };
  validation: ValidationResult[];
  adversarial?: AdversarialResult;
  grounding?: GroundingResult;
}

export function parseAgentOutput(raw: string): AgentOutput | null {
  let jsonStr = raw.trim();

  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = AgentOutputSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function formatAgentOutput(output: AgentOutput): string {
  const parts = [output.answer];
  if (output.key_points.length > 0) {
    parts.push("\nKey Points:");
    output.key_points.forEach((p) => parts.push(`- ${p}`));
  }
  if (output.assumptions.length > 0) {
    parts.push("\nAssumptions:");
    output.assumptions.forEach((a) => parts.push(`- ${a}`));
  }
  parts.push(`\nConfidence: ${(output.confidence * 100).toFixed(0)}%`);
  return parts.join("\n");
}
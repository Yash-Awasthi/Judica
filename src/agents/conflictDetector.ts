import { routeAndCollect } from "../router/index.js";

export interface AgentResponse {
  agentId: string;
  agentName: string;
  text: string;
}

export interface Claim {
  agentId: string;
  claim: string;
}

export interface Conflict {
  agentA: string;
  agentB: string;
  claimA: string;
  claimB: string;
  contradictionType: "factual" | "opinion" | "method";
  severity: number; // 1-5
}

async function extractClaims(agentId: string, text: string): Promise<Claim[]> {
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Extract 3-5 factual claims from this text as a JSON array of strings. Only return the JSON array, no other text.\n\nText: "${text.substring(0, 2000)}"`,
      },
    ],
    temperature: 0,
  });

  try {
    const match = result.text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const claims: string[] = JSON.parse(match[0]);
    return claims.map((claim) => ({ agentId, claim }));
  } catch {
    return [];
  }
}

async function compareClaimSets(
  claimsA: Claim[],
  claimsB: Claim[],
  agentA: string,
  agentB: string
): Promise<Conflict[]> {
  if (claimsA.length === 0 || claimsB.length === 0) return [];

  const prompt = `Compare these two sets of claims and identify any contradictions.

Claims from Agent A:
${claimsA.map((c) => `- ${c.claim}`).join("\n")}

Claims from Agent B:
${claimsB.map((c) => `- ${c.claim}`).join("\n")}

Return a JSON array of contradictions. If none, return [].
Format: [{ "claim_a": "...", "claim_b": "...", "contradiction_type": "factual"|"opinion"|"method", "severity": 1-5 }]
Only return the JSON array.`;

  const result = await routeAndCollect({
    model: "auto",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  });

  try {
    const match = result.text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const raw = JSON.parse(match[0]) as Array<{
      claim_a: string;
      claim_b: string;
      contradiction_type: string;
      severity: number;
    }>;

    return raw.map((r) => ({
      agentA,
      agentB,
      claimA: r.claim_a,
      claimB: r.claim_b,
      contradictionType: (r.contradiction_type || "factual") as Conflict["contradictionType"],
      severity: Math.min(5, Math.max(1, r.severity || 3)),
    }));
  } catch {
    return [];
  }
}

export async function detectConflicts(responses: AgentResponse[]): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];

  // Extract claims for all agents in parallel
  const claimSets = await Promise.all(
    responses.map((r) => extractClaims(r.agentId, r.text))
  );

  // Compare each pair
  const comparisons: Promise<Conflict[]>[] = [];
  for (let i = 0; i < responses.length; i++) {
    for (let j = i + 1; j < responses.length; j++) {
      comparisons.push(
        compareClaimSets(
          claimSets[i],
          claimSets[j],
          responses[i].agentId,
          responses[j].agentId
        )
      );
    }
  }

  const results = await Promise.all(comparisons);
  for (const result of results) {
    conflicts.push(...result);
  }

  // Only return conflicts with severity >= 3
  return conflicts.filter((c) => c.severity >= 3);
}

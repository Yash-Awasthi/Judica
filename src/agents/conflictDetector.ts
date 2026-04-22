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

/**
 * Sanitize user/agent text before interpolation into LLM prompts.
 * Escapes prompt-injection-prone patterns: system instructions,
 * role-play markers, XML/HTML tags, and markdown code fences.
 */
function sanitizeForPrompt(text: string): string {
  let sanitized = text;
  // Strip XML/HTML-style tags that could be interpreted as prompt structure
  sanitized = sanitized.replace(/<\/?[a-zA-Z][^>]*>/g, (match) => `[tag:${match.replace(/[<>]/g, "")}]`);
  // Neutralize role-play markers (e.g., "System:", "Assistant:", "User:")
  sanitized = sanitized.replace(/\b(system|assistant|user|human)\s*:/gi, (match, role) => `${role} -`);
  // Escape markdown code fences and backticks
  sanitized = sanitized.replace(/`/g, "'");
  // Escape double quotes
  sanitized = sanitized.replace(/"/g, "'");
  // Neutralize common prompt injection phrases
  sanitized = sanitized.replace(/ignore\s+(all\s+)?previous\s+instructions/gi, "[filtered]");
  sanitized = sanitized.replace(/you\s+are\s+now\b/gi, "[filtered]");
  sanitized = sanitized.replace(/\bdo\s+not\s+follow\b/gi, "[filtered]");
  return sanitized;
}

async function extractClaims(agentId: string, text: string): Promise<Claim[]> {
  const sanitized = sanitizeForPrompt(text.substring(0, 2000));
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Extract 3-5 factual claims from this text as a JSON array of strings. Only return the JSON array, no other text.\n\n<agent_text>${sanitized}</agent_text>`,
      },
    ],
    temperature: 0,
  });

  try {
    // P8-21: Use JSON.parse() with proper validation instead of regex-only extraction
    const match = result.text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    const claims: string[] = parsed.filter((item: unknown) => typeof item === "string");
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
${claimsA.map((c) => `- ${sanitizeForPrompt(c.claim)}`).join("\n")}

Claims from Agent B:
${claimsB.map((c) => `- ${sanitizeForPrompt(c.claim)}`).join("\n")}

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

  // P8-20: Pre-filter using text similarity to avoid O(n²) LLM calls.
  // Only compare pairs whose claim texts have meaningful overlap (cosine-like check).
  const comparisons: Promise<Conflict[]>[] = [];
  for (let i = 0; i < responses.length; i++) {
    for (let j = i + 1; j < responses.length; j++) {
      // Simple keyword overlap heuristic: if claims share < 2 significant words, skip
      if (!hasTopicOverlap(claimSets[i], claimSets[j])) continue;
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

  // P8-22: Configurable severity threshold (default 3)
  const parsedThreshold = parseInt(process.env.CONFLICT_SEVERITY_THRESHOLD || "3", 10);
  const severityThreshold = Number.isNaN(parsedThreshold) ? 3 : parsedThreshold;
  return conflicts.filter((c) => c.severity >= severityThreshold);
}

const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "has", "have", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall", "this", "that", "these", "those", "it", "its", "of", "in", "on", "at", "to", "for", "with", "by", "from", "and", "or", "but", "not", "no"]);

// P8-20: Simple keyword overlap check to pre-filter unlikely-to-conflict pairs
function hasTopicOverlap(claimsA: Claim[], claimsB: Claim[]): boolean {
  if (claimsA.length === 0 || claimsB.length === 0) return false;
  const wordsA = new Set(
    claimsA.flatMap(c => c.claim.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)))
  );
  const wordsB = new Set(
    claimsB.flatMap(c => c.claim.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)))
  );
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap >= 1;
}

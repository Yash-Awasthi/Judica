import type { AgentOutput, GroundingResult } from "./schemas.js";
import type { Provider } from "./providers.js";
import { askProvider } from "./providers.js";
import logger from "./logger.js";
import { createHash } from "crypto";

// Grounding result cache — keyed by (response_hash, source_hash)
const groundingCache = new Map<string, { result: GroundingResult; expiresAt: number }>();
// NaN guard — fall back to 10 min default if env var is non-numeric
const _parsedGroundingTtl = parseInt(process.env.GROUNDING_CACHE_TTL_MS || "600000", 10);
const GROUNDING_CACHE_TTL = Number.isFinite(_parsedGroundingTtl) && _parsedGroundingTtl > 0 ? _parsedGroundingTtl : 600000; // 10 min
const MAX_GROUNDING_CACHE = 200;

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export class GroundingModule {

  async verify(output: AgentOutput, context: AgentOutput[], validatorProvider: Provider, abortSignal?: AbortSignal): Promise<GroundingResult> {
    // Check cache first
    const responseHash = hashContent(output.answer);
    const contextHash = hashContent(context.map(c => c.answer).join("|"));
    const cacheKey = `${responseHash}:${contextHash}`;
    const cached = groundingCache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.result;
      }
      // TTL expired — remove stale entry
      groundingCache.delete(cacheKey);
    }

    const contextText = context.map((c, i) => `Response ${i+1}: ${c.answer}`).join("\n\n");

    // Distinguish "unsupported" (no source) from "contradicted" (conflicting source)
    const prompt = `You are a facts-grounding auditor.

    1. Extract 2-5 specific FACTUAL CLAIMS from the target answer.
    2. Cross-reference these claims against the other responses in the council.
    3. Classify claims into categories:
       - "supported": Confirmed by at least one other agent
       - "unsupported": NOT mentioned by any other agent (may still be correct from training data)
       - "contradicted": Directly contradicted by one or more other agents
    4. Only mark as NOT grounded if there are CONTRADICTED claims.
       Unsupported claims alone do NOT make the answer ungrounded.

    TARGET ANSWER:
    ${output.answer}

    COUNCIL CONTEXT:
    ${contextText}

    Return STRICT JSON:
    {
      "claims_extracted": ["..."],
      "supported_claims": ["..."],
      "unsupported_claims": ["..."],
      "contradicted_claims": ["..."],
      "grounded": boolean
    }`;

    try {
      const response = await askProvider(validatorProvider, [{ role: "user", content: prompt }], false, abortSignal);

      // Use last JSON block (non-greedy) to avoid malformed captures
      const jsonMatches = response.text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
      const jsonStr = jsonMatches ? jsonMatches[jsonMatches.length - 1] : null;

      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);

        // Validate required fields before using result
        if (typeof parsed.grounded !== "boolean") {
          logger.warn("Grounding result missing 'grounded' boolean field — failing closed");
          return this.failClosed(cacheKey);
        }

        const result: GroundingResult = {
          // Only fail grounding on contradictions, not mere lack of support
          grounded: parsed.contradicted_claims?.length > 0 ? false : !!parsed.grounded,
          unsupported_claims: [
            ...(Array.isArray(parsed.unsupported_claims) ? parsed.unsupported_claims : []),
            ...(Array.isArray(parsed.contradicted_claims) ? parsed.contradicted_claims : [])
          ]
        };

        // Store in cache
        this.cacheResult(cacheKey, result);
        return result;
      }

      // Fail closed on unparseable output
      logger.warn("Grounding verification returned no valid JSON — failing closed");
      return this.failClosed(cacheKey);

    } catch (err) {
      // Fail closed (is_grounded=false) on grounding failure
      logger.warn({ err: (err as Error).message }, "Grounding verification failed — failing closed (not defaulting to grounded)");
      return this.failClosed(cacheKey);
    }
  }

  private failClosed(cacheKey: string): GroundingResult {
    const result: GroundingResult = {
      grounded: false,
      unsupported_claims: ["[grounding check failed — treating as ungrounded]"]
    };
    this.cacheResult(cacheKey, result);
    return result;
  }

  private cacheResult(key: string, result: GroundingResult): void {
    if (groundingCache.size >= MAX_GROUNDING_CACHE) {
      const firstKey = groundingCache.keys().next().value;
      if (firstKey) groundingCache.delete(firstKey);
    }
    groundingCache.set(key, { result, expiresAt: Date.now() + GROUNDING_CACHE_TTL });
  }
}

export const groundingModule = new GroundingModule();

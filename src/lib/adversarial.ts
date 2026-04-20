import type { AgentOutput, AdversarialResult } from "./schemas.js";
import type { Provider } from "./providers.js";
import { askProvider } from "./providers.js";
import logger from "./logger.js";
import { z } from "zod";

// P10-04: Configurable timeout for adversarial LLM calls
const ADVERSARIAL_TIMEOUT_MS = parseInt(process.env.ADVERSARIAL_TIMEOUT_MS || "15000", 10);

// P10-03: Zod schema for shape validation of parsed output
const adversarialResponseSchema = z.object({
  counter_arguments: z.array(z.string()).default([]),
  edge_cases: z.array(z.string()).default([]),
  stress_score: z.number(),
  is_robust: z.boolean(),
});

export class AdversarialModule {

  async challenge(output: AgentOutput, adversaryProvider: Provider, abortSignal?: AbortSignal): Promise<AdversarialResult> {
    const prompt = `You are a professional adversarial auditor.
Your job is to attempt to BREAK the following response.

RESPONSE TO CHALLENGE:
Answer: ${output.answer}
Reasoning: ${output.reasoning}

GOAL:
1. Generate 1-3 strong counter-arguments or refutations.
2. Identify 1-2 critical edge cases where this answer fails.
3. Assign a "stress_score" between 0 and 1, where 1 means the answer is completely invalidated by your critique, and 0 means it passed perfectly.

Return STRICT JSON:
{
  "counter_arguments": ["..."],
  "edge_cases": ["..."],
  "stress_score": number,
  "is_robust": boolean
}`;

    try {
      // P10-04: Enforce timeout via AbortSignal to prevent hanging on slow providers
      const timeoutSignal = AbortSignal.timeout(ADVERSARIAL_TIMEOUT_MS);
      const combinedSignal = abortSignal
        ? AbortSignal.any([abortSignal, timeoutSignal])
        : timeoutSignal;

      const response = await askProvider(adversaryProvider, [{ role: "user", content: prompt }], false, combinedSignal);

      // P10-02: Extract last complete JSON block (not greedy first match)
      // This handles cases where the LLM includes prose before/after JSON
      const jsonBlocks = response.text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
      const jsonStr = jsonBlocks ? jsonBlocks[jsonBlocks.length - 1] : null;

      if (!jsonStr) {
        // P10-01: Fail closed — parsing failure must return is_robust=false
        logger.warn({ responsePreview: response.text.slice(0, 200) }, "Adversarial: no JSON found in response — failing closed");
        return {
          is_robust: false,
          failures: ["Adversarial validation failed: unable to parse validator response"],
          stress_score: 0.5,
        };
      }

      let rawParsed: unknown;
      try {
        rawParsed = JSON.parse(jsonStr);
      } catch {
        // P10-01: Fail closed on JSON parse error
        logger.warn({ jsonStr: jsonStr.slice(0, 200) }, "Adversarial: JSON parse failed — failing closed");
        return {
          is_robust: false,
          failures: ["Adversarial validation failed: malformed JSON from validator"],
          stress_score: 0.5,
        };
      }

      // P10-03: Validate shape with Zod — reject missing required fields
      const parseResult = adversarialResponseSchema.safeParse(rawParsed);
      if (!parseResult.success) {
        logger.warn({ errors: parseResult.error.issues }, "Adversarial: response failed shape validation — failing closed");
        return {
          is_robust: false,
          failures: ["Adversarial validation failed: response missing required fields"],
          stress_score: 0.5,
        };
      }

      const parsed = parseResult.data;

      // P10-05: Clamp stress_score to [0, 1] — LLM may return out-of-range values
      const clampedScore = Math.max(0, Math.min(1, parsed.stress_score));

      return {
        is_robust: parsed.is_robust,
        failures: [...parsed.counter_arguments, ...parsed.edge_cases],
        stress_score: clampedScore,
      };
    } catch (err) {
      // P10-01: Fail closed — any unhandled error means we can't trust the response
      logger.warn({ err: (err as Error).message }, "Adversarial challenge failed — failing closed (is_robust=false)");
      return {
        is_robust: false,
        failures: [`Adversarial validation error: ${(err as Error).message}`],
        stress_score: 0.5,
      };
    }
  }
}

export const adversarialModule = new AdversarialModule();

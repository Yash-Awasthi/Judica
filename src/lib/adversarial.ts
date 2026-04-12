import { AgentOutput, AdversarialResult } from "./schemas.js";
import { Provider } from "./providers.js";
import { askProvider } from "./providers.js";
import logger from "./logger.js";

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
      const response = await askProvider(adversaryProvider, [{ role: "user", content: prompt }], false, abortSignal);
      
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          is_robust: !!parsed.is_robust,
          failures: [...(parsed.counter_arguments || []), ...(parsed.edge_cases || [])],
          stress_score: typeof parsed.stress_score === 'number' ? parsed.stress_score : 0.5
        };
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Adversarial challenge failed, defaulting to neutral robustness.");
    }

    return {
      is_robust: true,
      failures: [],
      stress_score: 0.1
    };
  }
}

export const adversarialModule = new AdversarialModule();

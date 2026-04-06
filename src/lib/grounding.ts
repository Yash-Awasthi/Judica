import { AgentOutput, GroundingResult } from "./schemas.js";
import { Provider } from "./providers.js";
import { askProvider } from "./providers.js";
import logger from "./logger.js";

export class GroundingModule {

  async verify(output: AgentOutput, context: AgentOutput[], validatorProvider: Provider, abortSignal?: AbortSignal): Promise<GroundingResult> {
    const contextText = context.map((c, i) => `Response ${i+1}: ${c.answer}`).join("\n\n");
    
    const prompt = `You are a facts-grounding auditor.
    
    1. Extract 2-5 specific FACTUAL CLAIMS from the target answer.
    2. Cross-reference these claims against the other responses in the council.
    3. Identify any "unsupported_claims" that are:
       - NOT mentioned by any other agent
       - AND are not common knowledge or verifiable logic.
       - OR are directly contradicted by other agents.
    
    TARGET ANSWER:
    ${output.answer}
    
    COUNCIL CONTEXT:
    ${contextText}
    
    Return STRICT JSON:
    {
      "claims_extracted": ["..."],
      "unsupported_claims": ["..."],
      "grounded": boolean
    }`;

    try {
      const response = await askProvider(validatorProvider, [{ role: "user", content: prompt }], false, abortSignal);
      
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          grounded: !!parsed.grounded,
          unsupported_claims: Array.isArray(parsed.unsupported_claims) ? parsed.unsupported_claims : []
        };
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Grounding verification failed, defaulting to grounded status.");
    }

    return {
      grounded: true,
      unsupported_claims: []
    };
  }
}

export const groundingModule = new GroundingModule();

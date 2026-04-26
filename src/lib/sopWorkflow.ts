/**
 * SOP-Driven Agent Mode — Phase 1.20
 *
 * Standard Operating Procedure mode: the council follows a structured
 * multi-step workflow rather than a single parallel call.
 *
 * Inspired by:
 * - MetaGPT (MIT, geekan/MetaGPT) — role-based agents following SOPs
 *   where each agent has a defined role in a structured workflow
 * - AutoGen (MIT, microsoft/autogen) — multi-agent conversation flows
 *
 * A SOP is a sequence of steps, each assigned to a role and producing output
 * that is passed to the next step. The final step synthesizes everything.
 *
 * Example SOP: Research → Analyze → Critique → Synthesize
 */

import { askProvider } from "./providers.js";
import type { Provider } from "./providers.js";
import logger from "./logger.js";

export interface SOPStep {
  /** Step name (e.g. "Research", "Critique") */
  name: string;
  /** Role description for the agent at this step */
  roleDescription: string;
  /** What input this step receives from previous steps (default: previous output) */
  inputFrom?: "question" | "previous" | "all";
  /** Max tokens for this step */
  maxTokens?: number;
}

export interface SOPResult {
  steps: Array<{
    step: string;
    output: string;
  }>;
  finalSynthesis: string;
  totalTokens: number;
}

/** Built-in SOP templates */
export const SOP_TEMPLATES: Record<string, SOPStep[]> = {
  research_analyze: [
    { name: "Research", roleDescription: "You are a research analyst. Gather and summarize relevant facts, evidence, and context for the question.", inputFrom: "question" },
    { name: "Analysis", roleDescription: "You are an analytical thinker. Given the research, identify patterns, implications, and key insights.", inputFrom: "previous" },
    { name: "Critique", roleDescription: "You are a critical reviewer. Identify gaps, weaknesses, and counterarguments in the analysis above.", inputFrom: "all" },
    { name: "Synthesis", roleDescription: "You are a master synthesizer. Integrate the research, analysis, and critique into a clear, well-reasoned final answer.", inputFrom: "all" },
  ],
  debate_resolve: [
    { name: "Pro", roleDescription: "You are a debate advocate. Make the strongest possible case FOR the proposition.", inputFrom: "question" },
    { name: "Con", roleDescription: "You are a devil's advocate. Make the strongest possible case AGAINST the proposition.", inputFrom: "question" },
    { name: "Judge", roleDescription: "You are a fair-minded judge. Weigh both sides and deliver a nuanced verdict.", inputFrom: "all" },
  ],
  product_design: [
    { name: "User Research", roleDescription: "You are a user researcher. Define the user needs, pain points, and jobs-to-be-done.", inputFrom: "question" },
    { name: "Solution Design", roleDescription: "You are a product designer. Propose concrete solutions based on the user research.", inputFrom: "previous" },
    { name: "Technical Review", roleDescription: "You are a tech lead. Assess feasibility and flag technical risks in the proposed solutions.", inputFrom: "all" },
    { name: "Decision", roleDescription: "You are a product manager. Make a prioritized recommendation based on all inputs.", inputFrom: "all" },
  ],
};

/**
 * Run a SOP-driven workflow on a question.
 * Each step uses one council member (round-robin if more steps than members).
 */
export async function runSOPWorkflow(
  question: string,
  members: Provider[],
  sop: SOPStep[],
  maxTokens = 1000,
): Promise<SOPResult> {
  if (members.length === 0) throw new Error("At least one council member required for SOP mode");

  const stepResults: Array<{ step: string; output: string }> = [];
  let totalTokens = 0;

  for (let i = 0; i < sop.length; i++) {
    const step = sop[i];
    const member = members[i % members.length];

    // Build input for this step
    let inputContent: string;
    if (step.inputFrom === "question") {
      inputContent = question;
    } else if (step.inputFrom === "previous" && stepResults.length > 0) {
      const prev = stepResults[stepResults.length - 1];
      inputContent = `Question: ${question}\n\nPrevious step (${prev.step}):\n${prev.output}`;
    } else if (step.inputFrom === "all" || step.inputFrom === "previous") {
      const context = stepResults.map(r => `**${r.step}:**\n${r.output}`).join("\n\n");
      inputContent = `Original question: ${question}\n\n${context}`;
    } else {
      inputContent = question;
    }

    logger.info({ step: step.name, memberName: member.name }, "SOP step executing");

    try {
      const response = await askProvider(
        { ...member, systemPrompt: step.roleDescription, maxTokens: step.maxTokens ?? maxTokens },
        [{ role: "user", content: inputContent }],
      );
      stepResults.push({ step: step.name, output: response.text.trim() });
      totalTokens += (response.usage?.totalTokens ?? 0);
    } catch (err) {
      logger.error({ err, step: step.name }, "SOP step failed");
      stepResults.push({ step: step.name, output: `[Step failed: ${err instanceof Error ? err.message : String(err)}]` });
    }
  }

  // Final synthesis is the last step's output
  const finalSynthesis = stepResults[stepResults.length - 1]?.output ?? "";

  return { steps: stepResults, finalSynthesis, totalTokens };
}

import type { NodeHandler } from "../types.js";
import { routeAndCollect } from "../../router/index.js";
import { sanitizeForPrompt as libSanitizeForPrompt } from "../../lib/sanitize.js";

// Improved template engine with proper missing variable handling
function applyTemplate(template: string, vars: Record<string, unknown>): string {
  const missingVars: string[] = [];

  const result = template.replace(/\{\{(\w+)(?::(\w+))?\}\}/g, (match, key, expectedType) => {
    const val = vars[key];

    // Track missing variables instead of silently failing
    if (val === undefined || val === null) {
      missingVars.push(key);
      return `[MISSING: ${key}]`;
    }

    // Validate variable type if type annotation present (e.g. {{name:string}})
    if (expectedType) {
      const actualType = typeof val;
      if (actualType !== expectedType && expectedType !== "any") {
        return `[TYPE_ERROR: ${key} expected ${expectedType}, got ${actualType}]`;
      }
    }

    // Sanitize interpolated values to prevent prompt injection
    // Wrap user-provided values in delimiters so LLM can distinguish them from instructions
    const stringVal = typeof val === "object" ? JSON.stringify(val) : String(val);
    return stringVal;
  });

  return result;
}

// R3-02: Use the shared sanitizeForPrompt from lib/sanitize.ts which handles
// backtick injection, template delimiters, and role-prefix injection patterns.
// The local stub was insufficient (only blocked "system:|user:|assistant:" prefixes).
function sanitizeForPrompt(value: string): string {
  return libSanitizeForPrompt(value);
}

export const llmHandler: NodeHandler = async (ctx) => {
  const systemPrompt = ctx.nodeData.system_prompt as string | undefined;
  const userPrompt = ctx.nodeData.user_prompt as string | undefined;
  const model = (ctx.nodeData.model as string) || "auto";
  const temperature = (ctx.nodeData.temperature as number) ?? 0.7;

  // Sanitize upstream inputs before template interpolation
  const sanitizedInputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx.inputs)) {
    if (typeof value === "string") {
      sanitizedInputs[key] = sanitizeForPrompt(value);
    } else {
      sanitizedInputs[key] = value;
    }
  }

  const resolvedSystem = systemPrompt ? applyTemplate(systemPrompt, sanitizedInputs) : undefined;
  const resolvedUser = userPrompt ? applyTemplate(userPrompt, sanitizedInputs) : "";

  const messages: { role: "system" | "user"; content: string }[] = [];
  if (resolvedSystem) {
    messages.push({ role: "system", content: resolvedSystem });
  }
  messages.push({ role: "user", content: resolvedUser });

  const result = await routeAndCollect({
    model,
    messages,
    temperature,
  });

  // Track LLM cost for workflow billing attribution
  const promptTokens = result.usage.prompt_tokens;
  const completionTokens = result.usage.completion_tokens;
  const estimatedCost = (promptTokens * 0.00001) + (completionTokens * 0.00003); // approximate

  return {
    text: result.text,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCost,
    },
  };
};

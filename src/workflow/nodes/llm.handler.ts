import type { NodeHandler } from "../types.js";
import { routeAndCollect } from "../../router/index.js";

function applyTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

export const llmHandler: NodeHandler = async (ctx) => {
  const systemPrompt = ctx.nodeData.system_prompt as string | undefined;
  const userPrompt = ctx.nodeData.user_prompt as string | undefined;
  const model = (ctx.nodeData.model as string) || "auto";
  const temperature = (ctx.nodeData.temperature as number) ?? 0.7;

  const resolvedSystem = systemPrompt ? applyTemplate(systemPrompt, ctx.inputs) : undefined;
  const resolvedUser = userPrompt ? applyTemplate(userPrompt, ctx.inputs) : "";

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

  return {
    text: result.text,
    usage: {
      promptTokens: result.usage.prompt_tokens,
      completionTokens: result.usage.completion_tokens,
    },
  };
};

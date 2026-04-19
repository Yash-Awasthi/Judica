import type { Message, Provider } from "../providers.js";
import { getToolDefinitions, callTool } from "../tools/index.js";

export async function askAnthropic(
  provider: Provider,
  normMessages: Message[],
  maxTokens: number,
  signal: AbortSignal
): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: provider.model || "claude-3-5-haiku-20241022",
      max_tokens: maxTokens,
      ...(provider.systemPrompt ? { system: provider.systemPrompt } : {}),
      messages: normMessages,
      tools: getToolDefinitions(provider.tools || []).map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }))
    }),
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(data.error?.message ?? `Anthropic error ${res.status}`);

  const content = data.content || [];
  const toolCalls = content.filter((c: any) => c.type === "tool_use");

  if (toolCalls.length > 0) {
    const nextMessages: Message[] = [...normMessages, { role: "assistant" as const, content }];
    for (const tc of toolCalls) {
      const result = await callTool({ id: tc.id, name: tc.name, arguments: tc.input });
      const safeResult = `[UNTRUSTED TOOL OUTPUT]\n${result}\n[/UNTRUSTED TOOL OUTPUT]`;
      nextMessages.push({
        role: "user" as const,
        content: [
          {
            type: "tool_result",
            tool_use_id: tc.id,
            content: safeResult
          }
        ]
      });
    }
    return askAnthropic(provider, nextMessages, maxTokens, signal);
  }

  return {
    text: content.find((c: any) => c.type === "text")?.text ?? JSON.stringify(data),
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens
    } : undefined
  };
}

export async function streamAnthropic(
  provider: Provider,
  normMessages: Message[],
  maxTokens: number,
  signal: AbortSignal,
  onChunk: (chunk: string) => void
): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: provider.model || "claude-3-5-haiku-20241022",
      max_tokens: maxTokens,
      stream: true,
      ...(provider.systemPrompt ? { system: provider.systemPrompt } : {}),
      messages: normMessages,
    }),
  });

  if (!res.ok) throw new Error(((await res.json()) as any).error?.message ?? `Anthropic error ${res.status}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.type === "message_start") {
             usage.promptTokens = json.message.usage.input_tokens;
          }
          if (json.type === "message_delta") {
             usage.completionTokens = json.usage.output_tokens;
          }
          const chunk = json.delta?.text ?? "";
          if (chunk) { fullText += chunk; onChunk(chunk); }
        } catch { /* no-op */ }
      }
    }
  }
  usage.totalTokens = usage.promptTokens + usage.completionTokens;
  return { text: fullText, usage };
}

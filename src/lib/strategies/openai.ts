import type { Message, Provider } from "../providers.js";
import { getToolDefinitions, callTool } from "../tools/index.js";
import { validateSafeUrl } from "../ssrf.js";

interface ProviderResult {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function askOpenAI(
  provider: Provider,
  normMessages: Message[],
  resolvedBaseUrl: string | undefined,
  maxTokens: number,
  signal: AbortSignal,
  isFallback: boolean,
  askFn: (provider: Provider, messages: Message[], isFallback: boolean) => Promise<ProviderResult>
): Promise<ProviderResult> {
  const url = (resolvedBaseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  await validateSafeUrl(url);

  const oaiTools = getToolDefinitions(provider.tools || []).map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));

  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    signal,
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      messages: [
        ...(provider.systemPrompt ? [{ role: "system", content: provider.systemPrompt }] : []),
        ...normMessages,
      ],
      ...(oaiTools?.length ? { tools: oaiTools, tool_choice: "auto" } : {}),
    }),
  });
  const data = (await res.json()) as { error?: { message?: string }; choices?: Array<{ message?: { content?: string; reasoning?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
  if (!res.ok) throw new Error(data.error?.message ?? `Provider error ${res.status}`);

  const msg = data.choices?.[0]?.message;
  if (msg?.tool_calls?.length) {
    const nextMessages: Message[] = [...normMessages, { role: 'assistant' as const, content: msg.content || '' }];
    for (const tc of msg.tool_calls) {
      const result = await callTool({ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments) });
      const safeResult = `[UNTRUSTED TOOL OUTPUT]\n${result}\n[/UNTRUSTED TOOL OUTPUT]`;
      nextMessages.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: safeResult });
    }
    return askFn(provider, nextMessages, isFallback);
  }

  const raw = msg?.content || msg?.reasoning || JSON.stringify(data);
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  return {
    text,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens
    } : undefined
  };
}

export async function streamOpenAI(
  provider: Provider,
  normMessages: Message[],
  resolvedBaseUrl: string | undefined,
  maxTokens: number,
  signal: AbortSignal,
  isFallback: boolean,
  onChunk: (chunk: string) => void,
  streamFn: (provider: Provider, messages: Message[], onChunk: (c: string) => void, isFallback: boolean) => Promise<ProviderResult>
): Promise<ProviderResult> {
  const url = (resolvedBaseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  await validateSafeUrl(url);

  const oaiTools = getToolDefinitions(provider.tools || []).map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));

  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    signal,
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      stream: true,
      messages: [
        ...(provider.systemPrompt ? [{ role: "system", content: provider.systemPrompt }] : []),
        ...normMessages,
      ],
      ...(oaiTools?.length ? { tools: oaiTools, tool_choice: "auto" } : {}),
    }),
  });

  if (!res.ok) throw new Error(((await res.json()) as { error?: { message?: string } }).error?.message ?? `Provider error ${res.status}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let usage: ProviderResult["usage"];
  let inThink = false;
  const toolCalls: Array<{ id: string; name: string; args: string }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split("\n")) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const json = JSON.parse(line.slice(6));
          const delta = json.choices?.[0]?.delta ?? {};

          if (json.usage) {
             usage = {
               promptTokens: json.usage.prompt_tokens,
               completionTokens: json.usage.completion_tokens,
               totalTokens: json.usage.total_tokens
             };
          }

          if (delta.tool_calls) {
            for (const stc of delta.tool_calls) {
              const idx = stc.index;
              if (!toolCalls[idx]) toolCalls[idx] = { id: stc.id, name: "", args: "" };
              if (stc.function?.name) toolCalls[idx].name += stc.function.name;
              if (stc.function?.arguments) toolCalls[idx].args += stc.function.arguments;
            }
            continue;
          }

          const chunk = delta.content || delta.reasoning || "";
          if (chunk) {
            fullText += chunk;
            let toSend = "";
            let remaining = chunk;
            while (remaining.length > 0) {
              if (inThink) {
                const endIdx = remaining.indexOf("</think>");
                if (endIdx === -1) remaining = "";
                else { inThink = false; remaining = remaining.slice(endIdx + 8); }
              } else {
                const startIdx = remaining.indexOf("<think>");
                if (startIdx === -1) { toSend += remaining; remaining = ""; }
                else { toSend += remaining.slice(0, startIdx); inThink = true; remaining = remaining.slice(startIdx + 7); }
              }
            }
            if (toSend) onChunk(toSend);
          }
        } catch { /* no-op */ }
      }
    }
  }

  if (toolCalls.length > 0) {
    const finalToolCalls = toolCalls.filter(Boolean);
    const nextMessages = [
      ...normMessages,
      {
        role: "assistant", content: fullText,
        tool_calls: finalToolCalls.map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.args } }))
      } as Message
    ];
    for (const tc of finalToolCalls) {
      const result = await callTool({ id: tc.id, name: tc.name, arguments: JSON.parse(tc.args) });
      const safeResult = `[UNTRUSTED TOOL OUTPUT]\n${result.result}\n[/UNTRUSTED TOOL OUTPUT]`;
      nextMessages.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content: safeResult });
    }
    return streamFn(provider, nextMessages, onChunk, isFallback);
  }

  return { text: fullText, usage };
}

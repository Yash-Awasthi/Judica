import type { Message, Provider } from "../providers.js";
import { getToolDefinitions, callTool } from "../tools/index.js";

interface ProviderResult {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function askGoogle(
  provider: Provider,
  normMessages: Message[],
  maxTokens: number,
  signal: AbortSignal
): Promise<ProviderResult> {
  const googleContents = normMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${provider.model || "gemini-2.5-flash"}:generateContent?key=${provider.apiKey}`,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(provider.systemPrompt
          ? { systemInstruction: { parts: [{ text: provider.systemPrompt }] } }
          : {}),
        contents: googleContents,
        generationConfig: { maxOutputTokens: maxTokens },
        tools: getToolDefinitions(provider.tools || []).length ? [{
          function_declarations: getToolDefinitions(provider.tools || []).map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }))
        }] : undefined
      }),
    }
  );
  const data = (await res.json()) as { error?: { message?: string }; candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> } }>; usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number } };
  if (!res.ok) throw new Error(data.error?.message ?? `Google error ${res.status}`);

  const candidate = data.candidates?.[0];
  const part = candidate?.content?.parts?.[0];

  if (part?.functionCall) {
    const { name, args } = part.functionCall;
    const result = await callTool({ id: `google-${Date.now()}`, name, arguments: args });
    const safeResult = `[UNTRUSTED TOOL OUTPUT]\n${result}\n[/UNTRUSTED TOOL OUTPUT]`;

    const nextMessages: Message[] = [...normMessages,
      { role: "assistant" as const, content: JSON.stringify(part) },
      { role: "tool" as const, name, content: safeResult }
    ];
    return askGoogle(provider, nextMessages, maxTokens, signal);
  }

  return {
    text: part?.text ?? JSON.stringify(data),
    usage: data.usageMetadata ? {
      promptTokens: data.usageMetadata.promptTokenCount,
      completionTokens: data.usageMetadata.candidatesTokenCount,
      totalTokens: data.usageMetadata.totalTokenCount
    } : undefined
  };
}

export async function streamGoogle(
  provider: Provider,
  normMessages: Message[],
  maxTokens: number,
  signal: AbortSignal,
  onChunk: (chunk: string) => void
): Promise<ProviderResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${provider.model || "gemini-2.5-flash"}:streamGenerateContent?key=${provider.apiKey}&alt=sse`,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(provider.systemPrompt ? { systemInstruction: { parts: [{ text: provider.systemPrompt }] } } : {}),
        contents: normMessages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    }
  );

  if (!res.ok) throw new Error(((await res.json()) as { error?: { message?: string } }).error?.message ?? `Google error ${res.status}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let usage: ProviderResult["usage"];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const json = JSON.parse(line.slice(6));
          const chunk = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (chunk) { fullText += chunk; onChunk(chunk); }

          if (json.usageMetadata) {
            usage = {
              promptTokens: json.usageMetadata.promptTokenCount,
              completionTokens: json.usageMetadata.candidatesTokenCount,
              totalTokens: json.usageMetadata.totalTokenCount
            };
          }
        } catch { /* no-op */ }
      }
    }
  }
  return { text: fullText, usage };
}

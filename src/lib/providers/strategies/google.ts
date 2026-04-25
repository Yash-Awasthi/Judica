// DEPRECATED — Strictly inferior to src/adapters/gemini.adapter.ts.
import type { Message, Provider } from "../../providers.js";
import { getToolDefinitions, callTool } from "../../tools/index.js";
import { validateSafeUrl } from "../../ssrf.js";

// Maximum tool-call recursion depth to prevent stack overflow
const MAX_TOOL_RECURSION_DEPTH = 5;

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
  signal: AbortSignal,
  _depth = 0
): Promise<ProviderResult> {
  const googleContents = normMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Validate model name to prevent URL path injection / SSRF
  const modelName = (provider.model || "gemini-2.5-flash-preview-05-20").replace(/[^a-zA-Z0-9._-]/g, "");
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
  // SSRF validation on strategy-level fetch
  await validateSafeUrl(apiUrl);

  const res = await fetch(
    apiUrl,
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": provider.apiKey,
      },
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
    // Prevent infinite recursion
    if (_depth >= MAX_TOOL_RECURSION_DEPTH) {
      throw new Error(`Tool-call recursion limit (${MAX_TOOL_RECURSION_DEPTH}) exceeded`);
    }
    const { name, args } = part.functionCall;
    const result = await callTool({ id: `google-${Date.now()}`, name, arguments: args });
    const safeResult = `[UNTRUSTED TOOL OUTPUT]\n${result}\n[/UNTRUSTED TOOL OUTPUT]`;

    const nextMessages: Message[] = [...normMessages,
      { role: "assistant" as const, content: JSON.stringify(part) },
      { role: "tool" as const, name, content: safeResult }
    ];
    return askGoogle(provider, nextMessages, maxTokens, signal, _depth + 1);
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
    // Sanitize model name in streaming URL to prevent path injection
    `https://generativelanguage.googleapis.com/v1beta/models/${(provider.model || "gemini-2.5-flash-preview-05-20").replace(/[^a-zA-Z0-9._-]/g, "")}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": provider.apiKey,
      },
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
  // Cap accumulated stream buffer to prevent memory exhaustion
  const MAX_STREAM_BUFFER = 2_000_000; // ~2MB
  // Buffer across reads and split on \n boundary properly
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (fullText.length > MAX_STREAM_BUFFER) {
      break;
    }
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
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

export interface Provider {
  name: string;
  type: "openai-compat" | "anthropic" | "google";
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
}

export async function askProvider(provider: Provider, question: string): Promise<string> {
  const { apiKey, model, baseUrl, systemPrompt } = provider;
  
  // Auto-detect type from model name if missing
  let type = provider.type;
  if (!type || type === "openai-compat") {
    if (model?.includes("gemini")) type = "google";
    else if (model?.includes("claude")) type = "anthropic";
    else type = "openai-compat";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    // ── Anthropic ──────────────────────────────────────────
    if (type === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: model || "claude-3-5-haiku-20241022",
          max_tokens: 512,
          messages: [{ role: "user", content: question }],
        }),
      });
      const data = await res.json() as any;
      return data.content?.[0]?.text ?? JSON.stringify(data);
    }

    // ── Google Gemini ──────────────────────────────────────
    if (type === "google") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-2.5-flash"}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: question }] }],
          }),
        }
      );
      const data = await res.json() as any;
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(data);
    }

    // ── OpenAI-compatible (NVIDIA, OpenAI, Groq, OpenRouter) ──
    const url = (baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await fetch(`${url}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: question },
        ],
        max_tokens: 512,
      }),
    });
    const data = await res.json() as any;
    const msg = data.choices?.[0]?.message;
    const raw = msg?.content || msg?.reasoning || JSON.stringify(data);
    return raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  } catch (e: any) {
    if (e.name === "AbortError") return "[Error: request timed out after 30s]";
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function askProviderStream(
  provider: Provider,
  question: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  const { apiKey, model, baseUrl, systemPrompt } = provider;

  let type = provider.type;
  if (!type || type === "openai-compat") {
    if (model?.includes("gemini")) type = "google";
    else if (model?.includes("claude")) type = "anthropic";
    else type = "openai-compat";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let fullText = "";

  try {
    // ── Anthropic streaming ────────────────────────────
    if (type === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: model || "claude-3-5-haiku-20241022",
          max_tokens: 512,
          stream: true,
          messages: [{ role: "user", content: question }],
        }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const json = JSON.parse(line.slice(6));
              const chunk = json.delta?.text ?? "";
              if (chunk) { fullText += chunk; onChunk(chunk); }
            } catch {}
          }
        }
      }
      return fullText;
    }

    // ── Google streaming ───────────────────────────────
    if (type === "google") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-2.5-flash"}:streamGenerateContent?key=${apiKey}&alt=sse`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: question }] }] }),
        }
      );

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const json = JSON.parse(line.slice(6));
              const chunk = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
              if (chunk) { fullText += chunk; onChunk(chunk); }
            } catch {}
          }
        }
      }
      return fullText;
    }

    // ── OpenAI-compatible streaming ────────────────────
    const url = (baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await fetch(`${url}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: question },
        ],
        max_tokens: 512,
      }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let inThink = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const json = JSON.parse(line.slice(6));           
            const delta = json.choices?.[0]?.delta ?? {};
            const chunk = delta.content || delta.reasoning || "";
            if (chunk) {
              fullText += chunk;
              let toSend = "";
              let remaining = chunk;

              while (remaining.length > 0) {
                if (inThink) {
                  const endIdx = remaining.indexOf("</think>");
                  if (endIdx === -1) {
                    remaining = "";
                  } else {
                    inThink = false;
                    remaining = remaining.slice(endIdx + 8);
                  }
                } else {
                  const startIdx = remaining.indexOf("<think>");
                  if (startIdx === -1) {
                    toSend += remaining;
                    remaining = "";
                  } else {
                    toSend += remaining.slice(0, startIdx);
                    inThink = true;
                    remaining = remaining.slice(startIdx + 7);
                  }
                }
              }

              if (toSend) onChunk(toSend);
            }
          } catch {}
        }
      }
    }
    return fullText;

  } catch (e: any) {
    if (e.name === "AbortError") return "[Error: request timed out]";
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
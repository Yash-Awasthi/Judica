/**
 * Calls the AI deliberation command.
 * - In Tauri (desktop): uses the Rust `deliberate` command directly (secure, no server needed)
 * - Falls back to fetch for web builds
 */

interface Member {
  name: string;
  opinion?: string;
}

interface DeliberateArgs {
  prompt: string;
  members: Member[];
  type: "opinion" | "verdict";
}

interface Settings {
  provider: "anthropic" | "openai";
  anthropicKey?: string;
  openaiKey?: string;
  anthropicModel?: string;
  openaiModel?: string;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("aibyai_settings");
    return raw ? JSON.parse(raw) : { provider: "anthropic" };
  } catch {
    return { provider: "anthropic" };
  }
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function deliberate(args: DeliberateArgs): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const settings = loadSettings();
    const apiKey =
      settings.provider === "anthropic"
        ? settings.anthropicKey ?? ""
        : settings.openaiKey ?? "";

    if (!apiKey) {
      throw new Error(
        `No API key set for ${settings.provider}. Open Settings to add your key.`
      );
    }

    const text = await invoke<string>("deliberate", {
      req: {
        prompt: args.prompt,
        members: args.members,
        type: args.type,
        provider: settings.provider,
        api_key: apiKey,
        model:
          settings.provider === "anthropic"
            ? settings.anthropicModel ?? null
            : settings.openaiModel ?? null,
      },
    });
    return text;
  }

  // Web fallback (Cloudflare Workers build)
  const res = await fetch("/api/deliberate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "AI request failed");
  return data.text;
}

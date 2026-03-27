/**
 * ping-all-providers.ts
 * 
 * Standalone script to verify connectivity to every AI provider & model
 * listed in the user's model matrix.  Run with:
 *
 *   npx tsx --env-file=.env scripts/ping-all-providers.ts
 *
 * Each test sends a minimal "ping" prompt and reports success / failure.
 */

// ── API Keys (from env) ────────────────────────────────────────────────
const KEYS = {
  NVIDIA:      process.env.NVIDIA_API_KEY!,
  GEMINI:      process.env.GOOGLE_API_KEY!,
  GROQ:        process.env.GROQ_API_KEY!,
  OPENROUTER:  process.env.OPENROUTER_API_KEY!,
  OPENAI:      process.env.OPENAI_API_KEY!,
  MISTRAL:     process.env.MISTRAL_API_KEY!,
  CEREBRAS:    process.env.CEREBRAS_API_KEY!,
  TAVILY:      process.env.TAVILY_API_KEY!,
  XIAOMI_MIMO: process.env.XIAOMI_MIMO_API_KEY!,
};

// ── Model definitions ──────────────────────────────────────────────────
interface ModelTest {
  id: string;
  provider: string;
  model: string;
  type: "openai-compat" | "google" | "tavily";
  baseUrl?: string;
  apiKey: string;
}

const MODELS: ModelTest[] = [
  // ── Google Gemini (native REST API) ──
  {
    id: "gemini-2.5-flash",
    provider: "aistudio.google.com",
    model: "gemini-2.5-flash",
    type: "google",
    apiKey: KEYS.GEMINI,
  },




  // ── OpenRouter ──
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter.ai",
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    type: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: KEYS.OPENROUTER,
  },
  {
    id: "stepfun/step-3.5-flash:free",
    provider: "openrouter.ai",
    model: "stepfun/step-3.5-flash:free",
    type: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: KEYS.OPENROUTER,
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    provider: "openrouter.ai",
    model: "nvidia/nemotron-3-nano-30b-a3b:free",
    type: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: KEYS.OPENROUTER,
  },
  {
    id: "arcee-ai/trinity-large-preview:free",
    provider: "openrouter.ai",
    model: "arcee-ai/trinity-large-preview:free",
    type: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: KEYS.OPENROUTER,
  },

  // ── Mistral ──
  {
    id: "mistral-small-latest",
    provider: "console.mistral.ai",
    model: "mistral-small-latest",
    type: "openai-compat",
    baseUrl: "https://api.mistral.ai/v1",
    apiKey: KEYS.MISTRAL,
  },



  // ── Tavily (search API, not chat) ──
  {
    id: "tavily-search",
    provider: "tavily.com",
    model: "Researcher Plan",
    type: "tavily",
    apiKey: KEYS.TAVILY,
  },

  // ── OpenAI (bonus — key is in .env) ──
  {
    id: "gpt-4o",
    provider: "openai.com",
    model: "gpt-4o",
    type: "openai-compat",
    baseUrl: "https://api.openai.com/v1",
    apiKey: KEYS.OPENAI,
  },
];

// ── Ping functions ─────────────────────────────────────────────────────

async function pingOpenAICompat(m: ModelTest): Promise<string> {
  const url = `${m.baseUrl!.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${m.apiKey}`,
    },
    body: JSON.stringify({
      model: m.model,
      max_tokens: 10,
      messages: [{ role: "user", content: "Ping. Reply with exactly 'pong'." }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data: any = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message ?? data.message ?? `HTTP ${res.status}`);
  }
  const text = data.choices?.[0]?.message?.content ?? "";
  return text.trim().slice(0, 80);
}

async function pingGoogle(m: ModelTest): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m.model}:generateContent?key=${m.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Ping. Reply with exactly 'pong'." }] }],
      generationConfig: { maxOutputTokens: 10 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data: any = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text.trim().slice(0, 80);
}

async function pingTavily(m: ModelTest): Promise<string> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: m.apiKey,
      query: "hello world test",
      max_results: 1,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json();
  if (!res.ok) {
    throw new Error(data.detail ?? data.message ?? `HTTP ${res.status}`);
  }
  return `OK — ${data.results?.length ?? 0} result(s)`;
}

// ── Main ───────────────────────────────────────────────────────────────

const COL = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m", bold: "\x1b[1m" };

async function main() {
  console.log(`\n${COL.bold}${COL.cyan}╔══════════════════════════════════════════════════════════════╗${COL.reset}`);
  console.log(`${COL.bold}${COL.cyan}║        AI COUNCIL — Provider Ping Test                       ║${COL.reset}`);
  console.log(`${COL.bold}${COL.cyan}╚══════════════════════════════════════════════════════════════╝${COL.reset}\n`);

  // Pre-flight key check
  console.log(`${COL.bold}API Key Check:${COL.reset}`);
  for (const [name, key] of Object.entries(KEYS)) {
    const status = key ? `${COL.green}✓ set${COL.reset} (${key.slice(0, 8)}…)` : `${COL.red}✗ MISSING${COL.reset}`;
    console.log(`  ${name.padEnd(14)} ${status}`);
  }
  console.log();

  // Run pings sequentially for clearer output
  let pass = 0, fail = 0;
  const results: { id: string; provider: string; status: string; response: string; latency: number }[] = [];

  for (const m of MODELS) {
    const label = `${m.provider} / ${m.id}`;
    process.stdout.write(`  ${COL.dim}⏳ ${label.padEnd(55)}${COL.reset}`);

    if (!m.apiKey) {
      console.log(`${COL.yellow}SKIP${COL.reset} (no API key)`);
      results.push({ id: m.id, provider: m.provider, status: "SKIP", response: "No API key", latency: 0 });
      continue;
    }

    const start = Date.now();
    try {
      let response: string;
      if (m.type === "google") {
        response = await pingGoogle(m);
      } else if (m.type === "tavily") {
        response = await pingTavily(m);
      } else {
        response = await pingOpenAICompat(m);
      }
      const latency = Date.now() - start;
      console.log(`\r  ${COL.green}✓ PASS${COL.reset} ${label.padEnd(50)} ${COL.dim}${latency}ms${COL.reset}  → ${response}`);
      results.push({ id: m.id, provider: m.provider, status: "PASS", response, latency });
      pass++;
    } catch (err: any) {
      const latency = Date.now() - start;
      console.log(`\r  ${COL.red}✗ FAIL${COL.reset} ${label.padEnd(50)} ${COL.dim}${latency}ms${COL.reset}  → ${err.message?.slice(0, 100)}`);
      results.push({ id: m.id, provider: m.provider, status: "FAIL", response: err.message?.slice(0, 200), latency });
      fail++;
    }
  }

  // Summary
  console.log(`\n${COL.bold}═══════════════════════════════════════════════════════════════${COL.reset}`);
  console.log(`${COL.bold}  Results: ${COL.green}${pass} passed${COL.reset}, ${COL.red}${fail} failed${COL.reset}, ${MODELS.length - pass - fail} skipped out of ${MODELS.length} total`);
  console.log(`${COL.bold}═══════════════════════════════════════════════════════════════${COL.reset}\n`);

  // JSON output for programmatic use
  // console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

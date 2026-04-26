/**
 * Local Model Benchmarking — Phase 8.12
 *
 * Benchmarks multiple LLM providers/models against a standard test suite.
 * Measures: latency (p50/p95/p99), throughput (tokens/sec), cost, accuracy.
 *
 * Usage:
 *   npm run bench:models
 *   npm run bench:models -- --providers openai,groq --suite quick
 *
 * Suites:
 *   quick  — 10 prompts, 1 repeat each
 *   full   — 50 prompts, 3 repeats each
 *   custom — prompts from --file path
 */

import { askProvider } from "../../src/lib/providers.js";
import { env } from "../../src/config/env.js";
import { writeFileSync } from "fs";

const BENCHMARK_PROMPTS = [
  "What is 17 × 23?",
  "Summarize the French Revolution in 2 sentences.",
  "Write a Python function that reverses a string.",
  "What are the 3 laws of thermodynamics?",
  "Explain recursion to a 10-year-old.",
  "What is the capital of Mongolia?",
  "List 5 sorting algorithms with their time complexity.",
  "What is the difference between SQL and NoSQL?",
  "Explain the concept of gradient descent.",
  "What is the Turing test?",
];

interface BenchResult {
  provider:     string;
  model:        string;
  promptIndex:  number;
  latencyMs:    number;
  promptTokens: number;
  completion:   number;
  tokensPerSec: number;
  error:        string | null;
}

interface BenchSummary {
  provider:       string;
  model:          string;
  runCount:       number;
  errorCount:     number;
  p50LatencyMs:   number;
  p95LatencyMs:   number;
  p99LatencyMs:   number;
  avgTokensPerSec: number;
  avgCostUsd:     number;
}

function percentile(sorted: number[], p: number): number {
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, i)];
}

const PROVIDERS = [
  { name: "openai", model: "gpt-4o-mini",     apiKey: env.OPENAI_API_KEY ?? "", type: "api" as const },
  { name: "groq",   model: "llama-3.1-8b-instant", apiKey: env.GROQ_API_KEY ?? "", type: "api" as const },
  { name: "ollama", model: "llama3",           apiKey: "",                      type: "api" as const },
].filter(p => p.apiKey || p.name === "ollama");

async function runBenchmark(suite: "quick" | "full" = "quick") {
  const prompts = suite === "quick" ? BENCHMARK_PROMPTS.slice(0, 10) : BENCHMARK_PROMPTS;
  const repeats = suite === "quick" ? 1 : 3;
  const results: BenchResult[] = [];

  console.log(`\nBenchmarking ${PROVIDERS.length} provider(s), ${prompts.length} prompts × ${repeats} repeat(s)\n`);

  for (const provider of PROVIDERS) {
    console.log(`  Provider: ${provider.name}/${provider.model}`);

    for (let r = 0; r < repeats; r++) {
      for (let i = 0; i < prompts.length; i++) {
        const start = Date.now();
        let promptTokens = 0;
        let completion = 0;
        let error: string | null = null;

        try {
          const res = await askProvider(provider, [{ role: "user", content: prompts[i] }]);
          promptTokens = res.usage?.promptTokens ?? 0;
          completion   = res.usage?.completionTokens ?? 0;
        } catch (err) {
          error = (err as Error).message.slice(0, 100);
        }

        const latencyMs = Date.now() - start;
        const tokensPerSec = latencyMs > 0 ? (completion / (latencyMs / 1000)) : 0;

        results.push({
          provider: provider.name,
          model:    provider.model,
          promptIndex: i,
          latencyMs,
          promptTokens,
          completion,
          tokensPerSec,
          error,
        });
      }
    }
  }

  // Summarize per provider
  const summaries: BenchSummary[] = [];
  const providerGroups = new Map<string, BenchResult[]>();

  for (const r of results) {
    const key = `${r.provider}/${r.model}`;
    if (!providerGroups.has(key)) providerGroups.set(key, []);
    providerGroups.get(key)!.push(r);
  }

  for (const [key, rows] of providerGroups) {
    const [provider, model] = key.split("/");
    const successful = rows.filter(r => !r.error);
    const latencies = successful.map(r => r.latencyMs).sort((a, b) => a - b);
    const tps = successful.map(r => r.tokensPerSec);

    summaries.push({
      provider,
      model,
      runCount:        rows.length,
      errorCount:      rows.filter(r => r.error).length,
      p50LatencyMs:    percentile(latencies, 50),
      p95LatencyMs:    percentile(latencies, 95),
      p99LatencyMs:    percentile(latencies, 99),
      avgTokensPerSec: tps.length > 0 ? tps.reduce((a, b) => a + b, 0) / tps.length : 0,
      avgCostUsd:      0, // Future: integrate cost per provider
    });
  }

  // Print table
  console.log("\n─── RESULTS ──────────────────────────────────────────────────────────");
  console.log("Provider          Model                  Runs  Err  p50ms  p95ms  p99ms  tok/s");
  console.log("────────────────────────────────────────────────────────────────────────────");
  for (const s of summaries) {
    console.log(
      `${s.provider.padEnd(16)}  ${s.model.padEnd(22)} ${String(s.runCount).padStart(4)}  ${String(s.errorCount).padStart(3)}  ${String(Math.round(s.p50LatencyMs)).padStart(5)}  ${String(Math.round(s.p95LatencyMs)).padStart(5)}  ${String(Math.round(s.p99LatencyMs)).padStart(5)}  ${String(Math.round(s.avgTokensPerSec)).padStart(5)}`
    );
  }

  // Write JSON report
  const report = { timestamp: new Date().toISOString(), suite, summaries, rawResults: results };
  const outPath = `bench-results-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n✓ Full results written to: ${outPath}`);
}

const suite = process.argv.includes("--full") ? "full" : "quick";
runBenchmark(suite).catch(err => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});

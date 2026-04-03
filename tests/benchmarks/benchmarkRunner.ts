import fs from 'fs/promises';
import path from 'path';

/**
 * Benchmark framework for evaluating council deliberation quality
 */

export interface BenchmarkTestCase {
  question: string;
  expected_properties: string[];
  description: string;
}

export interface MetricResult {
  score: number;
  latencyMs: number;
  tokens: number;
  cost: number;
  hallucinationCount: number;
}

export interface BenchmarkResult {
  description: string;
  input: string;
  council: MetricResult;
  baseline: MetricResult;
  comparison: {
    accuracyGain: number; // council_score - baseline_score
    efficiencyRatio: number; // baseline_cost / council_cost
  };
}

export interface BenchmarkSummary {
  totalTests: number;
  averageAccuracyGain: number;
  totalCouncilCost: number;
  totalBaselineCost: number;
  results: BenchmarkResult[];
}

const CASES_DIR = path.join(process.cwd(), 'tests', 'benchmarks', 'cases');

async function loadTestCases(): Promise<BenchmarkTestCase[]> {
  const files = ['factual.json', 'logic.json', 'math.json', 'code.json', 'adversarial.json'];
  const allCases: BenchmarkTestCase[] = [];

  for (const file of files) {
    try {
      const data = await fs.readFile(path.join(CASES_DIR, file), 'utf8');
      const cases = JSON.parse(data);
      allCases.push(...cases);
    } catch (err) {
      console.warn(`Could not load ${file}:`, (err as Error).message);
    }
  }

  return allCases;
}

/**
 * Check if response contains expected properties (keywords/concepts)
 */
function checkAccuracy(response: string, expected: string[]): number {
  const normalizedResponse = response.toLowerCase();
  let matched = 0;

  for (const property of expected) {
    if (normalizedResponse.includes(property.toLowerCase())) {
      matched++;
    }
  }

  return matched / expected.length;
}

/**
 * Run a single request to the API
 */
async function callApi(
  question: string,
  mode: 'auto' | 'single' = 'auto',
  endpoint: string
): Promise<MetricResult & { verdict: string }> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 2min timeout for heavy council runs

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, mode: mode === 'single' ? 'direct' : 'auto' }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json() as any;
    
    const metric: MetricResult = {
      score: 0, // Calculated later
      latencyMs,
      tokens: data.metrics?.totalTokens || 0,
      cost: data.metrics?.totalCost || 0,
      hallucinationCount: data.metrics?.hallucinationCount || 0
    };

    return { ...metric, verdict: data.verdict || "" };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Run full benchmark suite
 */
export async function runBenchmark(
  endpoint = "http://localhost:3000/api/ask"
): Promise<BenchmarkSummary> {
  const testCases = await loadTestCases();
  console.log(`Running ${testCases.length} benchmark tests vs Single-Model Baseline...\n`);

  const results: BenchmarkResult[] = [];

  for (const testCase of testCases) {
    process.stdout.write(`Testing: ${testCase.description}... `);
    
    try {
      // 1. Council Run
      const councilCall = await callApi(testCase.question, 'auto', endpoint);
      const councilRes: MetricResult = {
        score: checkAccuracy(councilCall.verdict, testCase.expected_properties),
        latencyMs: councilCall.latencyMs,
        tokens: councilCall.tokens,
        cost: councilCall.cost,
        hallucinationCount: councilCall.hallucinationCount
      };

      // 2. Baseline Run (Single LLM)
      const baselineCall = await callApi(testCase.question, 'single', endpoint);
      const baselineRes: MetricResult = {
        score: checkAccuracy(baselineCall.verdict, testCase.expected_properties),
        latencyMs: baselineCall.latencyMs,
        tokens: baselineCall.tokens,
        cost: baselineCall.cost,
        hallucinationCount: baselineCall.hallucinationCount
      };

      const result: BenchmarkResult = {
        description: testCase.description,
        input: testCase.question,
        council: councilRes,
        baseline: baselineRes,
        comparison: {
          accuracyGain: councilRes.score - baselineRes.score,
          efficiencyRatio: baselineRes.cost / (councilRes.cost || 1)
        }
      };

      results.push(result);
      console.log(`✓ (Gain: ${((result.comparison.accuracyGain) * 100).toFixed(0)}%)`);
    } catch (err) {
      console.log(`✗ Error: ${(err as Error).message}`);
    }
  }

  const summary: BenchmarkSummary = {
    totalTests: results.length,
    averageAccuracyGain: results.reduce((sum, r) => sum + r.comparison.accuracyGain, 0) / (results.length || 1),
    totalCouncilCost: results.reduce((sum, r) => sum + r.council.cost, 0),
    totalBaselineCost: results.reduce((sum, r) => sum + r.baseline.cost, 0),
    results
  };

  console.log(`\n--- FINAL PROOF ---`);
  console.log(`Total Tests: ${summary.totalTests}`);
  console.log(`Avg Accuracy Gain (Council vs Baseline): ${(summary.averageAccuracyGain * 100).toFixed(1)}%`);
  console.log(`Total Council Cost: $${summary.totalCouncilCost.toFixed(4)}`);
  console.log(`Efficiency Ratio (Higher = Council is cheaper/more efficient relative to output): ${ (summary.totalBaselineCost / summary.totalCouncilCost).toFixed(2) }`);

  return summary;
}

// CLI entry point
if (process.argv[1].endsWith('benchmarkRunner.ts')) {
    const endpoint = process.env.API_ENDPOINT || "http://localhost:3000/api/ask";
    runBenchmark(endpoint)
      .then(summary => {
          fs.writeFile('benchmark_results.json', JSON.stringify(summary, null, 2));
      })
      .catch(err => {
        console.error("Benchmark failed:", err);
        process.exit(1);
      });
}

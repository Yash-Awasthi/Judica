/**
 * Load test: Autocannon configuration for JUDICA API
 *
 * Target: 200 concurrent deliberations, < 2s p95 latency
 *
 * Usage:
 *   # Start the server first, then:
 *   npx tsx tests/load/deliberation.load.ts
 *
 *   # Or with custom settings:
 *   BASE_URL=http://localhost:3000 DURATION=30 CONNECTIONS=200 npx tsx tests/load/deliberation.load.ts
 */

import autocannon from "autocannon";
import jwt from "jsonwebtoken";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const DURATION = parseInt(process.env.DURATION || "30", 10);
const CONNECTIONS = parseInt(process.env.CONNECTIONS || "200", 10);
const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";

function makeToken(userId: number): string {
  return jwt.sign({ userId, username: `loaduser${userId}`, role: "member" }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

// Generate a pool of tokens for simulated concurrent users
const TOKEN_POOL = Array.from({ length: 50 }, (_, i) => makeToken(i + 1));

function randomToken(): string {
  return TOKEN_POOL[Math.floor(Math.random() * TOKEN_POOL.length)];
}

// ─── Scenarios ──────────────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  config: autocannon.Options;
  thresholds: {
    p95_ms: number;
    p99_ms: number;
    errors_pct: number;
  };
}

const scenarios: Scenario[] = [
  {
    name: "Health check (baseline)",
    config: {
      url: `${BASE_URL}/health`,
      connections: Math.min(CONNECTIONS, 50),
      duration: Math.min(DURATION, 10),
      method: "GET",
    },
    thresholds: { p95_ms: 100, p99_ms: 200, errors_pct: 0.1 },
  },
  {
    name: "Templates listing (unauthenticated)",
    config: {
      url: `${BASE_URL}/api/templates`,
      connections: CONNECTIONS,
      duration: DURATION,
      method: "GET",
    },
    thresholds: { p95_ms: 500, p99_ms: 1000, errors_pct: 0.1 },
  },
  {
    name: "History listing (authenticated)",
    config: {
      url: `${BASE_URL}/api/history`,
      connections: CONNECTIONS,
      duration: DURATION,
      method: "GET",
      setupClient(client: any) {
        client.setHeaders({
          authorization: `Bearer ${randomToken()}`,
        });
      },
    },
    thresholds: { p95_ms: 1000, p99_ms: 2000, errors_pct: 1 },
  },
  {
    name: "Deliberation (POST /api/ask)",
    config: {
      url: `${BASE_URL}/api/ask`,
      connections: CONNECTIONS,
      duration: DURATION,
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      setupClient(client: any) {
        client.setHeaders({
          authorization: `Bearer ${randomToken()}`,
        });
        client.setBody(
          JSON.stringify({
            question: "What are the pros and cons of microservices architecture?",
            model: "auto",
          }),
        );
      },
    },
    thresholds: { p95_ms: 2000, p99_ms: 5000, errors_pct: 5 },
  },
  {
    name: "Archetypes (optional auth, unauthenticated)",
    config: {
      url: `${BASE_URL}/api/archetypes`,
      connections: Math.min(CONNECTIONS, 100),
      duration: DURATION,
      method: "GET",
    },
    thresholds: { p95_ms: 500, p99_ms: 1000, errors_pct: 0.1 },
  },
];

// ─── Runner ─────────────────────────────────────────────────────────────────────

interface Result {
  name: string;
  requests_total: number;
  rps_avg: number;
  latency_p50: number;
  latency_p95: number;
  latency_p99: number;
  errors: number;
  timeouts: number;
  pass: boolean;
  failures: string[];
}

async function runScenario(scenario: Scenario): Promise<Result> {
  console.log(`\n🔄 Running: ${scenario.name}`);
  console.log(`   Connections: ${scenario.config.connections}, Duration: ${scenario.config.duration}s`);

  const result = await autocannon(scenario.config);

  const failures: string[] = [];
  const p95 = result.latency.p95;
  const p99 = result.latency.p99;
  const errorPct = result.errors / Math.max(result.requests.total, 1) * 100;

  if (p95 > scenario.thresholds.p95_ms) {
    failures.push(`p95 ${p95}ms > ${scenario.thresholds.p95_ms}ms`);
  }
  if (p99 > scenario.thresholds.p99_ms) {
    failures.push(`p99 ${p99}ms > ${scenario.thresholds.p99_ms}ms`);
  }
  if (errorPct > scenario.thresholds.errors_pct) {
    failures.push(`errors ${errorPct.toFixed(2)}% > ${scenario.thresholds.errors_pct}%`);
  }

  return {
    name: scenario.name,
    requests_total: result.requests.total,
    rps_avg: Math.round(result.requests.average),
    latency_p50: result.latency.p50,
    latency_p95: p95,
    latency_p99: p99,
    errors: result.errors,
    timeouts: result.timeouts,
    pass: failures.length === 0,
    failures,
  };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  JUDICA Load Test Suite");
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Connections: ${CONNECTIONS}, Duration: ${DURATION}s`);
  console.log("═══════════════════════════════════════════════════════════════");

  const selectedScenarios = process.argv[2]
    ? scenarios.filter((s) => s.name.toLowerCase().includes(process.argv[2].toLowerCase()))
    : scenarios;

  if (selectedScenarios.length === 0) {
    console.error("No matching scenarios found. Available:", scenarios.map((s) => s.name).join(", "));
    process.exit(1);
  }

  const results: Result[] = [];

  for (const scenario of selectedScenarios) {
    const result = await runScenario(scenario);
    results.push(result);
  }

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  RESULTS SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const nameWidth = 45;
  console.log(
    "Scenario".padEnd(nameWidth) +
    "Total".padStart(8) +
    "RPS".padStart(8) +
    "p50".padStart(8) +
    "p95".padStart(8) +
    "p99".padStart(8) +
    "  Status",
  );
  console.log("─".repeat(nameWidth + 48 + 8));

  for (const r of results) {
    const status = r.pass ? "✅ PASS" : "❌ FAIL";
    console.log(
      r.name.padEnd(nameWidth) +
      String(r.requests_total).padStart(8) +
      String(r.rps_avg).padStart(8) +
      `${r.latency_p50}ms`.padStart(8) +
      `${r.latency_p95}ms`.padStart(8) +
      `${r.latency_p99}ms`.padStart(8) +
      `  ${status}`,
    );
    if (r.failures.length > 0) {
      for (const f of r.failures) {
        console.log(`${"".padEnd(nameWidth)}  ↳ ${f}`);
      }
    }
  }

  const allPassed = results.every((r) => r.pass);
  console.log(
    `\n${allPassed ? "✅ All scenarios passed!" : "❌ Some scenarios failed — see above."}`,
  );

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Load test runner failed:", err);
  process.exit(2);
});

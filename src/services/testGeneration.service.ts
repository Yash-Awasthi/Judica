import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

/**
 * Test Generation Engine: uses council-style multi-perspective analysis
 * to identify edge cases and generate comprehensive test suites.
 */

export interface EdgeCase {
  category: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  suggestedBy: string;
}

export interface GeneratedTest {
  name: string;
  description: string;
  code: string;
  category: string;
  edgeCases: string[];
}

export interface TestGenerationResult {
  functionName: string;
  language: string;
  edgeCases: EdgeCase[];
  tests: GeneratedTest[];
  coverage: {
    happyPath: boolean;
    errorHandling: boolean;
    edgeCases: boolean;
    boundaryValues: boolean;
  };
}

// ─── Perspective-based Edge Case Discovery ──────────────────────────────────

const PERSPECTIVES = [
  {
    name: "boundary_analyst",
    prompt: "Identify boundary value edge cases: empty inputs, max values, zero, negative numbers, single items, very large inputs, unicode characters, null/undefined.",
  },
  {
    name: "error_hunter",
    prompt: "Identify error handling edge cases: network failures, timeouts, invalid types, malformed data, concurrent access, resource exhaustion, permission errors.",
  },
  {
    name: "security_auditor",
    prompt: "Identify security edge cases: injection attacks, XSS payloads, path traversal, auth bypass, overflow, race conditions, prototype pollution.",
  },
  {
    name: "usability_tester",
    prompt: "Identify usability edge cases: unexpected user behavior, rapid repeated actions, partial inputs, copy-paste artifacts, locale/timezone issues.",
  },
];

/**
 * Discover edge cases for a function using multi-perspective analysis.
 */
export async function discoverEdgeCases(
  code: string,
  functionName: string,
): Promise<EdgeCase[]> {
  const allEdgeCases: EdgeCase[] = [];

  // Run all perspectives in parallel (council-style)
  const results = await Promise.all(
    PERSPECTIVES.map(async (perspective) => {
      try {
        const result = await routeAndCollect({
          model: "auto",
          messages: [
            {
              role: "user",
              content: `${perspective.prompt}

Analyze this function and return a JSON array of edge cases:
[{"category": "boundary|error|security|usability", "description": "what to test", "severity": "critical|high|medium|low"}]

Function: ${functionName}
\`\`\`
${code.substring(0, 3000)}
\`\`\`

Return ONLY the JSON array.`,
            },
          ],
          temperature: 0,
        });

        const match = result.text.match(/\[[\s\S]*?\]/);
        if (match) {
          // P32-01: Safe JSON.parse with try-catch on LLM output
          let cases: Omit<EdgeCase, "suggestedBy">[];
          try {
            cases = JSON.parse(match[0]) as Omit<EdgeCase, "suggestedBy">[];
          } catch {
            return [];
          }
          if (!Array.isArray(cases)) return [];
          return cases.slice(0, 50).map((c) => ({ ...c, suggestedBy: perspective.name }));
        }
        return [];
      } catch (err) {
        logger.warn({ err, perspective: perspective.name }, "Edge case discovery failed for perspective");
        return [];
      }
    })
  );

  for (const cases of results) {
    allEdgeCases.push(...cases);
  }

  // Deduplicate by description similarity (simple substring match)
  const unique: EdgeCase[] = [];
  for (const ec of allEdgeCases) {
    const isDuplicate = unique.some((u) => {
      const existingLower = u.description.toLowerCase();
      const newLower = ec.description.toLowerCase();
      const prefix = Math.min(60, newLower.length);
      return existingLower.includes(newLower.substring(0, prefix))
        || newLower.includes(existingLower.substring(0, prefix));
    });
    if (!isDuplicate) {
      unique.push(ec);
    }
  }

  return unique;
}

/**
 * Generate test code from edge cases.
 */
export async function generateTests(
  code: string,
  functionName: string,
  edgeCases: EdgeCase[],
  language: string = "typescript",
  framework: string = "vitest",
): Promise<GeneratedTest[]> {
  const edgeCaseList = edgeCases
    .map((ec, i) => `${i + 1}. [${ec.severity}] ${ec.description} (${ec.category})`)
    .join("\n");

  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Generate comprehensive ${framework} tests for the function "${functionName}" in ${language}.

Cover these edge cases:
${edgeCaseList}

Also include:
- Happy path tests
- Error handling tests
- Boundary value tests

Function code:
\`\`\`${language}
${code.substring(0, 3000)}
\`\`\`

Return a JSON array of test objects:
[{
  "name": "test name",
  "description": "what it tests",
  "code": "it('...', () => { ... })",
  "category": "happy_path|error_handling|edge_case|boundary",
  "edgeCases": ["which edge cases this covers"]
}]

Return ONLY the JSON array.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\[[\s\S]*\]/);
    if (match) {
      // P32-02: Safe JSON.parse with try-catch + cap on LLM output
      try {
        const tests = JSON.parse(match[0]) as GeneratedTest[];
        return Array.isArray(tests) ? tests.slice(0, 100) : [];
      } catch {
        return [];
      }
    }
    return [];
  } catch (err) {
    logger.error({ err, functionName }, "Test generation failed");
    return [];
  }
}

/**
 * Full test generation pipeline: discover edge cases → generate tests.
 */
export async function generateTestSuite(
  code: string,
  functionName: string,
  language: string = "typescript",
  framework: string = "vitest",
): Promise<TestGenerationResult> {
  logger.info({ functionName, language, framework }, "Starting test suite generation");

  // Step 1: Discover edge cases (council-style multi-perspective)
  const edgeCases = await discoverEdgeCases(code, functionName);

  // Step 2: Generate tests from edge cases
  const tests = await generateTests(code, functionName, edgeCases, language, framework);

  // Step 3: Assess coverage
  const categories = new Set(tests.map((t) => t.category));
  const coverage = {
    happyPath: categories.has("happy_path"),
    errorHandling: categories.has("error_handling"),
    edgeCases: categories.has("edge_case"),
    boundaryValues: categories.has("boundary"),
  };

  logger.info(
    { functionName, edgeCaseCount: edgeCases.length, testCount: tests.length, coverage },
    "Test suite generation complete"
  );

  return {
    functionName,
    language,
    edgeCases,
    tests,
    coverage,
  };
}

/**
 * Format generated tests as a complete test file.
 */
export function formatTestFile(
  result: TestGenerationResult,
  importPath: string,
): string {
  const imports = result.language === "typescript"
    ? `import { describe, it, expect } from "vitest";\nimport { ${result.functionName} } from "${importPath}";`
    : `const { ${result.functionName} } = require("${importPath}");`;

  const testBlocks = result.tests
    .map((t) => `  // ${t.description}\n  ${t.code}`)
    .join("\n\n");

  return `${imports}

describe("${result.functionName}", () => {
${testBlocks}
});
`;
}

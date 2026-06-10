/**
 * PARSELTONGUE — POST /api/parseltongue/analyze
 *
 * Code-aware deliberation. Extracts code blocks, identifies language,
 * runs syntax analysis, then fires council members with code-specific
 * system prompts (code review, security audit, performance, correctness).
 *
 * SSE events:
 *   init      — { language, linesOfCode, complexity, roles: RoleInfo[] }
 *   response  — { roleId, roleLabel, text, latencyMs, tokens, status, error? }
 *   done      — { totalMs, language, issueCount, suggestionCount }
 *   error     — { message }
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyOptionalAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { createProvider } from "../lib/providers/factory.js";
import logger from "../lib/logger.js";
import { env } from "../config/env.js";

const log = logger.child({ route: "parseltongue" });

// ── Language detection ────────────────────────────────────────────────────────

const LANG_PATTERNS: Array<{ lang: string; patterns: RegExp[] }> = [
  { lang: "typescript", patterns: [/:\s*(string|number|boolean|void|any|unknown)\b/, /interface\s+\w+/, /type\s+\w+\s*=/, /\basync\s+function/, /import\s+type\s+/] },
  { lang: "javascript", patterns: [/\bconst\b/, /\blet\b/, /=>\s*\{/, /require\s*\(/, /module\.exports/] },
  { lang: "python",     patterns: [/def\s+\w+\s*\(/, /import\s+\w+/, /:\s*$/, /^\s*class\s+\w+/, /print\s*\(/m] },
  { lang: "rust",       patterns: [/fn\s+\w+\s*\(/, /let\s+mut\s+/, /impl\s+\w+/, /use\s+std::/, /->\s+\w+\s*\{/] },
  { lang: "go",         patterns: [/func\s+\w+\s*\(/, /\bpackage\s+\w+/, /\bgoroutine\b/, /\bchan\b/, /go\s+func/] },
  { lang: "java",       patterns: [/public\s+class\s+\w+/, /System\.out\.println/, /\bvoid\b/, /\bextends\b/, /\bimplements\b/] },
  { lang: "sql",        patterns: [/SELECT\s+.+FROM/i, /INSERT\s+INTO/i, /CREATE\s+TABLE/i, /WHERE\s+/i, /JOIN\s+/i] },
  { lang: "bash",       patterns: [/^#!/, /\$\{?\w+\}?/, /\becho\b/, /\bif\s+\[/, /\bfi\b/] },
  { lang: "css",        patterns: [/\{[\s\S]*?:[\s\S]*?\}/, /\.[a-zA-Z][\w-]*\s*\{/, /@media\s+/, /@keyframes\s+/] },
  { lang: "html",       patterns: [/<html[\s>]/, /<div[\s>]/, /<\/\w+>/, /<!DOCTYPE\s+html/i] },
];

function detectLanguage(code: string): string {
  for (const { lang, patterns } of LANG_PATTERNS) {
    const matches = patterns.filter((p) => p.test(code)).length;
    if (matches >= 2) return lang;
  }
  return "unknown";
}

function estimateComplexity(code: string): number {
  // Cyclomatic complexity proxy: count decision points
  const decisions = (code.match(/\b(if|else|for|while|switch|catch|&&|\|\||case|return)\b/g) ?? []).length;
  return Math.min(10, Math.max(1, Math.floor(decisions / 3)));
}

// ── Specialist roles ──────────────────────────────────────────────────────────

interface SpecialistRole {
  id:         string;
  label:      string;
  icon:       string;
  systemPrompt: (lang: string) => string;
}

const ROLES: SpecialistRole[] = [
  {
    id:    "reviewer",
    label: "Code Reviewer",
    icon:  "🔍",
    systemPrompt: (lang) =>
      `You are a senior ${lang} code reviewer. Review the provided code for: readability, naming conventions, code structure, DRY principles, and best practices. Be specific — reference exact lines or patterns. Output: numbered list of issues + concrete suggestions.`,
  },
  {
    id:    "security",
    label: "Security Auditor",
    icon:  "🛡",
    systemPrompt: (lang) =>
      `You are an application security expert specializing in ${lang}. Analyze the code for: injection vulnerabilities, authentication/authorization issues, insecure data handling, dependency risks, and OWASP Top 10. Rate severity (Critical/High/Medium/Low) for each finding. Be precise.`,
  },
  {
    id:    "performance",
    label: "Performance Engineer",
    icon:  "⚡",
    systemPrompt: (lang) =>
      `You are a ${lang} performance engineer. Analyze the code for: algorithmic complexity (O notation), unnecessary loops/allocations, caching opportunities, async/concurrency issues, and database query inefficiency if applicable. Quantify impact where possible.`,
  },
  {
    id:    "correctness",
    label: "Correctness Checker",
    icon:  "✓",
    systemPrompt: (lang) =>
      `You are a ${lang} expert focused on correctness. Identify: logic errors, edge case failures, off-by-one errors, null/undefined risks, type mismatches, and incorrect assumptions. Show concrete counter-examples for each bug found.`,
  },
  {
    id:    "architect",
    label: "Architect",
    icon:  "🏗",
    systemPrompt: (lang) =>
      `You are a software architect. Evaluate the ${lang} code for: separation of concerns, scalability, testability, coupling/cohesion, and design pattern applicability. Suggest architectural improvements with rationale.`,
  },
];

// ── Provider resolution ────────────────────────────────────────────────────────

function getBestProvider() {
  if (env.ANTHROPIC_API_KEY) return { name: "anthropic", model: "claude-3-5-sonnet-20241022", apiKey: env.ANTHROPIC_API_KEY };
  if (env.OPENAI_API_KEY)    return { name: "openai",    model: "gpt-4o",                     apiKey: env.OPENAI_API_KEY    };
  if (env.GROQ_API_KEY)      return {
    name: "groq", model: "llama-3.3-70b-versatile", apiKey: env.GROQ_API_KEY,
    baseUrl: "https://api.groq.com/openai/v1",
  };
  return null;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

const parseltonguePlugin: FastifyPluginAsync = async (fastify) => {

  fastify.get("/", async () => ({
    description: "PARSELTONGUE — code-aware deliberation with specialist reviewers",
    roles: ROLES.map((r) => ({ id: r.id, label: r.label, icon: r.icon })),
    supportedLanguages: LANG_PATTERNS.map((l) => l.lang),
  }));

  fastify.post<{ Body: { code: string; question?: string; language?: string; roles?: string[] } }>(
    "/analyze",
    { preHandler: fastifyOptionalAuth },
    async (request, reply) => {
      const { code, question, language: forcedLang, roles: requestedRoles } = request.body ?? {};

      if (!code?.trim()) {
        throw new AppError(400, "code is required", "MISSING_CODE");
      }

      const providerConfig = getBestProvider();
      if (!providerConfig) {
        throw new AppError(503, "No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.", "NO_PROVIDER");
      }

      const language   = forcedLang ?? detectLanguage(code);
      const linesOfCode = code.split("\n").length;
      const complexity  = estimateComplexity(code);

      // Filter requested roles (or use all)
      const activeRoles = requestedRoles?.length
        ? ROLES.filter((r) => requestedRoles.includes(r.id))
        : ROLES;

      if (activeRoles.length === 0) {
        throw new AppError(400, "No valid roles specified", "NO_ROLES");
      }

      // ── Open SSE ────────────────────────────────────────────────────────────

      reply.raw.writeHead(200, {
        "Content-Type":               "text/event-stream",
        "Cache-Control":              "no-cache",
        "Connection":                 "keep-alive",
        "X-Accel-Buffering":          "no",
        "Access-Control-Allow-Origin": "*",
      });

      const emit = (type: string, data: Record<string, unknown>) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }
      };

      const controller = new AbortController();
      request.raw.on("close", () => controller.abort());
      request.raw.on("error", () => controller.abort());

      try {
        emit("init", {
          language,
          linesOfCode,
          complexity,
          roles: activeRoles.map((r) => ({ id: r.id, label: r.label, icon: r.icon })),
        });

        const userContent = question?.trim()
          ? `Code:\n\`\`\`${language}\n${code}\n\`\`\`\n\nSpecific question: ${question}`
          : `Code:\n\`\`\`${language}\n${code}\n\`\`\``;

        const startAll   = Date.now();
        let issueCount   = 0;
        let suggestionCount = 0;

        // Fire all specialist roles in parallel
        const jobs = activeRoles.map(async (role) => {
          const startMs = Date.now();
          try {
            const prov = createProvider(providerConfig);
            const resp = await prov.chat(
              [
                { role: "system", content: role.systemPrompt(language) },
                { role: "user",   content: userContent                   },
              ],
              { signal: controller.signal }
            );

            const latencyMs = Date.now() - startMs;
            const text      = resp.content ?? "";
            const tokens    = resp.usage?.totalTokens ?? Math.ceil(text.length / 4);

            // Rough issue/suggestion count
            issueCount      += (text.match(/\d+\.\s+/g) ?? []).length;
            suggestionCount += (text.match(/\b(suggest|recommend|consider|use|replace)\b/gi) ?? []).length;

            emit("response", {
              roleId:    role.id,
              roleLabel: role.label,
              roleIcon:  role.icon,
              text,
              latencyMs,
              tokens,
              status:    "done",
            });
          } catch (err) {
            const latencyMs = Date.now() - startMs;
            const errMsg    = err instanceof Error ? err.message : "Analysis failed";
            log.warn({ err, roleId: role.id }, "Parseltongue role failed");
            emit("response", {
              roleId:    role.id,
              roleLabel: role.label,
              roleIcon:  role.icon,
              text:      "",
              latencyMs,
              tokens:    0,
              status:    "error",
              error:     errMsg,
            });
          }
        });

        await Promise.allSettled(jobs);

        emit("done", {
          totalMs:         Date.now() - startAll,
          language,
          linesOfCode,
          complexity,
          issueCount,
          suggestionCount,
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : "PARSELTONGUE analysis failed";
        log.error({ err }, msg);
        emit("error", { message: msg });
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    }
  );
};

export default parseltonguePlugin;

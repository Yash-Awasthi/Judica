/**
 * EnIGMA Cybersecurity Mode — Phase 4.18
 *
 * AI-assisted CTF (Capture The Flag) and security research toolkit.
 * Provides:
 * - CVE lookup and vulnerability analysis
 * - CTF challenge assistant (forensics, crypto, web, pwn hints)
 * - Security report generation
 * - Safe pattern analysis (static, no exploitation)
 *
 * Inspired by:
 * - EnIGMA (enigma-dev/enigma) — cybersecurity AI assistant
 * - AI CTF solvers (HackTheBox AI, CTFd integrations)
 * - Security-focused LLM prompting
 *
 * IMPORTANT: This module provides DEFENSIVE security tooling only.
 * No exploitation payloads, no attack tool generation.
 * Use for CTF challenges, educational purposes, and authorized pentesting analysis.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";

// ─── Provider ─────────────────────────────────────────────────────────────────

const secProvider = {
  name: "openai",
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? "",
  model: "gpt-4o",
  systemPrompt: `You are an expert cybersecurity analyst assisting with:
- CTF (Capture The Flag) challenges (educational only)
- Vulnerability research and analysis (CVE lookup, patch analysis)
- Security report writing
- Defensive security recommendations
You provide educational and defensive security guidance only.
You do NOT generate exploit code, working payloads, or attack tools.`,
};

// ─── CTF categories ───────────────────────────────────────────────────────────

const CTF_CATEGORIES = [
  "web",
  "forensics",
  "crypto",
  "reverse_engineering",
  "pwn",
  "osint",
  "misc",
  "steganography",
  "network",
] as const;
type CTFCategory = typeof CTF_CATEGORIES[number];

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ctfSchema = z.object({
  title:       z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category:    z.enum(CTF_CATEGORIES),
  /** Hints already given by the platform */
  hints:       z.array(z.string()).max(5).optional(),
  /** Files/data attached (as text dump) */
  attachments: z.string().max(8000).optional(),
  /** Level of help: nudge | hint | walkthrough */
  helpLevel:   z.enum(["nudge", "hint", "walkthrough"]).optional(),
});

const cveSchema = z.object({
  /** CVE ID (e.g. CVE-2024-12345) or free-text vulnerability description */
  query: z.string().min(1).max(500),
  /** Include remediation advice */
  includeRemediation: z.boolean().optional(),
});

const codeAuditSchema = z.object({
  code:     z.string().min(1).max(20000),
  language: z.string().min(1).max(50),
  /** Focus areas: sql_injection, xss, auth, crypto, etc. */
  focus:    z.array(z.string()).max(10).optional(),
});

const reportSchema = z.object({
  /** Type of report */
  type:      z.enum(["pentest_summary", "vulnerability_report", "incident_report", "ctf_writeup"]),
  /** Raw findings/notes */
  findings:  z.string().min(1).max(10000),
  /** Target system name (for context only) */
  target:    z.string().max(200).optional(),
  /** Severity: critical | high | medium | low */
  severity:  z.enum(["critical", "high", "medium", "low"]).optional(),
});

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildCTFPrompt(task: z.infer<typeof ctfSchema>): string {
  const levelInstructions = {
    nudge: "Give a very subtle nudge — one word or concept to think about. Do NOT reveal the solution.",
    hint: "Give a helpful hint — point to the right approach without revealing the full solution.",
    walkthrough: "Provide a step-by-step educational walkthrough explaining the concepts and solution.",
  };

  return `CTF Challenge Analysis

Category: ${task.category}
Title: ${task.title}
Description:
${task.description}
${task.hints?.length ? `\nPlatform hints:\n${task.hints.map((h, i) => `${i + 1}. ${h}`).join("\n")}` : ""}
${task.attachments ? `\nAttachment content:\n${task.attachments}` : ""}

Help Level: ${task.helpLevel ?? "hint"}
${levelInstructions[task.helpLevel ?? "hint"]}

Format your response as:
- Category Analysis: what type of challenge this is
- Key Concepts: relevant technical concepts
- Approach: ${task.helpLevel === "walkthrough" ? "detailed steps" : "direction to explore"}
- Tools: relevant tools to use`;
}

function buildCVEPrompt(query: string, includeRemediation: boolean): string {
  return `Analyze this security vulnerability or CVE:

Query: ${query}

Provide:
1. Vulnerability Description: what it is and how it works (conceptually, no PoC)
2. CVSS Score estimate (if CVE ID given)
3. Affected Systems/Versions
4. Impact: what an attacker could achieve if exploited
5. Detection: how to detect if you're vulnerable
${includeRemediation ? "6. Remediation: patches, mitigations, workarounds\n7. References: CVE links, advisories" : ""}

Focus on defensive understanding. Do not provide exploitation steps.`;
}

function buildAuditPrompt(code: string, language: string, focus: string[]): string {
  const focusAreas = focus.length > 0 ? focus.join(", ") : "all common vulnerabilities";

  return `Perform a security code review.

Language: ${language}
Focus areas: ${focusAreas}

Code:
\`\`\`${language}
${code.slice(0, 15000)}
\`\`\`

For each vulnerability found:
- Line number (approximate)
- Vulnerability type (OWASP category if applicable)
- Severity: Critical/High/Medium/Low/Info
- Description: what the issue is
- Recommendation: how to fix it (code example if helpful)

Format as structured list. If no vulnerabilities found, say so.`;
}

function buildReportPrompt(type: string, findings: string, target: string, severity: string): string {
  const templates: Record<string, string> = {
    pentest_summary: "Write a professional penetration testing executive summary",
    vulnerability_report: "Write a structured vulnerability disclosure report",
    incident_report: "Write a security incident response report",
    ctf_writeup: "Write a CTF challenge writeup for educational purposes",
  };

  return `${templates[type] ?? "Write a security report"}.

Target: ${target || "unnamed system"}
Overall Severity: ${severity || "medium"}

Raw Findings:
${findings}

Format as a professional security report with:
- Executive Summary (2-3 paragraphs)
- Technical Details
- Risk Assessment
- Recommendations
- Conclusion`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function securityPlugin(app: FastifyInstance) {

  /**
   * POST /security/ctf
   * Get help with a CTF challenge (educational, no exploit code).
   */
  app.post("/security/ctf", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = ctfSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const prompt = buildCTFPrompt(parsed.data);
    const response = await askProvider(secProvider, [{ role: "user", content: prompt }]);

    return {
      success: true,
      category: parsed.data.category,
      helpLevel: parsed.data.helpLevel ?? "hint",
      analysis: response.text,
    };
  });

  /**
   * POST /security/cve
   * Analyze a CVE or vulnerability description.
   */
  app.post("/security/cve", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = cveSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { query, includeRemediation = true } = parsed.data;
    const prompt = buildCVEPrompt(query, includeRemediation);
    const response = await askProvider(secProvider, [{ role: "user", content: prompt }]);

    return { success: true, query, analysis: response.text };
  });

  /**
   * POST /security/audit
   * Perform a static security code review.
   */
  app.post("/security/audit", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = codeAuditSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { code, language, focus = [] } = parsed.data;
    const prompt = buildAuditPrompt(code, language, focus);
    const response = await askProvider(secProvider, [{ role: "user", content: prompt }]);

    return {
      success: true,
      language,
      linesAnalyzed: code.split("\n").length,
      findings: response.text,
    };
  });

  /**
   * POST /security/report
   * Generate a professional security report from raw findings.
   */
  app.post("/security/report", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { type, findings, target = "", severity = "medium" } = parsed.data;
    const prompt = buildReportPrompt(type, findings, target, severity);
    const response = await askProvider(secProvider, [{ role: "user", content: prompt }]);

    return { success: true, type, report: response.text };
  });

  /**
   * GET /security/categories
   * List CTF categories and OWASP top 10.
   */
  app.get("/security/categories", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return {
      success: true,
      ctfCategories: CTF_CATEGORIES,
      owaspTop10: [
        "A01: Broken Access Control",
        "A02: Cryptographic Failures",
        "A03: Injection",
        "A04: Insecure Design",
        "A05: Security Misconfiguration",
        "A06: Vulnerable and Outdated Components",
        "A07: Identification and Authentication Failures",
        "A08: Software and Data Integrity Failures",
        "A09: Security Logging and Monitoring Failures",
        "A10: Server-Side Request Forgery",
      ],
      reportTypes: ["pentest_summary", "vulnerability_report", "incident_report", "ctf_writeup"],
    };
  });
}

/**
 * Quality & Honesty — Phase 7.1: Citation-First Architecture
 *
 * Inspired by:
 * - Perplexity — inline citation pattern where every claim links to a source.
 * - ALCE (princeton-nlp/ALCE, MIT, Princeton) — benchmark and methods for
 *   citation-based LLM generation.
 *
 * Every factual claim in a council response must carry a [source] marker.
 * Unsourced claims are flagged as [unverified].
 * Synthesis step cannot promote an unsourced claim to a consensus position.
 *
 * Routes:
 * - POST /citations/check — analyze a text and flag unsourced claims
 * - POST /citations/annotate — add [source] markers to a response
 * - POST /citations/verify — cross-check claims against provided sources
 * - GET /citations/stats — per-user citation coverage stats
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CitationAnalysis {
  id: string;
  userId: number;
  inputText: string;
  claims: AnnotatedClaim[];
  citationCoverage: number; // 0–1
  unsourcedCount: number;
  verifiedCount: number;
  createdAt: Date;
}

interface AnnotatedClaim {
  claim: string;
  status: "cited" | "unverified" | "inferred" | "common_knowledge";
  source?: string;
  confidence: number; // 0–1
}

const analysisStore = new Map<string, CitationAnalysis>();
let analysisCounter = 1;

function analysisId(): string {
  return `cite_${Date.now()}_${analysisCounter++}`;
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = (systemPrompt: string) => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
  systemPrompt,
});

const CITATION_ANALYST_PROMPT = `You are a rigorous citation analyst. Your job is to:
1. Identify every distinct factual claim in a text
2. Classify each as: cited (has a source), unverified (makes a claim without evidence), inferred (reasonable deduction), or common_knowledge
3. Flag unverified claims that should require sourcing

Return clean JSON analysis only.`;

// ─── Schema ───────────────────────────────────────────────────────────────────

const checkCitationsSchema = z.object({
  text:    z.string().min(1).max(10000),
  sources: z.array(z.string().max(2000)).max(10).optional(),
});

const annotateSchema = z.object({
  text:    z.string().min(1).max(10000),
  sources: z.array(z.object({
    id:      z.string().max(50),
    title:   z.string().max(200),
    content: z.string().max(1000),
    url:     z.string().url().optional(),
  })).max(10).optional(),
});

const verifySchema = z.object({
  claim:   z.string().min(1).max(1000),
  sources: z.array(z.string().max(2000)).min(1).max(5),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function citationPlugin(app: FastifyInstance) {

  /**
   * POST /citations/check
   * Analyze text and identify unsourced factual claims.
   */
  app.post("/citations/check", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = checkCitationsSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { text, sources = [] } = parsed.data;

    const sourcesContext = sources.length > 0
      ? `\n\nProvided sources:\n${sources.map((s, i) => `[${i + 1}] ${s.slice(0, 300)}`).join("\n")}`
      : "";

    const prompt = `Analyze this text for factual claims and their citation status.
${sourcesContext}

TEXT TO ANALYZE:
${text.slice(0, 5000)}

Return JSON:
{
  "claims": [
    {
      "claim": "exact quote or paraphrase of the claim",
      "status": "cited|unverified|inferred|common_knowledge",
      "source": "source reference if cited, or null",
      "confidence": 0.0-1.0
    }
  ],
  "summary": "brief overall assessment",
  "citationCoverage": 0.0-1.0
}`;

    const response = await askProvider(llmProvider(CITATION_ANALYST_PROMPT), [
      { role: "user", content: prompt },
    ]);
    const responseText = typeof response === "string" ? response : (response as any)?.content ?? "";

    let claims: AnnotatedClaim[] = [];
    let citationCoverage = 0;
    let summary = "";

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        claims = parsed.claims ?? [];
        citationCoverage = parsed.citationCoverage ?? 0;
        summary = parsed.summary ?? "";
      }
    } catch { /* use defaults */ }

    const unsourcedCount = claims.filter(c => c.status === "unverified").length;
    const verifiedCount = claims.filter(c => c.status === "cited").length;

    const id = analysisId();
    const analysis: CitationAnalysis = {
      id, userId, inputText: text.slice(0, 500),
      claims, citationCoverage, unsourcedCount, verifiedCount,
      createdAt: new Date(),
    };
    analysisStore.set(id, analysis);

    return reply.send({
      success: true,
      analysisId: id,
      claims,
      summary,
      citationCoverage,
      unsourcedCount,
      verifiedCount,
      totalClaims: claims.length,
      verdict: unsourcedCount === 0 ? "fully_cited" : unsourcedCount <= 2 ? "mostly_cited" : "needs_sources",
    });
  });

  /**
   * POST /citations/annotate
   * Add [source:N] markers to text based on provided sources.
   */
  app.post("/citations/annotate", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = annotateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { text, sources = [] } = parsed.data;

    const sourcesContext = sources.length > 0
      ? sources.map((s, i) => `[${i + 1}] ${s.title}: ${s.content.slice(0, 200)}`).join("\n")
      : "No sources provided.";

    const prompt = `Annotate the following text by inserting [source:N] markers after claims that are supported by the provided sources.
For claims with no source, append [unverified].
For common knowledge claims, append [common_knowledge].
Preserve the original text exactly, only adding markers.

SOURCES:
${sourcesContext}

TEXT:
${text.slice(0, 5000)}

Return the annotated text only, no explanation.`;

    const response = await askProvider(
      llmProvider("You are a precise text annotator. Add citation markers without altering original text."),
      [{ role: "user", content: prompt }],
    );
    const annotatedText = typeof response === "string" ? response : (response as any)?.content ?? text;

    const unverifiedCount = (annotatedText.match(/\[unverified\]/g) ?? []).length;
    const citedCount = (annotatedText.match(/\[source:\d+\]/g) ?? []).length;

    return reply.send({
      success: true,
      originalText: text,
      annotatedText,
      sources: sources.map(s => ({ id: s.id, title: s.title, url: s.url })),
      stats: { citedCount, unverifiedCount },
    });
  });

  /**
   * POST /citations/verify
   * Cross-check a single claim against provided source texts.
   */
  app.post("/citations/verify", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { claim, sources } = parsed.data;

    const prompt = `Verify this claim against the provided sources.

CLAIM: "${claim}"

SOURCES:
${sources.map((s, i) => `[${i + 1}] ${s.slice(0, 500)}`).join("\n\n")}

Return JSON:
{
  "verdict": "supported|contradicted|partial|not_found",
  "confidence": 0.0-1.0,
  "supportingSource": 1 or null,
  "explanation": "brief explanation"
}`;

    const response = await askProvider(
      llmProvider("You are a fact-checker. Verify claims against sources objectively."),
      [{ role: "user", content: prompt }],
    );
    const responseText = typeof response === "string" ? response : (response as any)?.content ?? "";

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return reply.send({ success: true, claim, ...JSON.parse(jsonMatch[0]) });
      }
    } catch { /* fall through */ }

    return reply.send({ success: true, claim, verdict: "not_found", confidence: 0, explanation: responseText });
  });

  /**
   * POST /citations/score-response
   * Score a council response for citation quality.
   * Returns a citation quality score (0-100) and flags for the council.
   */
  app.post("/citations/score-response", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { response: responseText, sources = [] } = req.body as {
      response?: string;
      sources?: string[];
    };

    if (!responseText) return reply.status(400).send({ error: "response required" });

    const prompt = `Score this AI response for citation quality on a scale of 0-100.

RESPONSE:
${responseText.slice(0, 4000)}

SOURCES PROVIDED: ${sources.length}

Scoring criteria:
- 90-100: All factual claims cited or verifiable
- 70-89: Most claims cited, few unverified
- 50-69: Mixed — some citations, some gaps
- 30-49: Many unverified claims
- 0-29: Almost no citations on factual claims

Return JSON:
{
  "score": 0-100,
  "grade": "A|B|C|D|F",
  "unsourcedClaims": ["list of claims needing sources"],
  "recommendation": "brief action to improve score"
}`;

    const response = await askProvider(llmProvider(CITATION_ANALYST_PROMPT), [
      { role: "user", content: prompt },
    ]);
    const text = typeof response === "string" ? response : (response as any)?.content ?? "";

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return reply.send({ success: true, ...JSON.parse(jsonMatch[0]) });
      }
    } catch { /* fall through */ }

    return reply.send({ success: true, score: 50, grade: "C", unsourcedClaims: [], recommendation: text });
  });

  /**
   * GET /citations/history
   * List recent citation analyses.
   */
  app.get("/citations/history", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const history = [...analysisStore.values()]
      .filter(a => a.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
      .map(({ inputText: text, ...a }) => ({
        ...a,
        textPreview: text.slice(0, 100) + "...",
      }));

    return reply.send({ success: true, history, count: history.length });
  });
}

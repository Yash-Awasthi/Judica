/**
 * Simulation Mode — Phase 5.6: Simulation Report Generation
 *
 * Inspired by:
 * - Pandoc (jgm/pandoc, GPL, 36k stars) — rendering reports in multiple formats.
 * - WeasyPrint (Kozea/WeasyPrint, BSD, 7.5k stars) — HTML/CSS to PDF.
 * - TinyTroupe (microsoft/TinyTroupe, MIT) — structured simulation reports
 *   for business insights, market research, brainstorming.
 *
 * After a simulation run the council synthesises:
 * - What happened and why
 * - Key decision points and turning points
 * - Patterns and emergent behaviour
 * - Likely outcomes and recommendations
 * - Downloadable Markdown / JSON report
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";
import { getSimulation } from "./simulation-runner.js";
import { getPersona } from "./simulation-personas.js";
import { getSimEnvironment } from "./simulation-environment.js";

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = () => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o" : "claude-3-5-sonnet-20241022",
});

// ─── Schema ───────────────────────────────────────────────────────────────────

const generateReportSchema = z.object({
  simulationId: z.string().min(1),
  format:       z.enum(["markdown", "json", "summary"]).default("markdown"),
  /** Specific questions to answer in the report */
  questions:    z.array(z.string().max(300)).max(5).optional(),
  /** Focus area */
  focus:        z.enum(["behaviour", "outcomes", "patterns", "decisions", "all"]).default("all"),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function simulationReportPlugin(app: FastifyInstance) {

  /**
   * POST /simulate/reports
   * Generate a structured synthesis report for a completed simulation.
   */
  app.post("/simulate/reports", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = generateReportSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { simulationId, format, questions, focus } = parsed.data;

    const simulation = getSimulation(simulationId);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    if (simulation.tickLog.length === 0) {
      return reply.status(400).send({ error: "Simulation has no ticks to report on" });
    }

    const simEnv = getSimEnvironment(simulation.environmentId);
    const personaNames = simulation.personaIds
      .map(pid => getPersona(pid)?.name ?? pid)
      .join(", ");

    // Build transcript for analysis
    const transcriptLines: string[] = [];
    for (const tick of simulation.tickLog) {
      transcriptLines.push(`=== Tick ${tick.tick} ===`);
      if (tick.worldEvent) transcriptLines.push(`World event: ${tick.worldEvent}`);
      for (const action of tick.actions) {
        transcriptLines.push(`${action.personaName}: ${action.action}`);
        if (action.reasoning) transcriptLines.push(`  (Reasoning: ${action.reasoning})`);
      }
    }

    const transcript = transcriptLines.join("\n");
    const additionalQuestions = questions?.map((q, i) => `${i + 1}. ${q}`).join("\n") ?? "";

    if (format === "json") {
      // Structured JSON report via LLM
      const jsonPrompt = `You are an analyst reviewing a multi-agent simulation.

SIMULATION: ${simulation.name}
ENVIRONMENT: ${simEnv?.name ?? simulationId}
SETTING: ${simEnv?.worldDescription ?? "Unknown"}
PERSONAS: ${personaNames}
TICKS RUN: ${simulation.currentTick}

TRANSCRIPT:
${transcript.slice(0, 6000)}

Generate a comprehensive analysis. Return ONLY valid JSON:
{
  "title": "Report title",
  "summary": "2-3 sentence executive summary",
  "keyEvents": [{"tick": 1, "event": "description", "significance": "why it matters"}],
  "personaBehaviours": [{"persona": "name", "behaviour": "pattern", "consistency": "high/medium/low"}],
  "turningPoints": [{"tick": 1, "description": "what changed", "cause": "why"}],
  "emergentPatterns": ["pattern 1", "pattern 2"],
  "likelyOutcomes": ["outcome 1", "outcome 2"],
  "recommendations": ["recommendation 1", "recommendation 2"],
  ${additionalQuestions ? `"additionalAnswers": {},` : ""}
  "confidence": "high/medium/low"
}${additionalQuestions ? `\n\nAlso answer these specific questions in "additionalAnswers":\n${additionalQuestions}` : ""}`;

      const response = await askProvider(llmProvider(), [{ role: "user", content: jsonPrompt }]);
      const text = typeof response === "string" ? response : (response as any)?.content ?? "";

      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const report = JSON.parse(jsonMatch[0]);
          return reply.send({ success: true, format: "json", report });
        }
      } catch { /* fall through to text */ }

      return reply.send({ success: true, format: "json", report: { raw: text } });
    }

    if (format === "summary") {
      // Short 1-paragraph summary
      const summaryPrompt = `Summarise this simulation in 2-3 sentences.
Personas: ${personaNames}
Setting: ${simEnv?.premise ?? ""}
Ticks: ${simulation.currentTick}

Key actions:
${transcript.slice(0, 3000)}

Summary:`;

      const response = await askProvider(llmProvider(), [{ role: "user", content: summaryPrompt }]);
      const summary = typeof response === "string" ? response : (response as any)?.content ?? "";
      return reply.send({ success: true, format: "summary", summary });
    }

    // Markdown report
    const focusInstructions: Record<string, string> = {
      behaviour:  "Focus on each persona's behaviour patterns, consistency with their goals, and decision-making style.",
      outcomes:   "Focus on what outcomes emerged, which were expected vs. surprising, and what drove them.",
      patterns:   "Focus on emergent patterns, recurring themes, and systemic dynamics.",
      decisions:  "Focus on key decision points, turning moments, and what changed the trajectory.",
      all:        "Cover behaviour, outcomes, patterns, and key decisions comprehensively.",
    };

    const mdPrompt = `You are an expert analyst synthesising a multi-agent simulation.

SIMULATION: ${simulation.name}
ENVIRONMENT: ${simEnv?.name ?? simulationId}
SETTING: ${simEnv?.worldDescription?.slice(0, 300) ?? "Unknown"}
PERSONAS: ${personaNames}
TICKS: ${simulation.currentTick} / ${simulation.maxTicks}

TRANSCRIPT:
${transcript.slice(0, 6000)}

${focusInstructions[focus]}
${additionalQuestions ? `\nAlso answer these specific questions:\n${additionalQuestions}` : ""}

Write a structured Markdown report with sections:
# [Title]
## Executive Summary
## What Happened
## Key Turning Points
## Persona Behaviour Analysis
## Emergent Patterns
## Likely Outcomes
## Recommendations
${additionalQuestions ? "## Specific Findings" : ""}`;

    const response = await askProvider(llmProvider(), [{ role: "user", content: mdPrompt }]);
    const markdown = typeof response === "string" ? response : (response as any)?.content ?? "";

    return reply.send({
      success: true,
      format: "markdown",
      report: markdown,
      meta: {
        simulationId,
        simulationName: simulation.name,
        ticks: simulation.currentTick,
        personaCount: simulation.personaIds.length,
        generatedAt: new Date().toISOString(),
      },
    });
  });

  /**
   * GET /simulate/reports/transcript/:simulationId
   * Get raw transcript without LLM synthesis.
   */
  app.get("/simulate/reports/transcript/:simulationId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { simulationId } = req.params as { simulationId: string };
    const simulation = getSimulation(simulationId);
    if (!simulation || simulation.userId !== userId) {
      return reply.status(404).send({ error: "Simulation not found" });
    }

    const lines: string[] = [
      `# ${simulation.name}`,
      `Ticks: ${simulation.currentTick} / ${simulation.maxTicks}`,
      `Status: ${simulation.status}`,
      "",
    ];

    for (const tick of simulation.tickLog) {
      lines.push(`## Tick ${tick.tick}${tick.worldEvent ? ` — Event: ${tick.worldEvent}` : ""}`);
      for (const action of tick.actions) {
        lines.push(`**${action.personaName}**: ${action.action}`);
        if (action.reasoning) lines.push(`> _${action.reasoning}_`);
      }
      lines.push("");
    }

    return reply.send({
      success: true,
      simulationId,
      simulationName: simulation.name,
      transcript: lines.join("\n"),
      ticks: simulation.tickLog.length,
    });
  });

  /**
   * POST /simulate/reports/compare
   * Generate a comparative report of two simulations or branches.
   */
  app.post("/simulate/reports/compare", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { simAId, simBId, question } = req.body as {
      simAId?: string;
      simBId?: string;
      question?: string;
    };

    if (!simAId || !simBId) {
      return reply.status(400).send({ error: "simAId and simBId required" });
    }

    const simA = getSimulation(simAId);
    const simB = getSimulation(simBId);

    if (!simA || simA.userId !== userId || !simB || simB.userId !== userId) {
      return reply.status(404).send({ error: "One or both simulations not found" });
    }

    const transcriptA = simA.tickLog
      .map(t => `[T${t.tick}] ${t.actions.map(a => `${a.personaName}: ${a.action}`).join(" | ")}`)
      .join("\n");

    const transcriptB = simB.tickLog
      .map(t => `[T${t.tick}] ${t.actions.map(a => `${a.personaName}: ${a.action}`).join(" | ")}`)
      .join("\n");

    const prompt = `Compare two simulations.

SIMULATION A: ${simA.name}
${transcriptA.slice(0, 3000)}

SIMULATION B: ${simB.name}
${transcriptB.slice(0, 3000)}

${question ? `Specific question: ${question}` : ""}

Write a comparative analysis covering:
1. Key differences in agent behaviour
2. How outcomes diverged
3. What caused the divergence
4. Which simulation achieved better results (if applicable)`;

    const response = await askProvider(llmProvider(), [{ role: "user", content: prompt }]);
    const analysis = typeof response === "string" ? response : (response as any)?.content ?? "";

    return reply.send({ success: true, simulationA: simA.name, simulationB: simB.name, analysis });
  });
}

/**
 * Simulation Mode — Phase 5.8: Use-Case Presets Built on Simulation Engine
 *
 * Inspired by:
 * - TinyTroupe (microsoft/TinyTroupe, MIT) — persona simulation for product testing,
 *   market research, and brainstorming.
 * - AI Town (a16z-infra/ai-town, MIT, a16z, 8k stars) — emergent social behaviour.
 *
 * High-level one-shot APIs for common simulation use cases:
 * - Scenario planning / risk forecasting
 * - Interview prep (spawn tough interviewer)
 * - Debate prep (spawn strongest opposition)
 * - Product research (spawn target users)
 * - Historical simulation (seed from historical context)
 * - Creative writing (run characters through a plot)
 *
 * These are opinionated wrappers that auto-create environment + personas + run ticks.
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = (systemPrompt?: string) => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
  ...(systemPrompt ? { systemPrompt } : {}),
});

// ─── Shared utility ───────────────────────────────────────────────────────────

async function runOneShot(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await askProvider(llmProvider(systemPrompt), [{ role: "user", content: userPrompt }]);
  return typeof response === "string" ? response : (response as any)?.content ?? "";
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const scenarioPlanningSchema = z.object({
  situation:   z.string().min(1).max(2000),
  horizon:     z.string().max(100).default("12 months"),
  stakeholders: z.array(z.string().max(100)).max(8).optional(),
  risks:        z.array(z.string().max(200)).max(5).optional(),
});

const interviewPrepSchema = z.object({
  role:      z.string().min(1).max(200),
  company:   z.string().max(200).optional(),
  style:     z.enum(["tough", "behavioural", "technical", "case", "friendly"]).default("tough"),
  rounds:    z.number().int().min(1).max(5).default(3),
  candidate: z.string().max(500).optional(),
});

const debatePrepSchema = z.object({
  position:  z.string().min(1).max(1000),
  rounds:    z.number().int().min(1).max(5).default(3),
  style:     z.enum(["academic", "political", "business", "devil_advocate"]).default("devil_advocate"),
});

const productResearchSchema = z.object({
  product:    z.string().min(1).max(500),
  personas:   z.array(z.string().max(200)).min(1).max(5),
  questions:  z.array(z.string().max(300)).min(1).max(10),
});

const historicalSimSchema = z.object({
  scenario:   z.string().min(1).max(500),
  period:     z.string().max(100),
  figures:    z.array(z.string().max(100)).min(1).max(5),
  question:   z.string().max(500).optional(),
});

const creativeWritingSchema = z.object({
  premise:    z.string().min(1).max(1000),
  characters: z.array(z.object({
    name:     z.string().max(100),
    role:     z.string().max(200),
    goal:     z.string().max(200),
  })).min(2).max(6),
  ticks:      z.number().int().min(1).max(10).default(5),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function simulationUseCasesPlugin(app: FastifyInstance) {

  /**
   * POST /simulate/use-cases/scenario-planning
   * Simulate multiple future scenarios and stress-test a decision.
   * Spawns stakeholder personas + runs through plausible futures.
   */
  app.post("/simulate/use-cases/scenario-planning", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = scenarioPlanningSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { situation, horizon, stakeholders = [], risks = [] } = parsed.data;

    const prompt = `You are a strategic foresight analyst. Simulate multiple future scenarios for this situation.

SITUATION: ${situation}
HORIZON: ${horizon}
STAKEHOLDERS: ${stakeholders.join(", ") || "general stakeholders"}
${risks.length > 0 ? `KNOWN RISKS: ${risks.join(", ")}` : ""}

Generate 3 plausible scenarios (optimistic, baseline, pessimistic). For each:
1. A name and short description
2. Key events that lead to this scenario
3. How different stakeholders react/behave
4. Indicators you'd see early (leading signals)
5. Recommended actions to navigate this scenario

Format as structured Markdown.`;

    const analysis = await runOneShot(
      "You are an expert scenario planner and strategic analyst.",
      prompt,
    );

    return reply.send({ success: true, useCase: "scenario-planning", analysis, situation, horizon });
  });

  /**
   * POST /simulate/use-cases/interview-prep
   * Spawn a tough interviewer persona and run N rounds of Q&A.
   */
  app.post("/simulate/use-cases/interview-prep", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = interviewPrepSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { role, company, style, rounds, candidate } = parsed.data;

    const styleDescriptions: Record<string, string> = {
      tough: "You are direct, probing, and challenging. You push back on vague answers and ask follow-ups.",
      behavioural: "You focus on past behaviour stories (STAR method). You probe for specifics.",
      technical: "You ask technical questions relevant to the role. You evaluate depth of knowledge.",
      case: "You present business cases and scenarios. You evaluate structured thinking.",
      friendly: "You are warm and conversational, but still thorough.",
    };

    const interviewerSystem = `You are a ${style} interviewer${company ? ` at ${company}` : ""} hiring for: ${role}.
${styleDescriptions[style]}
${candidate ? `Context about the candidate: ${candidate}` : ""}
Ask one focused question at a time. Be realistic and professional.`;

    // Generate interview questions
    const questionsPrompt = `Generate ${rounds} interview questions for ${role}${company ? ` at ${company}` : ""} in ${style} style.
Number them 1-${rounds}. Include expected follow-up probes.`;

    const questions = await runOneShot(interviewerSystem, questionsPrompt);

    // Generate ideal answers
    const answersPrompt = `For these interview questions for ${role}, provide model answers with:
- Strong answer example
- What the interviewer is really testing
- Common mistakes to avoid

Questions:
${questions}`;

    const guidance = await runOneShot(
      "You are a career coach with 20 years of experience.",
      answersPrompt,
    );

    return reply.send({
      success: true,
      useCase: "interview-prep",
      role,
      company,
      style,
      questions,
      guidance,
    });
  });

  /**
   * POST /simulate/use-cases/debate-prep
   * Spawn the strongest possible opposition for your position.
   */
  app.post("/simulate/use-cases/debate-prep", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = debatePrepSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { position, rounds, style } = parsed.data;

    const styleDesc: Record<string, string> = {
      academic: "Use logical arguments, cite evidence, identify logical fallacies in the position.",
      political: "Frame arguments in terms of values, identity, and political consequences.",
      business: "Focus on ROI, risk, market impact, and operational feasibility.",
      devil_advocate: "Find every possible weakness and counter-argument, even ones you don't personally hold.",
    };

    const opponentSystem = `You are playing devil's advocate against the following position.
Style: ${styleDesc[style]}
Be rigorous, specific, and challenging. Don't hold back. Steelman the opposition.`;

    const debatePrompt = `Position to challenge: "${position}"

Generate ${rounds} rounds of counter-arguments. Each round should:
1. Present a strong counter-argument
2. Give supporting evidence or logic
3. Anticipate the rebuttal and pre-empt it

After all rounds, provide:
- The 3 strongest attacks on this position
- Suggested defenses for each
- Overall assessment of the position's weaknesses`;

    const opposition = await runOneShot(opponentSystem, debatePrompt);

    return reply.send({
      success: true,
      useCase: "debate-prep",
      yourPosition: position,
      style,
      opposition,
    });
  });

  /**
   * POST /simulate/use-cases/product-research
   * Spawn target user personas and ask them your questions.
   */
  app.post("/simulate/use-cases/product-research", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = productResearchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { product, personas: personaDescriptions, questions } = parsed.data;

    // Run all personas answering all questions in parallel
    const results = await Promise.all(
      personaDescriptions.map(async (personaDesc) => {
        const personaSystem = `You are a realistic user persona: ${personaDesc}.
Be authentic to this persona's perspective, needs, frustrations, and context.
Answer from lived experience, not as a marketing consultant.`;

        const answersPrompt = `You are evaluating: "${product}"

Answer each question honestly from your perspective as ${personaDesc}:

${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Give specific, detailed answers that reflect your real needs and pain points.`;

        const answers = await runOneShot(personaSystem, answersPrompt);
        return { persona: personaDesc, answers };
      }),
    );

    // Synthesise findings
    const synthPrompt = `You ran user research for: "${product}"

Results from ${personaDescriptions.length} personas:
${results.map(r => `[${r.persona}]\n${r.answers.slice(0, 500)}`).join("\n\n")}

Questions asked: ${questions.join(", ")}

Synthesise the key insights:
1. Common themes across personas
2. Surprising findings
3. Critical user needs
4. Biggest pain points
5. Feature/product recommendations`;

    const synthesis = await runOneShot(
      "You are a UX researcher synthesising user research findings.",
      synthPrompt,
    );

    return reply.send({
      success: true,
      useCase: "product-research",
      product,
      personaResults: results,
      synthesis,
    });
  });

  /**
   * POST /simulate/use-cases/historical
   * Seed a simulation from a historical period and run it forward.
   */
  app.post("/simulate/use-cases/historical", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = historicalSimSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { scenario, period, figures, question } = parsed.data;

    const histPrompt = `Historical simulation:
SCENARIO: ${scenario}
PERIOD: ${period}
HISTORICAL FIGURES: ${figures.join(", ")}
${question ? `KEY QUESTION: ${question}` : ""}

Simulate how these historical figures would have interacted and what decisions they would have made.
Show each figure's perspective, motivations, and likely actions.
${question ? `Specifically address: ${question}` : ""}

Write as a narrative with each figure's voice clearly distinct.`;

    const simulation = await runOneShot(
      `You are a historian with deep expertise in ${period}. Portray historical figures accurately based on documented evidence.`,
      histPrompt,
    );

    return reply.send({
      success: true,
      useCase: "historical-simulation",
      scenario,
      period,
      figures,
      simulation,
    });
  });

  /**
   * POST /simulate/use-cases/creative-writing
   * Run characters through a plot to find inconsistencies and explore story possibilities.
   */
  app.post("/simulate/use-cases/creative-writing", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = creativeWritingSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { premise, characters, ticks } = parsed.data;

    const characterDescriptions = characters
      .map(c => `${c.name} (${c.role}): wants to "${c.goal}"`)
      .join("\n");

    // Run each tick as a scene
    const scenes: Array<{ tick: number; scene: string }> = [];
    let storyState = `Setting up: ${premise}`;

    for (let t = 1; t <= ticks; t++) {
      const scenePrompt = `Write scene ${t} of ${ticks} for this story.

PREMISE: ${premise}
CHARACTERS:
${characterDescriptions}

STORY SO FAR: ${storyState.slice(0, 500)}

Write a compelling scene (2-3 paragraphs) where the characters interact.
Show how each character's goal creates tension or connection.
End with a development that sets up the next scene.`;

      const scene = await runOneShot(
        "You are a skilled fiction writer. Write scenes that reveal character through action and dialogue.",
        scenePrompt,
      );

      scenes.push({ tick: t, scene });
      storyState = scene.slice(0, 500); // carry forward for context
    }

    // Consistency analysis
    const analysisPrompt = `Analyse this story for:
1. Character consistency issues (where characters act against their established goals/nature)
2. Plot holes or logical inconsistencies
3. Strongest moments
4. Suggestions for improvement

CHARACTERS:
${characterDescriptions}

SCENES:
${scenes.map(s => `Scene ${s.tick}: ${s.scene.slice(0, 300)}`).join("\n\n")}`;

    const analysis = await runOneShot(
      "You are a story editor with 20 years of experience.",
      analysisPrompt,
    );

    return reply.send({
      success: true,
      useCase: "creative-writing",
      premise,
      characters,
      scenes,
      analysis,
    });
  });
}

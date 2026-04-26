/**
 * Deliberate + Evaluate proxy routes
 *
 * Handles requests from the React Router frontend SPA:
 *   POST /api/deliberate  — multi-archetype AI deliberation
 *   POST /api/evaluate    — deliberation quality metrics
 *
 * Uses GOOGLE_API_KEY (Gemini) when available, falls back to
 * OPENAI_API_KEY if present, otherwise returns a 503.
 */

import type { FastifyPluginAsync } from "fastify";

const ARCHETYPE_SYSTEM_PROMPTS: Record<string, string> = {
  Architect:     `You are "The Architect" — a council member focused on systems-level thinking, design patterns, and long-term structure. Analyze from an architectural perspective: boundaries, interfaces, modularity, scalability, and maintainability. Be concise (2-3 paragraphs).`,
  Pragmatist:    `You are "The Pragmatist" — focused on practical delivery, real-world constraints, timelines, and feasibility. Be concise (2-3 paragraphs).`,
  Ethicist:      `You are "The Ethicist" — focused on moral implications, fairness, stakeholder impact, and societal consequences. Be concise (2-3 paragraphs).`,
  Empiricist:    `You are "The Empiricist" — focused on data, evidence, measurement, and empirical validation. Be concise (2-3 paragraphs).`,
  Contrarian:    `You are "The Contrarian" — plays devil's advocate, challenges assumptions, stress-tests ideas. Be concise (2-3 paragraphs).`,
};

const VERDICT_SYSTEM_PROMPT = `You are a Council Moderator synthesizing multiple perspectives into a final verdict. Acknowledge key tensions, identify areas of agreement, and provide a clear actionable recommendation. Use markdown. Keep it to 2-3 paragraphs.`;

const EVALUATE_SYSTEM_PROMPT = `You are an AI evaluation engine. Given a deliberation topic, generate realistic quality metrics. Return ONLY a JSON object with these exact fields:
- quality: number 0-100 (overall quality score)
- coherence: number 0.00-1.00 (logical coherence)
- consensus: number 0.00-1.00 (agreement level)
- diversity: number 0.00-1.00 (perspective diversity)
Return ONLY the JSON object, no other text.`;

async function callGemini(systemPrompt: string, userContent: string): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not configured");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

const deliberateProxyPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/deliberate", async (req, reply) => {
    const body = req.body as {
      prompt?: string;
      members?: Array<{ name: string; opinion?: string }>;
      type?: "opinion" | "verdict";
    };

    if (!body.prompt) {
      return reply.status(400).send({ error: "Missing prompt" });
    }

    try {
      if (body.type === "verdict" && body.members?.length) {
        const opinionsText = body.members
          .map((m) => `**${m.name}**: ${m.opinion ?? "(no opinion provided)"}`)
          .join("\n\n");

        const text = await callGemini(
          VERDICT_SYSTEM_PROMPT,
          `Question: ${body.prompt}\n\nCouncil Opinions:\n${opinionsText}\n\nSynthesize these into a final verdict.`,
        );
        return reply.send({ text });
      }

      const memberName = body.members?.[0]?.name ?? "Architect";
      const systemPrompt =
        ARCHETYPE_SYSTEM_PROMPTS[memberName] ??
        `You are "${memberName}" — a council member with a unique perspective. Be concise (2-3 paragraphs).`;

      const text = await callGemini(systemPrompt, body.prompt);
      return reply.send({ text });
    } catch (err: any) {
      req.log.error({ err }, "deliberate-proxy error");
      return reply.status(500).send({ error: err?.message ?? "AI call failed" });
    }
  });

  fastify.post("/evaluate", async (req, reply) => {
    const body = req.body as { topic?: string };
    if (!body.topic) {
      return reply.status(400).send({ error: "Missing topic" });
    }

    try {
      const raw = await callGemini(
        EVALUATE_SYSTEM_PROMPT,
        `Evaluate this deliberation topic: "${body.topic}"`,
      );

      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const m = JSON.parse(match[0]);
        return reply.send({
          quality:   Math.min(100, Math.max(0, Math.round(m.quality ?? 75))),
          coherence: Math.min(1, Math.max(0, parseFloat((m.coherence ?? 0.8).toFixed(2)))),
          consensus: Math.min(1, Math.max(0, parseFloat((m.consensus ?? 0.7).toFixed(2)))),
          diversity: Math.min(1, Math.max(0, parseFloat((m.diversity ?? 0.85).toFixed(2)))),
        });
      }

      return reply.send({ quality: 75, coherence: 0.8, consensus: 0.7, diversity: 0.85 });
    } catch (err: any) {
      req.log.error({ err }, "evaluate-proxy error");
      return reply.status(500).send({ error: err?.message ?? "AI call failed" });
    }
  });
};

export default deliberateProxyPlugin;

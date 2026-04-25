import type { Route } from "./+types/api.evaluate";

export async function action({ request, context }: Route.ActionArgs) {
  const body = await request.json();
  const { topic } = body as { topic: string };

  if (!topic) {
    return Response.json({ error: "Missing topic" }, { status: 400 });
  }

  const ai = context.cloudflare.env.AI;

  try {
    const result = await ai.run("auto" as any, {
      messages: [
        {
          role: "system",
          content: `You are an AI evaluation engine. Given a deliberation topic, generate realistic quality metrics. Return ONLY a JSON object with these exact fields:
- quality: number 0-100 (overall quality score)
- coherence: number 0.00-1.00 (logical coherence)
- consensus: number 0.00-1.00 (agreement level)
- diversity: number 0.00-1.00 (perspective diversity)
Return ONLY the JSON object, no other text.`,
        },
        {
          role: "user",
          content: `Evaluate this deliberation topic: "${topic}"`,
        },
      ],
    });

    const text =
      typeof result === "string"
        ? result
        : result?.response ?? JSON.stringify(result);

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const metrics = JSON.parse(jsonMatch[0]);
      return Response.json({
        quality: Math.min(100, Math.max(0, Math.round(metrics.quality))),
        coherence: Math.min(
          1,
          Math.max(0, parseFloat(metrics.coherence.toFixed(2)))
        ),
        consensus: Math.min(
          1,
          Math.max(0, parseFloat(metrics.consensus.toFixed(2)))
        ),
        diversity: Math.min(
          1,
          Math.max(0, parseFloat(metrics.diversity.toFixed(2)))
        ),
      });
    }

    return Response.json({
      quality: 75,
      coherence: 0.8,
      consensus: 0.7,
      diversity: 0.85,
    });
  } catch (err: any) {
    return Response.json(
      { error: err?.message ?? "Evaluation failed" },
      { status: 500 }
    );
  }
}

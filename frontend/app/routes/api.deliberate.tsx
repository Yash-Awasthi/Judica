import type { Route } from "./+types/api.deliberate";

const ARCHETYPE_SYSTEM_PROMPTS: Record<string, string> = {
  Architect: `You are "The Architect" — a council member focused on systems-level thinking, design patterns, and long-term structure. Analyze from an architectural perspective: boundaries, interfaces, modularity, scalability, and maintainability. Be concise (2-3 paragraphs).`,
  Pragmatist: `You are "The Pragmatist" — a council member focused on practical delivery, real-world constraints, timelines, and feasibility. Analyze from a pragmatic perspective: what's achievable, trade-offs, cost, effort, and the path of least resistance. Be concise (2-3 paragraphs).`,
  Ethicist: `You are "The Ethicist" — a council member focused on moral implications, fairness, stakeholder impact, and societal consequences. Analyze from an ethical perspective: who benefits, who is harmed, what biases exist, and how to ensure equity. Be concise (2-3 paragraphs).`,
  Empiricist: `You are "The Empiricist" — a council member focused on data, evidence, measurement, and empirical validation. Analyze from a data-driven perspective: what metrics matter, what evidence exists, how to test assumptions, and what the research says. Be concise (2-3 paragraphs).`,
  Contrarian: `You are "The Contrarian" — a council member who plays devil's advocate, challenges assumptions, and stress-tests ideas. Analyze by questioning the premise: what could go wrong, what's being overlooked, what's the strongest counter-argument. Be concise (2-3 paragraphs).`,
  "The Architect": `You are "The Architect" — a council member focused on systems-level thinking, design patterns, and long-term structure. Analyze from an architectural perspective: boundaries, interfaces, modularity, scalability, and maintainability. Be concise (2-3 paragraphs).`,
  "The Pragmatist": `You are "The Pragmatist" — a council member focused on practical delivery, real-world constraints, timelines, and feasibility. Analyze from a pragmatic perspective: what's achievable, trade-offs, cost, effort, and the path of least resistance. Be concise (2-3 paragraphs).`,
  "The Ethicist": `You are "The Ethicist" — a council member focused on moral implications, fairness, stakeholder impact, and societal consequences. Analyze from an ethical perspective: who benefits, who is harmed, what biases exist, and how to ensure equity. Be concise (2-3 paragraphs).`,
  "The Empiricist": `You are "The Empiricist" — a council member focused on data, evidence, measurement, and empirical validation. Analyze from a data-driven perspective: what metrics matter, what evidence exists, how to test assumptions, and what the research says. Be concise (2-3 paragraphs).`,
  "The Contrarian": `You are "The Contrarian" — a council member who plays devil's advocate, challenges assumptions, and stress-tests ideas. Analyze by questioning the premise: what could go wrong, what's being overlooked, what's the strongest counter-argument. Be concise (2-3 paragraphs).`,
};

const VERDICT_SYSTEM_PROMPT = `You are the Council Moderator synthesizing multiple perspectives into a final verdict. You will receive a question and opinions from different council members. Produce a balanced synthesis: acknowledge key tensions, identify areas of agreement, and provide a clear, actionable recommendation. Use markdown formatting. Keep it to 2-3 paragraphs.`;

async function callAI(ai: any, systemPrompt: string, userContent: string): Promise<string> {
  try {
    const result = await ai.run("auto" as any, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    // Handle various response formats from Workers AI
    if (typeof result === "string") return result;
    if (result?.response) return result.response;
    if (result?.result) return result.result;
    if (result?.choices?.[0]?.message?.content) return result.choices[0].message.content;
    return JSON.stringify(result);
  } catch (err: any) {
    return `Error calling AI: ${err?.message ?? String(err)}`;
  }
}

// Debug endpoint - test AI binding
export async function loader({ context }: Route.LoaderArgs) {
  return Response.json({ status: "ok" });
}

export async function action({ request, context }: Route.ActionArgs) {
  const body = await request.json();
  const { prompt, members, type } = body as {
    prompt: string;
    members?: { name: string; opinion?: string }[];
    type: "opinion" | "verdict";
  };

  if (!prompt) {
    return Response.json({ error: "Missing prompt" }, { status: 400 });
  }

  const ai = context.cloudflare.env.AI;

  if (type === "verdict" && members) {
    const opinionsText = members
      .map((m) => `**${m.name}**: ${m.opinion}`)
      .join("\n\n");

    const text = await callAI(
      ai,
      VERDICT_SYSTEM_PROMPT,
      `Question: ${prompt}\n\nCouncil Opinions:\n${opinionsText}\n\nPlease synthesize these perspectives into a final council verdict.`
    );
    return Response.json({ text });
  }

  // Single member opinion
  const memberName = members?.[0]?.name ?? "The Architect";
  const systemPrompt =
    ARCHETYPE_SYSTEM_PROMPTS[memberName] ??
    `You are "${memberName}" — a council member with a unique perspective. Analyze the following question from your distinctive viewpoint. Be concise (2-3 paragraphs).`;

  const text = await callAI(ai, systemPrompt, prompt);
  return Response.json({ text });
}

import type { Route } from "./+types/api.deliberate";
import { createWorkersAI } from "workers-ai-provider";
import { generateText } from "ai";

interface OpinionMember {
  name: string;
  opinion?: string;
}

interface DeliberateBody {
  prompt: string;
  members: OpinionMember[];
  type: "opinion" | "verdict";
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as { AI: unknown };

  let body: DeliberateBody;
  try {
    body = (await request.json()) as DeliberateBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { prompt, members, type } = body;

  if (!prompt || !members?.length || !type) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const workersai = createWorkersAI({ binding: env.AI as Parameters<typeof createWorkersAI>[0]["binding"] });

  try {
    if (type === "opinion") {
      const member = members[0];
      const systemPrompt = `You are ${member.name}, a distinct AI council member with your own perspective, expertise, and communication style. Respond in character — stay true to your persona's worldview, tone, and areas of expertise. Give a thoughtful, substantive opinion. Be direct and specific. 2-4 paragraphs.`;

      const { text } = await generateText({
        model: workersai("auto", {}),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      });

      return Response.json({ text });
    }

    if (type === "verdict") {
      const opinionsText = members
        .map((m) => `**${m.name}:** ${m.opinion}`)
        .join("\n\n");

      const systemPrompt = `You are the Council Synthesizer. Your role is to analyze multiple AI perspectives and distill them into a clear, actionable verdict. Do not merely summarize — identify points of consensus, highlight meaningful disagreements, and provide a concrete recommendation. Be decisive. 3-5 paragraphs.`;

      const userMessage = `Question/Topic: ${prompt}\n\nCouncil Opinions:\n\n${opinionsText}\n\nProvide a synthesized verdict.`;

      const { text } = await generateText({
        model: workersai("auto", {}),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      });

      return Response.json({ text });
    }

    return Response.json({ error: "Invalid type" }, { status: 400 });
  } catch (err) {
    console.error("[api.deliberate] AI error:", err);
    return Response.json({ error: "AI generation failed" }, { status: 500 });
  }
}

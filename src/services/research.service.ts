import { db } from "../lib/drizzle.js";
import { researchJobs } from "../db/schema/research.js";
import { eq } from "drizzle-orm";
import { routeAndCollect } from "../router/smartRouter.js";
import logger from "../lib/logger.js";
import type { AdapterMessage } from "../adapters/types.js";
import { env } from "../config/env.js";

export interface ResearchStep {
  question: string;
  status: "pending" | "searching" | "synthesizing" | "done" | "failed";
  sources: { title: string; url: string; content: string }[];
  answer?: string;
  error?: string;
}

type EventEmitter = (event: string, data: unknown) => void;

async function webSearch(query: string, maxResults: number = 5): Promise<{ title: string; url: string; content: string }[]> {
  // Use Tavily if available, otherwise SerpAPI
  if (env.TAVILY_API_KEY) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query,
          max_results: maxResults,
          search_depth: "advanced",
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = (await res.json()) as { results?: Array<{ title: string; url: string; content?: string }> };
        return (data.results || []).map((r) => ({
          title: r.title || "",
          url: r.url || "",
          content: (r.content || "").slice(0, 2000),
        }));
      }
    } catch (err) {
      logger.warn({ err }, "Tavily search failed");
    }
  }

  if (env.SERP_API_KEY) {
    try {
      // Send API key via header instead of URL query string to avoid
      // leaking credentials in server logs and referer headers (BE-16)
      const serpUrl = new URL("https://serpapi.com/search.json");
      serpUrl.searchParams.set("q", query);
      serpUrl.searchParams.set("num", String(maxResults));
      const res = await fetch(serpUrl.toString(), {
        headers: {
          "X-API-KEY": env.SERP_API_KEY,
          "Authorization": `Bearer ${env.SERP_API_KEY}`,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = (await res.json()) as { organic_results?: Array<{ title: string; link: string; snippet?: string }> };
        return (data.organic_results || []).slice(0, maxResults).map((r) => ({
          title: r.title || "",
          url: r.link || "",
          content: (r.snippet || "").slice(0, 2000),
        }));
      }
    } catch (err) {
      logger.warn({ err }, "SerpAPI search failed");
    }
  }

  return [];
}

async function callAI(systemPrompt: string, userPrompt: string, model?: string): Promise<string> {
  const messages: AdapterMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const result = await routeAndCollect({
    model: model || "",
    messages,
    temperature: 0.3,
    max_tokens: 4096,
  });

  return result.text;
}

export async function runResearch(
  jobId: string,
  userId: number,
  query: string,
  emit?: EventEmitter
): Promise<void> {
  try {
    // Update status to running
    await db.update(researchJobs).set({ status: "running" }).where(eq(researchJobs.id, jobId));

    // STEP A: Plan — break into sub-questions
    emit?.("status", { status: "planning" });

    const planResponse = await callAI(
      "You are a research planner. Given a research query, break it down into 3-5 focused sub-questions that, when answered, will provide a comprehensive understanding of the topic. Return ONLY a JSON array of strings, no other text.",
      `Research query: "${query}"`,
    );

    let subQuestions: string[];
    try {
      // Try to parse JSON from the response
      const jsonMatch = planResponse.match(/\[[\s\S]*?\]/);
      subQuestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [query];
    } catch {
      subQuestions = [query];
    }

    // Limit to 5 sub-questions
    subQuestions = subQuestions.slice(0, 5);

    const steps: ResearchStep[] = subQuestions.map((q) => ({
      question: q,
      status: "pending",
      sources: [],
    }));

    await db.update(researchJobs).set({ steps: JSON.parse(JSON.stringify(steps)) }).where(eq(researchJobs.id, jobId));
    emit?.("plan", { steps: steps.map((s) => s.question) });

    // STEP B: Search each sub-question
    for (let i = 0; i < steps.length; i++) {
      steps[i].status = "searching";
      await db.update(researchJobs).set({ steps: JSON.parse(JSON.stringify(steps)) }).where(eq(researchJobs.id, jobId));

      const results = await webSearch(steps[i].question, 5);
      steps[i].sources = results;

      for (const source of results) {
        emit?.("source_found", { stepIndex: i, url: source.url, title: source.title });
      }

      // STEP C: Synthesize answer for this sub-question
      steps[i].status = "synthesizing";
      await db.update(researchJobs).set({ steps: JSON.parse(JSON.stringify(steps)) }).where(eq(researchJobs.id, jobId));

      if (steps[i].sources.length > 0) {
        const sourcesText = steps[i].sources
          .map((s, idx) => `[Source ${idx + 1}] ${s.title}\nURL: ${s.url}\n${s.content}`)
          .join("\n\n");

        const answer = await callAI(
          "You are a research analyst. Answer the question using ONLY the provided sources. Cite sources using [1], [2], etc. Be thorough but concise.",
          `Question: ${steps[i].question}\n\nSources:\n${sourcesText}`,
        );
        steps[i].answer = answer;
      } else {
        // No sources found, use AI general knowledge with disclaimer
        const answer = await callAI(
          "You are a research analyst. Answer the question based on your knowledge. Note that no web sources were available for this sub-question.",
          steps[i].question,
        );
        steps[i].answer = answer;
      }

      steps[i].status = "done";
      await db.update(researchJobs).set({ steps: JSON.parse(JSON.stringify(steps)) }).where(eq(researchJobs.id, jobId));

      emit?.("step_complete", {
        stepIndex: i,
        question: steps[i].question,
        answer: steps[i].answer,
        sourceCount: steps[i].sources.length,
      });
    }

    // STEP D: Final report
    emit?.("status", { status: "synthesizing_report" });

    const findings = steps
      .map((s) => `## ${s.question}\n\n${s.answer || "No answer available."}`)
      .join("\n\n---\n\n");

    // Collect all sources for citations
    const allSources = steps.flatMap((s, si) =>
      s.sources.map((src, srcIdx) => ({ ...src, ref: `[${si + 1}.${srcIdx + 1}]` }))
    );

    const report = await callAI(
      `You are a senior research analyst. Write a comprehensive, well-structured research report in Markdown.
Include:
- Executive summary
- Key findings organized by theme
- Detailed analysis
- Conclusions and recommendations
- References section listing all sources

Use citations like [1.1], [1.2] referring to the source indices provided.
Format with proper Markdown: headers, bullet points, bold for emphasis.`,
      `Research topic: "${query}"\n\nFindings:\n${findings}\n\nAll Sources:\n${allSources.map((s) => `${s.ref} ${s.title} — ${s.url}`).join("\n")}`,
    );

    await db.update(researchJobs).set({
      status: "done",
      report,
      steps: JSON.parse(JSON.stringify(steps)),
    }).where(eq(researchJobs.id, jobId));

    emit?.("report_ready", { report });
    emit?.("done", { jobId });
  } catch (err: unknown) {
    logger.error({ err, jobId }, "Research job failed");
    await db.update(researchJobs).set({ status: "failed" }).where(eq(researchJobs.id, jobId));
    emit?.("error", { message: err instanceof Error ? err.message : String(err) });
  }
}

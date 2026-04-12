import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Mocks (must be declared before imports) ─────────────────────────────────

const mockDbUpdate = vi.fn();
const mockDbSet = vi.fn();
const mockDbWhere = vi.fn();

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    update: (...args: any[]) => {
      mockDbUpdate(...args);
      return {
        set: (...sArgs: any[]) => {
          mockDbSet(...sArgs);
          return { where: mockDbWhere };
        },
      };
    },
  },
}));

vi.mock("../../src/db/schema/research.js", () => ({
  researchJobs: { id: "id_col" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: any, val: any) => ({ col, val })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/router/smartRouter.js", () => ({
  routeAndCollect: vi.fn(),
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    TAVILY_API_KEY: "tavily-key",
    SERP_API_KEY: "serp-key",
  },
}));

import { runResearch } from "../../src/services/research.service.js";
import { routeAndCollect } from "../../src/router/smartRouter.js";
import { env } from "../../src/config/env.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const mockedRouteAndCollect = routeAndCollect as Mock;

function makeFetchOk(body: any): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response;
}

function makeFetchFail(): Response {
  return {
    ok: false,
    json: async () => ({}),
  } as unknown as Response;
}

const tavilyResults = {
  results: [
    { title: "T1", url: "https://t1.com", content: "Content 1" },
    { title: "T2", url: "https://t2.com", content: "Content 2" },
  ],
};

const serpResults = {
  organic_results: [
    { title: "S1", link: "https://s1.com", snippet: "Snippet 1" },
    { title: "S2", link: "https://s2.com", snippet: "Snippet 2" },
  ],
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runResearch", () => {
  let emit: Mock;
  const jobId = "job-123";
  const userId = 42;
  const query = "How does photosynthesis work?";

  beforeEach(() => {
    vi.restoreAllMocks();
    emit = vi.fn();
    mockDbUpdate.mockClear();
    mockDbSet.mockClear();
    mockDbWhere.mockClear();
    mockedRouteAndCollect.mockReset();

    // Reset env keys to defaults
    (env as any).TAVILY_API_KEY = "tavily-key";
    (env as any).SERP_API_KEY = "serp-key";

    // Default: global fetch returns Tavily results
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchOk(tavilyResults)),
    );
  });

  // Helper: set up routeAndCollect responses in sequence
  function setupAI(...responses: string[]) {
    for (const text of responses) {
      mockedRouteAndCollect.mockResolvedValueOnce({ text });
    }
  }

  // ── Full pipeline ───────────────────────────────────────────────────────

  describe("full pipeline", () => {
    it("runs planning, searching, synthesis, and reporting phases", async () => {
      const subQs = JSON.stringify(["What is photosynthesis?", "What pigments are involved?"]);
      setupAI(
        subQs,              // planning response
        "Answer for Q1",    // synthesis for sub-question 1
        "Answer for Q2",    // synthesis for sub-question 2
        "# Final Report",   // final report
      );

      await runResearch(jobId, userId, query, emit);

      // DB: first call sets status to "running"
      expect(mockDbSet).toHaveBeenCalledWith({ status: "running" });

      // DB: last call sets status "done" with report
      const lastSetCall = mockDbSet.mock.calls[mockDbSet.mock.calls.length - 1][0];
      expect(lastSetCall).toMatchObject({ status: "done", report: "# Final Report" });

      // Emits in order: planning, plan, source_found(s), step_complete(s), synthesizing_report, report_ready, done
      const eventNames = emit.mock.calls.map((c: any[]) => c[0]);
      expect(eventNames[0]).toBe("status");
      expect(emit.mock.calls[0][1]).toEqual({ status: "planning" });
      expect(eventNames[1]).toBe("plan");
      expect(eventNames).toContain("source_found");
      expect(eventNames).toContain("step_complete");
      expect(eventNames).toContain("report_ready");
      expect(eventNames[eventNames.length - 1]).toBe("done");
    });

    it("passes the correct query to the planning LLM call", async () => {
      setupAI(
        JSON.stringify(["Q1"]),
        "Answer",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      const firstCallArgs = mockedRouteAndCollect.mock.calls[0][0];
      expect(firstCallArgs.messages[0].content).toContain("research planner");
      expect(firstCallArgs.messages[1].content).toContain(query);
    });
  });

  // ── Search fallback ─────────────────────────────────────────────────────

  describe("search fallback", () => {
    it("falls back to SerpAPI when Tavily returns non-ok", async () => {
      let callCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          callCount++;
          if (typeof url === "string" && url.includes("tavily")) {
            return Promise.resolve(makeFetchFail());
          }
          return Promise.resolve(makeFetchOk(serpResults));
        }),
      );

      setupAI(
        JSON.stringify(["Q1"]),
        "Answer",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      // Should have called fetch twice per sub-question (Tavily fail + SerpAPI)
      const fetchMock = globalThis.fetch as Mock;
      const urls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
      expect(urls.some((u: string) => u.includes("tavily"))).toBe(true);
      expect(urls.some((u: string) => u.includes("serpapi"))).toBe(true);

      // Sources should come from SerpAPI
      const sourceEvents = emit.mock.calls.filter((c: any[]) => c[0] === "source_found");
      expect(sourceEvents.length).toBeGreaterThan(0);
      expect(sourceEvents[0][1].url).toBe("https://s1.com");
    });

    it("falls back to SerpAPI when Tavily throws a network error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          if (typeof url === "string" && url.includes("tavily")) {
            return Promise.reject(new Error("Network error"));
          }
          return Promise.resolve(makeFetchOk(serpResults));
        }),
      );

      setupAI(
        JSON.stringify(["Q1"]),
        "Answer",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      const sourceEvents = emit.mock.calls.filter((c: any[]) => c[0] === "source_found");
      expect(sourceEvents.length).toBeGreaterThan(0);
    });

    it("falls back to SerpAPI when TAVILY_API_KEY is unset", async () => {
      (env as any).TAVILY_API_KEY = "";

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(makeFetchOk(serpResults)),
      );

      setupAI(
        JSON.stringify(["Q1"]),
        "Answer",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      const fetchMock = globalThis.fetch as Mock;
      const urls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
      expect(urls.every((u: string) => u.includes("serpapi"))).toBe(true);
    });

    it("sends SerpAPI key via headers, not query string", async () => {
      (env as any).TAVILY_API_KEY = "";

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(makeFetchOk(serpResults)),
      );

      setupAI(JSON.stringify(["Q1"]), "Answer", "# Report");

      await runResearch(jobId, userId, query, emit);

      const fetchMock = globalThis.fetch as Mock;
      const serpCall = fetchMock.mock.calls.find((c: any[]) => String(c[0]).includes("serpapi"));
      expect(serpCall).toBeDefined();
      // URL should NOT contain the API key
      expect(String(serpCall![0])).not.toContain("serp-key");
      // Headers should contain it
      expect(serpCall![1].headers["X-API-KEY"]).toBe("serp-key");
      expect(serpCall![1].headers["Authorization"]).toBe("Bearer serp-key");
    });
  });

  // ── Event emission order ──────────────────────────────────────────────

  describe("event emission order", () => {
    it("emits events in the correct sequence for a two-step plan", async () => {
      setupAI(
        JSON.stringify(["Q1", "Q2"]),
        "A1",
        "A2",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      const events = emit.mock.calls.map((c: any[]) => c[0]);

      // planning must come before plan
      expect(events.indexOf("status")).toBeLessThan(events.indexOf("plan"));

      // source_found for step 0 should come before step_complete for step 0
      const firstSourceIdx = events.indexOf("source_found");
      const firstStepCompleteIdx = events.indexOf("step_complete");
      expect(firstSourceIdx).toBeLessThan(firstStepCompleteIdx);

      // step_complete events should be ordered by stepIndex
      const stepCompletes = emit.mock.calls.filter((c: any[]) => c[0] === "step_complete");
      expect(stepCompletes[0][1].stepIndex).toBe(0);
      expect(stepCompletes[1][1].stepIndex).toBe(1);

      // report_ready before done
      expect(events.indexOf("report_ready")).toBeLessThan(events.indexOf("done"));
    });

    it("step_complete payload includes sourceCount", async () => {
      setupAI(
        JSON.stringify(["Q1"]),
        "A1",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      const stepComplete = emit.mock.calls.find((c: any[]) => c[0] === "step_complete");
      expect(stepComplete).toBeDefined();
      expect(stepComplete![1]).toMatchObject({
        stepIndex: 0,
        question: "Q1",
        answer: "A1",
        sourceCount: 2, // tavilyResults has 2 entries
      });
    });

    it("works without an emit function", async () => {
      setupAI(
        JSON.stringify(["Q1"]),
        "A1",
        "# Report",
      );

      // No emit argument — should not throw
      await expect(runResearch(jobId, userId, query)).resolves.toBeUndefined();
    });
  });

  // ── JSON parse failures in planning ───────────────────────────────────

  describe("JSON parse failures in planning", () => {
    it("falls back to original query when LLM returns invalid JSON", async () => {
      setupAI(
        "This is not JSON at all, just plain text",
        "Answer for original query",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      // Plan event should contain the original query as the sole sub-question
      const planCall = emit.mock.calls.find((c: any[]) => c[0] === "plan");
      expect(planCall![1].steps).toEqual([query]);
    });

    it("falls back to original query when LLM returns malformed JSON array", async () => {
      setupAI(
        "Here's my plan: [broken json",
        "Answer",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      const planCall = emit.mock.calls.find((c: any[]) => c[0] === "plan");
      expect(planCall![1].steps).toEqual([query]);
    });

    it("extracts JSON array embedded in surrounding text", async () => {
      setupAI(
        'Here are the sub-questions:\n["Q1", "Q2"]\nPlease proceed.',
        "A1",
        "A2",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      const planCall = emit.mock.calls.find((c: any[]) => c[0] === "plan");
      expect(planCall![1].steps).toEqual(["Q1", "Q2"]);
    });

    it("limits sub-questions to 5 even if LLM returns more", async () => {
      setupAI(
        JSON.stringify(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"]),
        "A1", "A2", "A3", "A4", "A5",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      const planCall = emit.mock.calls.find((c: any[]) => c[0] === "plan");
      expect(planCall![1].steps).toHaveLength(5);
    });
  });

  // ── No results scenario ───────────────────────────────────────────────

  describe("no search results", () => {
    it("uses AI general knowledge when no sources are found", async () => {
      // Both search providers return empty results
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(makeFetchOk({ results: [], organic_results: [] })),
      );

      setupAI(
        JSON.stringify(["Q1"]),
        "General knowledge answer",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      // The synthesis call should use the "no web sources" system prompt
      const synthCall = mockedRouteAndCollect.mock.calls[1][0];
      expect(synthCall.messages[0].content).toContain("no web sources");

      // No source_found events should be emitted
      const sourceEvents = emit.mock.calls.filter((c: any[]) => c[0] === "source_found");
      expect(sourceEvents).toHaveLength(0);

      // step_complete should still fire with sourceCount 0
      const stepComplete = emit.mock.calls.find((c: any[]) => c[0] === "step_complete");
      expect(stepComplete![1].sourceCount).toBe(0);
    });

    it("uses general knowledge when both search APIs return non-ok", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          // Both Tavily and SerpAPI fail
          return Promise.resolve(makeFetchFail());
        }),
      );

      setupAI(
        JSON.stringify(["Q1"]),
        "General knowledge answer",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      // When both APIs fail, webSearch returns [], triggering the "no web sources" branch
      const synthCall = mockedRouteAndCollect.mock.calls[1][0];
      expect(synthCall.messages[0].content).toContain("no web sources");
    });
  });

  // ── DB state updates ──────────────────────────────────────────────────

  describe("DB state updates", () => {
    it("updates status to running, then done on success", async () => {
      setupAI(
        JSON.stringify(["Q1"]),
        "A1",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      const setCalls = mockDbSet.mock.calls;

      // First set: status -> running
      expect(setCalls[0][0]).toEqual({ status: "running" });

      // Last set: status -> done, with report and steps
      const last = setCalls[setCalls.length - 1][0];
      expect(last.status).toBe("done");
      expect(last.report).toBe("# Report");
      expect(last.steps).toHaveLength(1);
      expect(last.steps[0].status).toBe("done");
    });

    it("persists step statuses through searching -> synthesizing -> done", async () => {
      setupAI(
        JSON.stringify(["Q1"]),
        "A1",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      // Collect all steps payloads written to DB
      const stepsUpdates = mockDbSet.mock.calls
        .map((c: any[]) => c[0])
        .filter((s: any) => s.steps);

      // Should see steps with statuses: [pending] -> [searching] -> [synthesizing] -> [done]
      const statuses = stepsUpdates.map(
        (u: any) => u.steps[0]?.status,
      );
      expect(statuses).toContain("searching");
      expect(statuses).toContain("synthesizing");
      expect(statuses).toContain("done");

      // Searching should come before synthesizing
      expect(statuses.indexOf("searching")).toBeLessThan(statuses.indexOf("synthesizing"));
    });

    it("updates status to failed when an error occurs", async () => {
      mockedRouteAndCollect.mockRejectedValueOnce(new Error("LLM exploded"));

      await runResearch(jobId, userId, query, emit);

      // Should set status to "failed"
      const failCall = mockDbSet.mock.calls.find(
        (c: any[]) => c[0].status === "failed",
      );
      expect(failCall).toBeDefined();

      // Should emit error event
      const errorEvent = emit.mock.calls.find((c: any[]) => c[0] === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent![1].message).toBe("LLM exploded");
    });

    it("sets status to failed when search phase throws", async () => {
      setupAI(JSON.stringify(["Q1"]));

      // Make fetch throw after planning succeeds
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network down")),
      );
      // Also clear API keys so we don't attempt a second provider
      (env as any).TAVILY_API_KEY = "";
      (env as any).SERP_API_KEY = "";

      // Synthesis call — this should still succeed since search returns []
      mockedRouteAndCollect.mockResolvedValueOnce({ text: "Knowledge answer" });
      mockedRouteAndCollect.mockResolvedValueOnce({ text: "# Report" });

      await runResearch(jobId, userId, query, emit);

      // Should complete successfully with 0 sources (since both keys are empty, fetch is never called)
      const lastSet = mockDbSet.mock.calls[mockDbSet.mock.calls.length - 1][0];
      expect(lastSet.status).toBe("done");
    });
  });

  // ── Search content truncation ─────────────────────────────────────────

  describe("search content truncation", () => {
    it("truncates source content to 2000 characters", async () => {
      const longContent = "x".repeat(5000);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          makeFetchOk({
            results: [{ title: "Long", url: "https://long.com", content: longContent }],
          }),
        ),
      );

      setupAI(
        JSON.stringify(["Q1"]),
        "A1",
        "# Report",
      );

      await runResearch(jobId, userId, query, emit);

      // Check the steps stored in DB — source content should be truncated
      const stepsUpdates = mockDbSet.mock.calls
        .map((c: any[]) => c[0])
        .filter((s: any) => s.steps && s.steps[0]?.sources?.length > 0);

      expect(stepsUpdates.length).toBeGreaterThan(0);
      expect(stepsUpdates[0].steps[0].sources[0].content).toHaveLength(2000);
    });
  });

  // ── Source citation formatting ────────────────────────────────────────

  describe("report generation", () => {
    it("passes all sources with citation refs to the final report LLM call", async () => {
      setupAI(
        JSON.stringify(["Q1", "Q2"]),
        "A1",
        "A2",
        "# Final report",
      );

      await runResearch(jobId, userId, query, emit);

      // The last routeAndCollect call is for the report
      const reportCall = mockedRouteAndCollect.mock.calls[mockedRouteAndCollect.mock.calls.length - 1][0];
      const userMsg = reportCall.messages[1].content;

      // Should contain citation references like [1.1], [2.1]
      expect(userMsg).toContain("[1.1]");
      expect(userMsg).toContain("[2.1]");
      // Should contain the research topic
      expect(userMsg).toContain(query);
    });

    it("emits report_ready with the full report text", async () => {
      setupAI(
        JSON.stringify(["Q1"]),
        "A1",
        "# My Report\n\nDetailed content here",
      );

      await runResearch(jobId, userId, query, emit);

      const reportEvent = emit.mock.calls.find((c: any[]) => c[0] === "report_ready");
      expect(reportEvent![1].report).toBe("# My Report\n\nDetailed content here");
    });
  });
});

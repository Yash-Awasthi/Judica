import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeliberationOrchestrator, resolveHumanGate } from "../../src/agents/orchestrator.js";
import { AgentMessageBus } from "../../src/agents/messageBus.js";
import { detectConflicts } from "../../src/agents/conflictDetector.js";
import * as sharedMemory from "../../src/agents/sharedMemory.js";
import { routeAndCollect } from "../../src/router/index.js";
import { hybridSearch } from "../../src/services/vectorStore.service.js";
import { updateReliability, getReliabilityScores } from "../../src/services/reliability.service.js";

vi.mock("../../src/agents/messageBus.js", () => {
  return {
    AgentMessageBus: vi.fn().mockImplementation(function(this: any) {
      this.registerAgent = vi.fn();
      this.setAgentStatus = vi.fn();
      this.sendMessage = vi.fn().mockReturnValue({ timestamp: new Date(), content: "msg", from: "a1", to: "a2", type: "critique" });
      this.getAllMessages = vi.fn().mockReturnValue([]);
      this.reset = vi.fn();
    })
  };
});
vi.mock("../../src/agents/conflictDetector.js");
vi.mock("../../src/agents/sharedMemory.js");
vi.mock("../../src/router/index.js");
vi.mock("../../src/services/vectorStore.service.js", () => ({
  hybridSearch: vi.fn().mockResolvedValue([{ content: "chunk1" }])
}));
vi.mock("../../src/services/reliability.service.js");

describe("Deliberation Orchestrator", () => {
  let orchestrator: DeliberationOrchestrator;
  const mockMembers = [
    { id: "a1", name: "Agent 1", model: "m1", systemPrompt: "p1", temperature: 0.7 },
    { id: "a2", name: "Agent 2", model: "m2", systemPrompt: "p2", temperature: 0.7 }
  ];

  beforeEach(() => {
    orchestrator = new DeliberationOrchestrator();
    vi.clearAllMocks();
    
    // Default mocks
    vi.mocked(sharedMemory.getFactContext).mockResolvedValue("facts");
    vi.mocked(sharedMemory.extractAndStoreFacts).mockResolvedValue([{ id: "f1" } as any]);
    vi.mocked(routeAndCollect).mockResolvedValue({
      text: "response content",
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      model: "test-model"
    } as any);
    vi.mocked(detectConflicts).mockResolvedValue([]);
    vi.mocked(getReliabilityScores).mockResolvedValue(new Map());
    vi.mocked(hybridSearch).mockResolvedValue([{ content: "chunk1" }]);
  });

  it("should run a full orchestration flow without conflicts", async () => {
    const input = {
      query: "test query",
      conversationId: "conv1",
      members: mockMembers,
      kbId: "kb1",
      userId: 1
    };

    const events = [];
    for await (const event of orchestrator.run(input)) {
      events.push(event);
    }

    expect(events.map(e => e.type)).toContain("preprocessing_complete");
    expect(events.map(e => e.type)).toContain("member_response");
    expect(events.map(e => e.type)).toContain("facts_extracted");
    expect(events.map(e => e.type)).toContain("synthesis_complete");
    expect(events.map(e => e.type)).toContain("confidence_score");
    
    expect(hybridSearch).toHaveBeenCalled();
    expect(routeAndCollect).toHaveBeenCalled(); // Member responses + Synthesis
  });

  it("should handle conflicts and debate", async () => {
    vi.mocked(detectConflicts).mockResolvedValue([
      { agentA: "a1", agentB: "a2", claimA: "yes", claimB: "no", severity: "high", contradictionType: "direct" }
    ]);
    
    // Second call to routeAndCollect (rebuttal) returns concession
    vi.mocked(routeAndCollect)
      .mockResolvedValueOnce({ text: "initial", usage: { prompt_tokens: 1, completion_tokens: 1 } } as any) // a1
      .mockResolvedValueOnce({ text: "initial", usage: { prompt_tokens: 1, completion_tokens: 1 } } as any) // a2
      .mockResolvedValueOnce({ text: "I concede", usage: { prompt_tokens: 1, completion_tokens: 1 } } as any) // rebuttal
      .mockResolvedValueOnce({ text: "final synthesis", usage: { prompt_tokens: 1, completion_tokens: 1 } } as any); // synthesis

    const input = {
      query: "test query",
      conversationId: "conv1",
      members: mockMembers
    };

    const events = [];
    for await (const event of orchestrator.run(input)) {
      events.push(event);
    }

    expect(events.map(e => e.type)).toContain("conflicts_found");
    expect(events.map(e => e.type)).toContain("debate_exchange");
    expect(updateReliability).toHaveBeenCalled();
  });

  it("should handle human gates", async () => {
    vi.mocked(detectConflicts).mockResolvedValue([
      { agentA: "a1", agentB: "a2", claimA: "yes", claimB: "no", severity: "high", contradictionType: "direct" }
    ]);

    const input = {
      query: "test query",
      conversationId: "conv1",
      members: mockMembers,
      humanGates: true
    };

    const runPromise = (async () => {
      const evs = [];
      for await (const event of orchestrator.run(input)) {
        evs.push(event);
        if (event.type === "human_gate_pending") {
          const gateId = (event.data as any).gateId;
          // In a real scenario, this happens out of band
          setTimeout(() => resolveHumanGate(gateId, "Side with majority"), 10);
        }
      }
      return evs;
    })();

    const events = await runPromise;
    expect(events.map(e => e.type)).toContain("human_gate_pending");
    expect(events.map(e => e.type)).toContain("synthesis_complete");
  });

  it("should handle RAG failure gracefully", async () => {
    vi.mocked(hybridSearch).mockRejectedValue(new Error("Search failed"));
    
    const input = {
      query: "test query",
      conversationId: "conv1",
      members: [mockMembers[0]],
      kbId: "kb1"
    };

    const events = [];
    for await (const event of orchestrator.run(input)) {
      events.push(event);
    }
    expect(events.map(e => e.type)).toContain("preprocessing_complete");
  });
});

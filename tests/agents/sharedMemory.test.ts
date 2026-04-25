import { describe, it, expect, vi, beforeEach } from "vitest";
import { addFact, getFacts, confirmFact, disputeFact, getFactContext, extractAndStoreFacts } from "../../src/agents/sharedMemory.js";
import { db } from "../../src/lib/drizzle.js";
import { sharedFacts } from "../../src/db/schema/council.js";
import { routeAndCollect } from "../../src/router/index.js";

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "1", conversationId: "c1", content: "f1", sourceAgent: "a1", type: "fact", confidence: 0.9, confirmedBy: ["a1"], disputedBy: [] }])
      }))
    })),
    select: vi.fn(),
    update: vi.fn(),
  }
}));

vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: vi.fn()
}));

describe("Shared Memory Agent Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should add a fact", async () => {
    const fact = await addFact("c1", "content", "a1", "fact", 0.9);
    expect(fact.id).toBe("1");
    expect(db.insert).toHaveBeenCalled();
  });

  it("should get facts", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: "1" }])
    } as any);

    const facts = await getFacts("c1");
    expect(facts).toHaveLength(1);
    expect(facts[0].id).toBe("1");
  });

  it("should confirm a fact and handle missing", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: "1", confirmedBy: ["a1"], disputedBy: ["a2"] }])
    } as any);
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([])
    } as any);

    await confirmFact("1", "a3");
    expect(db.update).toHaveBeenCalled();

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([])
    } as any);
    await confirmFact("missing", "a1");
    expect(db.update).toHaveBeenCalledTimes(1); // not called again
  });

  it("should dispute a fact and handle missing", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: "1", confirmedBy: ["a1"], disputedBy: [] }])
    } as any);
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([])
    } as any);

    await disputeFact("1", "a1");
    expect(db.update).toHaveBeenCalled();

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([])
    } as any);
    await disputeFact("missing", "a1");
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("should generate fact context", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { type: "fact", confidence: 0.9, content: "f1", confirmedBy: ["a1", "a2"], disputedBy: [] },
        { type: "decision", confidence: 0.8, content: "d1", confirmedBy: ["a1"], disputedBy: ["a2"] }
      ])
    } as any);

    const context = await getFactContext("c1");
    expect(context).toContain("[SHARED FACTS]");
    expect(context).toContain("CONFIRMED");
    expect(context).toContain("DISPUTED");
  });

  it("should extract and store facts from response", async () => {
    vi.mocked(routeAndCollect).mockResolvedValue({
      text: 'Here are the facts: [{"content": "fact1", "type": "fact", "confidence": 0.9}]',
      tokens: { prompt: 10, completion: 10, total: 20 },
      model: "test-model"
    } as any);

    const stored = await extractAndStoreFacts("c1", "a1", "some response text");
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe("f1"); // because our addFact mock returns f1
  });

  it("should handle extraction failure or invalid JSON", async () => {
    vi.mocked(routeAndCollect).mockResolvedValue({
      text: 'No JSON here',
      tokens: { prompt: 10, completion: 10, total: 20 },
      model: "test-model"
    } as any);
    const stored = await extractAndStoreFacts("c1", "a1", "text");
    expect(stored).toEqual([]);

    vi.mocked(routeAndCollect).mockResolvedValue({
      text: '[{"invalid": "json"}', // missing bracket
      tokens: { prompt: 10, completion: 10, total: 20 },
      model: "test-model"
    } as any);
    expect(await extractAndStoreFacts("c1", "a1", "text")).toEqual([]);
  });
});

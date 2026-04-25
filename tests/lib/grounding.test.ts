import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../src/lib/providers.js", () => ({
  askProvider: vi.fn(),
}));
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    warn: vi.fn(),
  },
}));

describe("GroundingModule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should verify grounding and return true if response is grounded", async () => {
    const { groundingModule } = await import("../../src/lib/grounding.js");
    const { askProvider } = await import("../../src/lib/providers.js");

    vi.mocked(askProvider).mockResolvedValue({
      text: JSON.stringify({
        claims_extracted: ["Claim 1"],
        unsupported_claims: [],
        grounded: true
      })
    } as any);

    const result = await groundingModule.verify(
      { answer: "Target" } as any,
      [{ answer: "Context" }] as any,
      {} as any
    );

    expect(result.grounded).toBe(true);
    expect(result.unsupported_claims).toHaveLength(0);
  });

  it("should return unsupported claims if response has contradictions", async () => {
    const { groundingModule } = await import("../../src/lib/grounding.js");
    const { askProvider } = await import("../../src/lib/providers.js");

    vi.mocked(askProvider).mockResolvedValue({
      text: JSON.stringify({
        claims_extracted: ["Claim 1"],
        unsupported_claims: [],
        contradicted_claims: ["Claim 1 is wrong"],
        grounded: false
      })
    } as any);

    const result = await groundingModule.verify(
      { answer: "Target" } as any,
      [{ answer: "Context" }] as any,
      {} as any
    );

    expect(result.grounded).toBe(false);
    expect(result.unsupported_claims).toContain("Claim 1 is wrong");
  });

  it("should fail closed on JSON parsing errors", async () => {
    const { groundingModule } = await import("../../src/lib/grounding.js");
    const { askProvider } = await import("../../src/lib/providers.js");

    vi.mocked(askProvider).mockResolvedValue({ text: "Not JSON" } as any);

    const result = await groundingModule.verify(
      { answer: "Target" } as any,
      [{ answer: "Context" }] as any,
      {} as any
    );

    expect(result.grounded).toBe(false);
    expect(result.unsupported_claims.length).toBeGreaterThan(0);
  });

  it("should fail closed on provider errors", async () => {
    const { groundingModule } = await import("../../src/lib/grounding.js");
    const { askProvider } = await import("../../src/lib/providers.js");

    vi.mocked(askProvider).mockRejectedValue(new Error("Down"));

    const result = await groundingModule.verify(
      { answer: "Target" } as any,
      [{ answer: "Context" }] as any,
      {} as any
    );

    expect(result.grounded).toBe(false);
    expect(result.unsupported_claims.length).toBeGreaterThan(0);
  });
});

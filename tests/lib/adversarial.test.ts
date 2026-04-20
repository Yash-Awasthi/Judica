import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock providers
vi.mock("../../src/lib/providers.js", () => ({
  askProvider: vi.fn(),
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { warn: vi.fn() }
}));

describe("Adversarial Module", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const mockOutput = {
    answer: "The sky is blue.",
    reasoning: "Rayleigh scattering."
  } as any;

  const mockProvider = { name: "test-provider" } as any;

  it("should return parsed results on success", async () => {
    const { askProvider } = await import("../../src/lib/providers.js");
    const { adversarialModule } = await import("../../src/lib/adversarial.js");

    (askProvider as any).mockResolvedValue({
      text: JSON.stringify({
        counter_arguments: ["It can be red"],
        edge_cases: ["Total darkness"],
        stress_score: 0.8,
        is_robust: false
      })
    });

    const result = await adversarialModule.challenge(mockOutput, mockProvider);

    expect(result.is_robust).toBe(false);
    expect(result.stress_score).toBe(0.8);
    expect(result.failures).toContain("It can be red");
    expect(result.failures).toContain("Total darkness");
  });

  it("should handle partial JSON and extra text", async () => {
    const { askProvider } = await import("../../src/lib/providers.js");
    const { adversarialModule } = await import("../../src/lib/adversarial.js");

    (askProvider as any).mockResolvedValue({
      text: "Sure, here is the result: " + JSON.stringify({
        is_robust: true,
        stress_score: 0.2
      }) + " Hope that helps!"
    });

    const result = await adversarialModule.challenge(mockOutput, mockProvider);
    expect(result.is_robust).toBe(true);
    expect(result.stress_score).toBe(0.2);
  });

  it("should fail closed on JSON parse failure", async () => {
    const { askProvider } = await import("../../src/lib/providers.js");
    const { adversarialModule } = await import("../../src/lib/adversarial.js");

    (askProvider as any).mockResolvedValue({
      text: "Not a JSON"
    });

    const result = await adversarialModule.challenge(mockOutput, mockProvider);
    expect(result.is_robust).toBe(false);
    expect(result.stress_score).toBe(0.5);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("should fail closed on provider errors", async () => {
    const { askProvider } = await import("../../src/lib/providers.js");
    const { adversarialModule } = await import("../../src/lib/adversarial.js");
    const { default: logger } = await import("../../src/lib/logger.js");

    (askProvider as any).mockRejectedValue(new Error("Network fail"));

    const result = await adversarialModule.challenge(mockOutput, mockProvider);
    expect(result.is_robust).toBe(false);
    expect(result.stress_score).toBe(0.5);
    expect(logger.warn).toHaveBeenCalled();
  });
});

import { describe, it, expect } from "vitest";

describe("Templates", () => {
  it("should have expected predefined templates", async () => {
    const { TEMPLATES } = await import("../../src/lib/templates.js");
    
    expect(TEMPLATES).toBeDefined();
    expect(TEMPLATES.length).toBeGreaterThan(0);
    
    const debate = TEMPLATES.find(t => t.id === "debate");
    expect(debate).toBeDefined();
    expect(debate?.members.length).toBe(3);
    expect(debate?.masterPrompt).toContain("neutral judge");
  });
});

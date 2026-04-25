import { describe, it, expect } from "vitest";
import { DeliberationController, createController } from "../../src/lib/controller.js";

describe("DeliberationController", () => {
  it("should create a new controller instance", () => {
    const controller = createController();
    expect(controller).toBeInstanceOf(DeliberationController);
  });

  describe("decide", () => {
    it("should halt if consensus threshold reached", () => {
      const controller = new DeliberationController();
      const decision = controller.decide(1, 5, 0.9);
      expect(decision.shouldHalt).toBe(true);
      expect(decision.reason).toContain("reached deterministic threshold");
      expect(decision.selectTopK).toBe(3);
    });

    it("should halt if max rounds reached", () => {
      const controller = new DeliberationController();
      const decision = controller.decide(5, 5, 0.3);
      expect(decision.shouldHalt).toBe(true);
      expect(decision.reason).toContain("Maximum rounds reached");
      expect(decision.selectTopK).toBe(5);
    });

    it("should continue if mid-deliberation", () => {
      const controller = new DeliberationController();
      const decision = controller.decide(1, 5, 0.5);
      expect(decision.shouldHalt).toBe(false);
      expect(decision.selectTopK).toBe(0);
    });
  });

  describe("shouldAcceptRound", () => {
    it("should reject round if no improvement in score", () => {
      const controller = new DeliberationController();
      const opinions: any[] = [{ scores: { final: 0.5 } }];
      
      expect(controller.shouldAcceptRound(opinions)).toBe(true); // First round max 0.5 > 0
      expect(controller.shouldAcceptRound(opinions)).toBe(false); // Second round max 0.5 not > 0.5
    });

    it("should reject round if any critical failures", () => {
      const controller = new DeliberationController();
      const opinions: any[] = [
        { scores: { final: 0.9 } },
        { scores: { final: 0.1 } } // Critical failure
      ];
      expect(controller.shouldAcceptRound(opinions)).toBe(false);
    });
    
    it("should accept round if improvement and no failures", () => {
      const controller = new DeliberationController();
      controller.shouldAcceptRound([{ scores: { final: 0.5 } }] as any);
      expect(controller.shouldAcceptRound([{ scores: { final: 0.6 } }] as any)).toBe(true);
    });
  });

  describe("selectTopK", () => {
    it("should select and sort top K opinions above threshold", () => {
      const controller = new DeliberationController();
      const opinions: any[] = [
        { id: "1", scores: { final: 0.4 } }, // Below outlier threshold
        { id: "2", scores: { final: 0.9 } },
        { id: "3", scores: { final: 0.7 } },
        { id: "4", scores: { final: 0.8 } }
      ];

      const result = controller.selectTopK(opinions, 2);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("2");
      expect(result[1].id).toBe("4");
    });
  });

  it("should reset state", () => {
    const controller = new DeliberationController();
    controller.shouldAcceptRound([{ scores: { final: 0.5 } }] as any);
    expect(controller.shouldAcceptRound([{ scores: { final: 0.5 } }] as any)).toBe(false);
    
    controller.reset();
    expect(controller.shouldAcceptRound([{ scores: { final: 0.5 } }] as any)).toBe(true);
  });
});

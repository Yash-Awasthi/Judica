import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

// Mock router
const mockRouteAndCollect = vi.fn();
vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: (...args: unknown[]) => mockRouteAndCollect(...args),
}));

import {
  analyzeImage,
  detectImageType,
  crossModalAnalysis,
  prepareImageContext,
  type ImageAnalysis,
  type MultiModalInput,
} from "../../src/services/imageAware.service.js";

describe("imageAware.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectImageType", () => {
    it("should detect screenshots", () => {
      expect(detectImageType("screenshot_2024.png")).toBe("screenshot");
      expect(detectImageType("screen-cap-login.png")).toBe("screenshot");
    });

    it("should detect diagrams", () => {
      expect(detectImageType("architecture-diagram.png")).toBe("diagram");
      expect(detectImageType("uml_classes.svg")).toBe("diagram");
      expect(detectImageType("flowchart.png")).toBe("diagram");
    });

    it("should detect photos", () => {
      expect(detectImageType("photo.jpg")).toBe("photo");
      expect(detectImageType("image.jpeg")).toBe("photo");
      expect(detectImageType("raw_file.heic")).toBe("photo");
    });

    it("should detect documents", () => {
      expect(detectImageType("report.pdf")).toBe("document");
      expect(detectImageType("data.xlsx")).toBe("document");
    });

    it("should detect UI-related PNGs as screenshots", () => {
      expect(detectImageType("modal-ui.png")).toBe("screenshot");
      expect(detectImageType("button-component.png")).toBe("screenshot");
    });

    it("should return unknown for ambiguous files", () => {
      expect(detectImageType("random.png")).toBe("unknown");
      expect(detectImageType("file.webp")).toBe("unknown");
    });
  });

  describe("analyzeImage", () => {
    it("should analyze an image and return structured data", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          description: "A login form with email and password fields",
          elements: [
            { type: "screenshot", description: "Login form UI" },
            { type: "text", description: "Submit button label" },
          ],
          text: ["Sign In", "Email", "Password"],
          sentiment: "neutral",
          relevance: "Shows the current login page design",
        }),
      });

      const result = await analyzeImage("base64data...", "Reviewing the login page");

      expect(result.description).toContain("login");
      expect(result.elements).toHaveLength(2);
      expect(result.text).toContain("Sign In");
      expect(result.sentiment).toBe("neutral");
    });

    it("should return fallback on failure", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const result = await analyzeImage("data");

      expect(result.description).toContain("failed");
      expect(result.elements).toHaveLength(0);
    });
  });

  describe("crossModalAnalysis", () => {
    it("should find cross-modal insights", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify([
          {
            source: "Text spec + Screenshot",
            finding: "The spec says the button should be blue, but the screenshot shows it as green",
            confidence: 0.9,
            contradiction: true,
            relatedInputs: ["Design Spec", "Current UI"],
          },
          {
            source: "Screenshot",
            finding: "The layout matches the wireframe",
            confidence: 0.85,
            contradiction: false,
            relatedInputs: ["Current UI"],
          },
        ]),
      });

      const inputs: MultiModalInput[] = [
        { type: "text", content: "Button should be blue (#0066FF)", label: "Design Spec" },
        { type: "image", content: "base64screenshot...", label: "Current UI" },
      ];

      const insights = await crossModalAnalysis(inputs, "Does the UI match the spec?");

      expect(insights).toHaveLength(2);
      expect(insights[0].contradiction).toBe(true);
      expect(insights[0].confidence).toBe(0.9);
      expect(insights[1].contradiction).toBe(false);
    });

    it("should return empty on failure", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const insights = await crossModalAnalysis([], "question");
      expect(insights).toHaveLength(0);
    });
  });

  describe("prepareImageContext", () => {
    it("should format analyses into context string", () => {
      const analyses = [
        {
          filename: "dashboard.png",
          analysis: {
            description: "Admin dashboard showing user metrics",
            elements: [
              { type: "chart" as const, description: "Bar chart of monthly signups" },
              { type: "table" as const, description: "Top users table" },
            ],
            text: ["Total Users: 1,234"],
            relevance: "Shows current user growth",
          },
        },
      ];

      const context = prepareImageContext(analyses);

      expect(context).toContain("Visual Context");
      expect(context).toContain("dashboard.png");
      expect(context).toContain("Admin dashboard");
      expect(context).toContain("[chart]");
      expect(context).toContain("Total Users: 1,234");
    });

    it("should return empty string for no analyses", () => {
      expect(prepareImageContext([])).toBe("");
    });

    it("should handle analyses without text content", () => {
      const analyses = [
        {
          filename: "icon.svg",
          analysis: {
            description: "An app icon",
            elements: [{ type: "icon" as const, description: "Blue circle icon" }],
            text: [],
            relevance: "App branding",
          },
        },
      ];

      const context = prepareImageContext(analyses);

      expect(context).toContain("icon.svg");
      expect(context).not.toContain("Text found:");
    });
  });
});

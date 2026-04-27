import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDemoConfig, formatDemoSection } from "../../src/services/demo.service.js";
import type { DemoConfig } from "../../src/services/demo.service.js";

describe("Demo Service", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DEMO_URL;
    delete process.env.DEMO_VIDEO_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getDemoConfig", () => {
    it("returns default URL when DEMO_URL is not set", () => {
      const config = getDemoConfig();
      expect(config.url).toBe("https://judica.example.com");
    });

    it("respects DEMO_URL env variable", () => {
      process.env.DEMO_URL = "https://custom-demo.example.com";
      const config = getDemoConfig();
      expect(config.url).toBe("https://custom-demo.example.com");
    });

    it("returns undefined videoUrl when DEMO_VIDEO_URL is not set", () => {
      const config = getDemoConfig();
      expect(config.videoUrl).toBeUndefined();
    });

    it("returns videoUrl from DEMO_VIDEO_URL env variable", () => {
      process.env.DEMO_VIDEO_URL = "https://video.example.com/demo.mp4";
      const config = getDemoConfig();
      expect(config.videoUrl).toBe("https://video.example.com/demo.mp4");
    });

    it("returns a non-empty features array", () => {
      const config = getDemoConfig();
      expect(config.features).toBeInstanceOf(Array);
      expect(config.features.length).toBeGreaterThan(0);
    });

    it("includes expected feature keywords", () => {
      const config = getDemoConfig();
      const joined = config.features.join(" ");
      expect(joined).toContain("LLM");
      expect(joined).toContain("vector");
    });

    it("returns a description string", () => {
      const config = getDemoConfig();
      expect(config.description).toBeTruthy();
      expect(typeof config.description).toBe("string");
    });

    it("returns lastUpdated in YYYY-MM-DD format", () => {
      const config = getDemoConfig();
      expect(config.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns today's date as lastUpdated", () => {
      const config = getDemoConfig();
      const today = new Date().toISOString().split("T")[0];
      expect(config.lastUpdated).toBe(today);
    });
  });

  describe("formatDemoSection", () => {
    const baseConfig: DemoConfig = {
      url: "https://judica.example.com",
      description: "Test description",
      features: ["Feature one", "Feature two"],
      lastUpdated: "2025-01-01",
    };

    it("includes ## Demo heading", () => {
      const output = formatDemoSection(baseConfig);
      expect(output).toContain("## Demo");
    });

    it("includes the escaped URL in a Live link", () => {
      const output = formatDemoSection(baseConfig);
      expect(output).toContain("**Live:**");
      // URL should be present (escaped form)
      expect(output).toContain("judica.example.com");
    });

    it("includes video URL when present", () => {
      const config: DemoConfig = {
        ...baseConfig,
        videoUrl: "https://video.example.com/demo",
      };
      const output = formatDemoSection(config);
      expect(output).toContain("**Video walkthrough:**");
      expect(output).toContain("Watch demo");
      expect(output).toContain("video.example.com");
    });

    it("excludes video section when videoUrl is absent", () => {
      const output = formatDemoSection(baseConfig);
      expect(output).not.toContain("Video walkthrough");
      expect(output).not.toContain("Watch demo");
    });

    it("lists all features as bullet points", () => {
      const output = formatDemoSection(baseConfig);
      expect(output).toContain("- Feature one");
      expect(output).toContain("- Feature two");
    });

    it("includes Features heading", () => {
      const output = formatDemoSection(baseConfig);
      expect(output).toContain("### Features");
    });

    it("includes the description text", () => {
      const output = formatDemoSection(baseConfig);
      expect(output).toContain("Test description");
    });

    it("escapes markdown special characters in URLs", () => {
      const config: DemoConfig = {
        ...baseConfig,
        url: "https://example.com/path(with)parens[and]brackets",
      };
      const output = formatDemoSection(config);
      // Parens and brackets should be escaped with backslashes
      expect(output).toContain("\\(");
      expect(output).toContain("\\)");
      expect(output).toContain("\\[");
      expect(output).toContain("\\]");
    });

    it("escapes backticks and asterisks in URLs", () => {
      const config: DemoConfig = {
        ...baseConfig,
        url: "https://example.com/path*with`special_chars",
      };
      const output = formatDemoSection(config);
      expect(output).toContain("\\*");
      expect(output).toContain("\\`");
      expect(output).toContain("\\_");
    });

    it("escapes hash and pipe in URLs", () => {
      const config: DemoConfig = {
        ...baseConfig,
        url: "https://example.com/path#hash|pipe",
      };
      const output = formatDemoSection(config);
      expect(output).toContain("\\#");
      expect(output).toContain("\\|");
    });

    it("handles empty features array", () => {
      const config: DemoConfig = { ...baseConfig, features: [] };
      const output = formatDemoSection(config);
      expect(output).toContain("## Demo");
      expect(output).toContain("### Features");
    });

    it("escapes plus and tilde in URLs", () => {
      const config: DemoConfig = {
        ...baseConfig,
        url: "https://example.com/a+b~c",
      };
      const output = formatDemoSection(config);
      expect(output).toContain("\\+");
      expect(output).toContain("\\~");
    });

    it("escapes exclamation mark and greater-than in URLs", () => {
      const config: DemoConfig = {
        ...baseConfig,
        url: "https://example.com/path!with>chars",
      };
      const output = formatDemoSection(config);
      expect(output).toContain("\\!");
      expect(output).toContain("\\>");
    });

    it("escapes curly braces in URLs", () => {
      const config: DemoConfig = {
        ...baseConfig,
        url: "https://example.com/{id}",
      };
      const output = formatDemoSection(config);
      expect(output).toContain("\\{");
      expect(output).toContain("\\}");
    });

    it("escapes backslash in URLs", () => {
      const config: DemoConfig = {
        ...baseConfig,
        url: "https://example.com\\path",
      };
      const output = formatDemoSection(config);
      expect(output).toContain("\\\\");
    });

    it("escapes hyphen/minus in URLs", () => {
      const config: DemoConfig = {
        ...baseConfig,
        url: "https://example.com/a-b",
      };
      const output = formatDemoSection(config);
      expect(output).toContain("\\-");
    });
  });
});

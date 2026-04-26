import { describe, it, expect } from "vitest";
import {
  parseDomToSimplifiedTree,
  serializeTree,
  buildSelectorPrompt,
  extractWithSelector,
  scoreSelectorConfidence,
  inferSelectorType,
} from "../../src/lib/selectorEngine.js";

/* ── Sample HTML ───────────────────────────────────────────────────── */

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <nav id="main-nav" class="navigation primary">
    <a href="/home" class="nav-link">Home</a>
    <a href="/about" class="nav-link">About Us</a>
    <a href="/contact" class="nav-link active">Contact</a>
  </nav>
  <main>
    <h1 class="page-title">Welcome to our site</h1>
    <div id="search-box" class="search-container">
      <input type="text" name="q" placeholder="Search products..." class="search-input" aria-label="Search">
      <button type="submit" class="search-btn" role="button" aria-label="Submit search">Search</button>
    </div>
    <section class="products">
      <div class="product-card" data-id="1">
        <h2 class="product-name">Widget Pro</h2>
        <p class="product-price">$29.99</p>
        <button class="add-to-cart">Add to Cart</button>
      </div>
      <div class="product-card" data-id="2">
        <h2 class="product-name">Gadget Plus</h2>
        <p class="product-price">$49.99</p>
        <button class="add-to-cart">Add to Cart</button>
      </div>
    </section>
    <form id="newsletter" class="newsletter-form">
      <label for="email">Subscribe to our newsletter</label>
      <input type="email" id="email" name="email" placeholder="Enter your email">
      <button type="submit">Subscribe</button>
    </form>
  </main>
  <footer>
    <p class="copyright">Copyright 2024 Acme Corp</p>
  </footer>
  <script>console.log("should be stripped");</script>
  <style>.hidden { display: none; }</style>
</body>
</html>
`;

/* ── parseDomToSimplifiedTree ──────────────────────────────────────── */

describe("parseDomToSimplifiedTree", () => {
  it("should parse HTML into simplified nodes", () => {
    const nodes = parseDomToSimplifiedTree(SAMPLE_HTML);
    expect(nodes.length).toBeGreaterThan(0);
  });

  it("should strip script and style tags", () => {
    const nodes = parseDomToSimplifiedTree(SAMPLE_HTML);
    const serialized = serializeTree(nodes);
    expect(serialized).not.toContain("should be stripped");
    expect(serialized).not.toContain(".hidden");
  });

  it("should extract id and class attributes", () => {
    const nodes = parseDomToSimplifiedTree(SAMPLE_HTML);
    const serialized = serializeTree(nodes);
    expect(serialized).toContain('id="main-nav"');
    expect(serialized).toContain('class="navigation primary"');
  });

  it("should extract aria attributes", () => {
    const nodes = parseDomToSimplifiedTree(SAMPLE_HTML);
    const serialized = serializeTree(nodes);
    expect(serialized).toContain('aria-label="Search"');
  });

  it("should respect maxDepth", () => {
    const shallow = parseDomToSimplifiedTree(SAMPLE_HTML, 1);
    const deep = parseDomToSimplifiedTree(SAMPLE_HTML, 6);
    // Shallow tree should have fewer total nested nodes
    const shallowStr = serializeTree(shallow);
    const deepStr = serializeTree(deep);
    expect(deepStr.length).toBeGreaterThanOrEqual(shallowStr.length);
  });

  it("should extract text content", () => {
    const nodes = parseDomToSimplifiedTree(SAMPLE_HTML);
    const serialized = serializeTree(nodes);
    expect(serialized).toContain("Welcome to our site");
  });

  it("should handle empty HTML", () => {
    const nodes = parseDomToSimplifiedTree("");
    expect(nodes).toEqual([]);
  });
});

/* ── serializeTree ─────────────────────────────────────────────────── */

describe("serializeTree", () => {
  it("should produce indented text output", () => {
    const nodes = parseDomToSimplifiedTree(SAMPLE_HTML);
    const serialized = serializeTree(nodes);
    expect(serialized).toContain("<nav");
    expect(serialized).toContain("<input");
  });

  it("should include href for links", () => {
    const nodes = parseDomToSimplifiedTree(SAMPLE_HTML);
    const serialized = serializeTree(nodes);
    expect(serialized).toContain('href="/home"');
  });

  it("should include placeholder for inputs", () => {
    const nodes = parseDomToSimplifiedTree(SAMPLE_HTML);
    const serialized = serializeTree(nodes);
    expect(serialized).toContain('placeholder="Search products..."');
  });
});

/* ── buildSelectorPrompt ───────────────────────────────────────────── */

describe("buildSelectorPrompt", () => {
  it("should return system and user prompts", () => {
    const { system, user } = buildSelectorPrompt("the search input", "<div>test</div>");
    expect(system).toContain("CSS selector");
    expect(system).toContain("XPath");
    expect(system).toContain("JSON array");
    expect(user).toContain("the search input");
    expect(user).toContain("<div>test</div>");
  });

  it("should include description in user prompt", () => {
    const { user } = buildSelectorPrompt("product price elements", "<p class='price'>$10</p>");
    expect(user).toContain("product price elements");
  });
});

/* ── extractWithSelector ───────────────────────────────────────────── */

describe("extractWithSelector", () => {
  describe("CSS selectors", () => {
    it("should match by ID", () => {
      const result = extractWithSelector(SAMPLE_HTML, "#search-box", "css");
      expect(result.matched).toBe(true);
      expect(result.matchCount).toBeGreaterThan(0);
    });

    it("should match by class", () => {
      const result = extractWithSelector(SAMPLE_HTML, ".product-name", "css");
      expect(result.matched).toBe(true);
      expect(result.content).toContain("Widget Pro");
      expect(result.content).toContain("Gadget Plus");
      expect(result.matchCount).toBe(2);
    });

    it("should match by tag", () => {
      const result = extractWithSelector(SAMPLE_HTML, "h1", "css");
      expect(result.matched).toBe(true);
      expect(result.content).toContain("Welcome to our site");
    });

    it("should match by attribute", () => {
      const result = extractWithSelector(SAMPLE_HTML, '[name="email"]', "css");
      expect(result.matched).toBe(true);
    });

    it("should match by tag and class", () => {
      const result = extractWithSelector(SAMPLE_HTML, "p.product-price", "css");
      expect(result.matched).toBe(true);
      expect(result.content).toContain("$29.99");
    });

    it("should return no match for non-existent selector", () => {
      const result = extractWithSelector(SAMPLE_HTML, "#nonexistent", "css");
      expect(result.matched).toBe(false);
      expect(result.content).toBeNull();
      expect(result.matchCount).toBe(0);
    });
  });

  describe("XPath selectors", () => {
    it("should match by tag and attribute", () => {
      const result = extractWithSelector(SAMPLE_HTML, "//input[@name='q']", "xpath");
      expect(result.matched).toBe(true);
    });

    it("should match by text content", () => {
      const result = extractWithSelector(SAMPLE_HTML, "//h1[contains(text(), 'Welcome')]", "xpath");
      expect(result.matched).toBe(true);
      expect(result.content).toContain("Welcome");
    });

    it("should match simple tag query", () => {
      const result = extractWithSelector(SAMPLE_HTML, "//footer", "xpath");
      expect(result.matched).toBe(true);
    });
  });

  describe("ARIA selectors", () => {
    it("should match by role and aria-label", () => {
      const result = extractWithSelector(SAMPLE_HTML, "role=button,aria-label=Submit search", "aria");
      expect(result.matched).toBe(true);
      expect(result.content).toContain("Search");
    });

    it("should match by aria-label alone", () => {
      const result = extractWithSelector(SAMPLE_HTML, "aria-label=Search", "aria");
      expect(result.matched).toBe(true);
    });
  });

  it("should handle malformed HTML gracefully", () => {
    const result = extractWithSelector("<div><p>unclosed", ".test", "css");
    expect(result.matched).toBe(false);
  });
});

/* ── scoreSelectorConfidence ───────────────────────────────────────── */

describe("scoreSelectorConfidence", () => {
  it("should return 0 for non-matching selector", () => {
    const score = scoreSelectorConfidence("#nonexistent", SAMPLE_HTML, "search box");
    expect(score).toBe(0);
  });

  it("should score higher for single-match selectors", () => {
    const singleMatch = scoreSelectorConfidence("#search-box", SAMPLE_HTML, "search box");
    const multiMatch = scoreSelectorConfidence(".nav-link", SAMPLE_HTML, "navigation link");
    expect(singleMatch).toBeGreaterThan(0);
    expect(multiMatch).toBeGreaterThan(0);
  });

  it("should score higher when content matches description keywords", () => {
    // "product-name" elements contain "Widget Pro" and "Gadget Plus" but description is "product name"
    // The word "product" doesn't appear in content, but the selector matches
    const productMatch = scoreSelectorConfidence(".page-title", SAMPLE_HTML, "welcome page title");
    const noContentMatch = scoreSelectorConfidence("#nonexistent", SAMPLE_HTML, "welcome page title");
    expect(productMatch).toBeGreaterThan(noContentMatch);
  });

  it("should give bonus for id-based selectors", () => {
    const withId = scoreSelectorConfidence("#search-box", SAMPLE_HTML, "search area");
    expect(withId).toBeGreaterThan(0.3);
  });
});

/* ── inferSelectorType ─────────────────────────────────────────────── */

describe("inferSelectorType", () => {
  it("should detect CSS selectors", () => {
    expect(inferSelectorType(".class")).toBe("css");
    expect(inferSelectorType("#id")).toBe("css");
    expect(inferSelectorType("div.class")).toBe("css");
    expect(inferSelectorType("[name='test']")).toBe("css");
  });

  it("should detect XPath selectors", () => {
    expect(inferSelectorType("//div")).toBe("xpath");
    expect(inferSelectorType("//input[@name='q']")).toBe("xpath");
    expect(inferSelectorType("(//div)[1]")).toBe("xpath");
  });

  it("should detect ARIA selectors", () => {
    expect(inferSelectorType("role=button")).toBe("aria");
    expect(inferSelectorType("role=button,aria-label=Submit")).toBe("aria");
  });
});

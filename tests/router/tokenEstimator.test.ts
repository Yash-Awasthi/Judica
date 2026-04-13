import { describe, it, expect } from "vitest";
import { estimateStringTokens, estimateTokens } from "../../src/router/tokenEstimator.js";
import type { AdapterMessage } from "../../src/adapters/types.js";

describe("estimateStringTokens", () => {
  it("should return 0 for empty string", () => {
    expect(estimateStringTokens("")).toBe(0);
  });

  it("should estimate ASCII text at ~4 chars per token", () => {
    // 20 ASCII chars -> 20/4 = 5 tokens
    const result = estimateStringTokens("abcdefghijklmnopqrst");
    expect(result).toBe(5);
  });

  it("should estimate CJK text at ~1.5 chars per token", () => {
    // 3 CJK chars -> 3/1.5 = 2 tokens
    const result = estimateStringTokens("\u4f60\u597d\u5417");
    expect(result).toBe(2);
  });

  it("should estimate other non-ASCII at ~2 chars per token", () => {
    // Cyrillic: 4 chars -> 4/2 = 2 tokens
    const result = estimateStringTokens("\u0410\u0411\u0412\u0413");
    expect(result).toBe(2);
  });

  it("should blend ratios for mixed content", () => {
    // "Hello" (5 ASCII) + 2 CJK chars
    // 5/4 + 2/1.5 = 1.25 + 1.333 = 2.583 -> ceil = 3
    const result = estimateStringTokens("Hello\u4f60\u597d");
    expect(result).toBe(3);
  });

  it("should handle a long English sentence", () => {
    const text = "The quick brown fox jumps over the lazy dog"; // 43 chars
    const result = estimateStringTokens(text);
    // 43/4 = 10.75 -> ceil = 11
    expect(result).toBe(11);
  });
});

describe("estimateTokens", () => {
  it("should return overhead only for empty messages array", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("should estimate tokens for string content messages", () => {
    const messages: AdapterMessage[] = [
      { role: "user", content: "Hello world" }, // 11 ASCII chars -> 11/4 = 2.75 -> ceil 3
    ];
    const result = estimateTokens(messages);
    // 3 tokens + 1*4 overhead = 7
    expect(result).toBe(7);
  });

  it("should add 4 tokens overhead per message", () => {
    const messages: AdapterMessage[] = [
      { role: "system", content: "" },
      { role: "user", content: "" },
      { role: "assistant", content: "" },
    ];
    // 0 content tokens + 3*4 = 12 overhead
    expect(estimateTokens(messages)).toBe(12);
  });

  it("should handle array content with text blocks", () => {
    const messages: AdapterMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Hello world" }, // 3 tokens
        ],
      },
    ];
    const result = estimateTokens(messages);
    // 3 + 1*4 = 7
    expect(result).toBe(7);
  });

  it("should add 200 tokens for image blocks", () => {
    const messages: AdapterMessage[] = [
      {
        role: "user",
        content: [
          { type: "image_base64", data: "abc" },
        ],
      },
    ];
    const result = estimateTokens(messages);
    // 200 (image) + 1*4 = 204
    expect(result).toBe(204);
  });

  it("should add 200 tokens for image_url blocks", () => {
    const messages: AdapterMessage[] = [
      {
        role: "user",
        content: [
          { type: "image_url", url: "https://example.com/img.png" },
        ],
      },
    ];
    const result = estimateTokens(messages);
    expect(result).toBe(204);
  });

  it("should estimate tool_calls overhead", () => {
    const messages: AdapterMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "tc1", name: "search", arguments: { query: "test" } },
        ],
      },
    ];
    const result = estimateTokens(messages);
    // tool call: estimateStringTokens("search" + JSON.stringify({query:"test"}))
    // "search{\"query\":\"test\"}" = 23 chars -> 23/4 = 5.75 -> ceil = 6
    // 0 (empty content) + 6 (tool) + 4 (overhead) = 10
    expect(result).toBe(10);
  });

  it("should combine text, images, and tool calls", () => {
    const messages: AdapterMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this" }, // 13/4=3.25 -> ceil 4
          { type: "image_base64", data: "..." }, // 200
        ],
      },
      {
        role: "assistant",
        content: "Here is my analysis", // 19/4 = 4.75 -> ceil 5
        tool_calls: [
          { id: "t1", name: "fn", arguments: {} },
        ],
      },
    ];
    const result = estimateTokens(messages);
    // msg1: 4 + 200 = 204
    // msg2 content: 5, tool: estimateStringTokens("fn{}") = "fn{}" 4 chars -> 4/4=1 -> ceil 1
    // msg2: 5 + 1 = 6
    // overhead: 2*4 = 8
    // total: 204 + 6 + 8 = 218
    expect(result).toBe(218);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/providers/concrete/openai.js", () => {
  const OpenAIProvider = vi.fn().mockImplementation(function (this: any, config: any) {
    this.name = config.name;
    this.type = "openai";
    this.call = vi.fn();
  });
  return { OpenAIProvider };
});

vi.mock("../../../src/lib/providers/concrete/anthropic.js", () => {
  const AnthropicProvider = vi.fn().mockImplementation(function (this: any, config: any) {
    this.name = config.name;
    this.type = "anthropic";
    this.call = vi.fn();
  });
  return { AnthropicProvider };
});

vi.mock("../../../src/lib/providers/concrete/google.js", () => {
  const GoogleProvider = vi.fn().mockImplementation(function (this: any, config: any) {
    this.name = config.name;
    this.type = "google";
    this.call = vi.fn();
  });
  return { GoogleProvider };
});

vi.mock("../../../src/lib/providers/concrete/ollama.js", () => {
  const OllamaProvider = vi.fn().mockImplementation(function (this: any, config: any) {
    this.name = config.name;
    this.type = "ollama";
    this.call = vi.fn();
  });
  return { OllamaProvider };
});

vi.mock("../../../src/lib/providers/concrete/rpa.js", () => {
  const RPAProvider = vi.fn().mockImplementation(function (this: any, config: any) {
    this.name = config.name;
    this.type = "rpa";
    this.call = vi.fn();
  });
  return { RPAProvider };
});

vi.mock("../../../src/lib/crypto.js", () => ({
  decrypt: vi.fn((val: string) => val),
  isEncrypted: vi.fn(() => false),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createProvider } from "../../../src/lib/providers/factory.js";
import { OpenAIProvider } from "../../../src/lib/providers/concrete/openai.js";
import { AnthropicProvider } from "../../../src/lib/providers/concrete/anthropic.js";
import { GoogleProvider } from "../../../src/lib/providers/concrete/google.js";
import { OllamaProvider } from "../../../src/lib/providers/concrete/ollama.js";

describe("Provider Factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates OpenAI provider for openai provider field", () => {
    const config = {
      name: "test-openai",
      type: "api" as const,
      provider: "openai" as const,
      apiKey: "sk-test",
      model: "gpt-4",
    };
    const provider = createProvider(config);
    expect(OpenAIProvider).toHaveBeenCalledWith(expect.objectContaining({ name: "test-openai" }));
    expect(provider).toBeDefined();
  });

  it("creates Anthropic provider for anthropic provider field", () => {
    const config = {
      name: "test-anthropic",
      type: "api" as const,
      provider: "anthropic" as const,
      apiKey: "sk-ant-test",
      model: "claude-3",
    };
    const provider = createProvider(config);
    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({ name: "test-anthropic" })
    );
  });

  it("creates Google provider for google provider field", () => {
    const config = {
      name: "test-google",
      type: "api" as const,
      provider: "google" as const,
      apiKey: "goog-test",
      model: "gemini-pro",
    };
    const provider = createProvider(config);
    expect(GoogleProvider).toHaveBeenCalledWith(
      expect.objectContaining({ name: "test-google" })
    );
  });

  it("creates Ollama provider for ollama provider field", () => {
    const config = {
      name: "test-ollama",
      type: "local" as const,
      provider: "ollama" as const,
      apiKey: "",
      model: "llama2",
    };
    const provider = createProvider(config);
    expect(OllamaProvider).toHaveBeenCalledWith(
      expect.objectContaining({ name: "test-ollama" })
    );
  });

  it("throws for missing type field", () => {
    const config = {
      name: "bad",
      type: "" as any,
      apiKey: "key",
      model: "m",
    };
    expect(() => createProvider(config)).toThrow("missing required 'type' field");
  });

  it("throws for invalid type without provider field", () => {
    const config = {
      name: "bad",
      type: "unknown-type" as any,
      apiKey: "key",
      model: "m",
    };
    expect(() => createProvider(config)).toThrow("invalid type");
  });

  it("infers Anthropic from model name containing claude when type is api", () => {
    const config = {
      name: "inferred",
      type: "api" as const,
      apiKey: "key",
      model: "claude-3-opus",
    };
    createProvider(config);
    expect(AnthropicProvider).toHaveBeenCalled();
  });

  it("infers Google from model name containing gemini when type is api", () => {
    const config = {
      name: "inferred-google",
      type: "api" as const,
      apiKey: "key",
      model: "gemini-pro",
    };
    createProvider(config);
    expect(GoogleProvider).toHaveBeenCalled();
  });

  it("defaults to OpenAI for generic api type", () => {
    const config = {
      name: "generic",
      type: "api" as const,
      apiKey: "key",
      model: "some-model",
    };
    createProvider(config);
    expect(OpenAIProvider).toHaveBeenCalled();
  });

  it("creates Ollama provider for local type", () => {
    const config = {
      name: "local-model",
      type: "local" as const,
      apiKey: "",
      model: "llama2",
    };
    createProvider(config);
    expect(OllamaProvider).toHaveBeenCalled();
  });
});

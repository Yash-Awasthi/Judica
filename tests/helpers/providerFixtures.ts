/**
 * P6-14: Shared test fixture for provider/adapter mock creation.
 * Consolidates the duplicate makeProvider() helpers that were scattered
 * across fallbacks.test.ts, anthropic.test.ts, google.test.ts, openai.test.ts.
 */

export interface MockProviderConfig {
  name?: string;
  type?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxConcurrency?: number;
  timeoutMs?: number;
  [key: string]: unknown;
}

/**
 * Creates a plain provider config object for unit tests.
 * Use for tests that work with raw config objects (e.g., fallback chain tests).
 */
export function makeProviderConfig(overrides: Partial<MockProviderConfig> = {}): MockProviderConfig {
  return {
    name: "Test Provider",
    type: "api",
    apiKey: "test-key-" + Math.random().toString(36).slice(2, 8),
    model: "gpt-4",
    baseUrl: "https://api.test.example.com/v1",
    maxConcurrency: 5,
    timeoutMs: 30_000,
    ...overrides,
  };
}

/**
 * Creates a mock fetch function that returns a streaming response.
 * Useful for adapter tests that need to simulate provider responses.
 */
export function makeMockStreamFetch(chunks: string[] = ["Hello", " world"]) {
  return async (_url: string, _init: RequestInit) => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          const payload = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
          controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
  });
}

/**
 * Creates a mock fetch that returns an error response.
 */
export function makeMockErrorFetch(statusCode: number = 500, message: string = "Internal Server Error") {
  return async (_url: string, _init: RequestInit) => ({
    ok: false,
    status: statusCode,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ error: { message } }),
    text: async () => JSON.stringify({ error: { message } }),
  });
}

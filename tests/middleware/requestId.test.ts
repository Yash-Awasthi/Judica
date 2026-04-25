import { describe, it, expect, vi, beforeEach } from "vitest";
import { fastifyRequestId } from "../../src/middleware/requestId.js";

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomUUID: vi.fn(() => "generated-uuid-1234"),
  };
});

function createMocks(headers: Record<string, string> = {}) {
  const request = { headers } as any;
  const reply = {
    header: vi.fn().mockReturnThis(),
  } as any;
  return { request, reply };
}

describe("fastifyRequestId middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the x-request-id header if present", async () => {
    const { request, reply } = createMocks({ "x-request-id": "client-id-abc" });
    await fastifyRequestId(request, reply);

    expect(request.requestId).toBe("client-id-abc");
  });

  it("generates a UUID if x-request-id header is missing", async () => {
    const { request, reply } = createMocks();
    await fastifyRequestId(request, reply);

    expect(request.requestId).toBe("generated-uuid-1234");
  });

  it("sets X-Request-ID response header", async () => {
    const { request, reply } = createMocks({ "x-request-id": "my-id" });
    await fastifyRequestId(request, reply);

    expect(reply.header).toHaveBeenCalledWith("X-Request-ID", "my-id");
  });

  it("sets request.requestId", async () => {
    const { request, reply } = createMocks();
    await fastifyRequestId(request, reply);

    expect(request.requestId).toBeDefined();
    expect(typeof request.requestId).toBe("string");
  });
});

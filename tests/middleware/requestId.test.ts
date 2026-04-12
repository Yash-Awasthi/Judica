import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestId } from "../../src/middleware/requestId.js";

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomUUID: vi.fn(() => "generated-uuid-1234"),
  };
});

function createMocks(headers: Record<string, string> = {}) {
  const req = { headers } as any;
  const resHeaders: Record<string, string> = {};
  const res = {
    locals: {} as Record<string, any>,
    setHeader: vi.fn((name: string, value: string) => {
      resHeaders[name] = value;
    }),
  } as any;
  const next = vi.fn();
  return { req, res, next, resHeaders };
}

describe("requestId middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the x-request-id header if present", () => {
    const { req, res, next } = createMocks({ "x-request-id": "client-id-abc" });
    requestId(req, res, next);

    expect(req.requestId).toBe("client-id-abc");
    expect(res.locals.requestId).toBe("client-id-abc");
  });

  it("generates a UUID if x-request-id header is missing", () => {
    const { req, res, next } = createMocks();
    requestId(req, res, next);

    expect(req.requestId).toBe("generated-uuid-1234");
    expect(res.locals.requestId).toBe("generated-uuid-1234");
  });

  it("sets X-Request-ID response header", () => {
    const { req, res, next } = createMocks({ "x-request-id": "my-id" });
    requestId(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", "my-id");
  });

  it("sets res.locals.requestId", () => {
    const { req, res, next } = createMocks();
    requestId(req, res, next);

    expect(res.locals.requestId).toBeDefined();
    expect(typeof res.locals.requestId).toBe("string");
  });

  it("calls next()", () => {
    const { req, res, next } = createMocks();
    requestId(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });
});

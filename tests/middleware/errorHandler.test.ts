import { describe, it, expect, vi, beforeEach } from "vitest";
import { errorHandler, AppError } from "../../src/middleware/errorHandler.js";
import { env } from "../../src/config/env.js";

vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

vi.mock("../../src/config/env.js", () => ({
  env: { NODE_ENV: "development" }
}));

describe("Error Handler Middleware", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    vi.resetAllMocks();
    req = { path: "/test", method: "GET", requestId: "req-123" };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    next = vi.fn();
  });

  it("should handle AppError", () => {
    const error = new AppError(403, "Forbidden Action", "FORBIDDEN");
    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden Action", code: "FORBIDDEN" });
  });

  it("should handle ZodError (validation failed)", () => {
    const error = { name: "ZodError", issues: [{ message: "Required" }] } as any;
    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Validation failed", details: error.issues });
  });

  it("should handle generic errors (development)", () => {
    // env.NODE_ENV is "development" from mock
    const error = new Error("Something went wrong");
    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Something went wrong",
      code: "INTERNAL_ERROR"
    });
  });

  it("should handle generic errors (production)", () => {
    vi.mocked(env).NODE_ENV = "production";
    const error = new Error("Secret error details");
    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Internal server error",
      code: "INTERNAL_ERROR"
    });
  });
});

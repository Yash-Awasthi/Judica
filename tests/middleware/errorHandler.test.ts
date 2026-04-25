import { describe, it, expect, vi, beforeEach } from "vitest";
import { fastifyErrorHandler, AppError } from "../../src/middleware/errorHandler.js";
import { env } from "../../src/config/env.js";

vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

vi.mock("../../src/config/env.js", () => ({
  env: { NODE_ENV: "development" }
}));

describe("Fastify Error Handler", () => {
  let request: any;
  let reply: any;

  beforeEach(() => {
    vi.resetAllMocks();
    request = { url: "/test", method: "GET" };
    reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
  });

  it("should handle AppError", () => {
    const error = new AppError(403, "Forbidden Action", "FORBIDDEN");
    fastifyErrorHandler(error, request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "Forbidden Action", code: "FORBIDDEN" });
  });

  it("should handle ZodError (validation failed)", () => {
    const error = { name: "ZodError", issues: [{ message: "Required" }] } as any;
    fastifyErrorHandler(error, request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "Validation failed", details: error.issues });
  });

  it("should handle generic errors (development)", () => {
    const error = new Error("Something went wrong");
    fastifyErrorHandler(error, request, reply);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      error: "Something went wrong",
      code: "INTERNAL_ERROR"
    });
  });

  it("should handle generic errors (production)", () => {
    vi.mocked(env).NODE_ENV = "production";
    const error = new Error("Secret error details");
    fastifyErrorHandler(error, request, reply);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      error: "Internal server error",
      code: "INTERNAL_ERROR"
    });
  });
});

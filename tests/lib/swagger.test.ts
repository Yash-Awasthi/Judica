import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import { registerSwagger } from "../../src/lib/swagger.js";

describe("Swagger Config", () => {
  it("should register swagger plugin on fastify instance", async () => {
    const registered: { plugin: any; opts: any }[] = [];
    const mockFastify = {
      register: vi.fn(async (plugin: any, opts: any) => {
        registered.push({ plugin, opts });
      }),
    } as any;

    await registerSwagger(mockFastify);
    expect(mockFastify.register).toHaveBeenCalledTimes(2); // swagger + swagger-ui
  });

  it("should configure OpenAPI 3.0.3 with correct metadata", async () => {
    let swaggerOpts: any;
    const mockFastify = {
      register: vi.fn(async (plugin: any, opts: any) => {
        if (opts?.openapi) swaggerOpts = opts;
      }),
    } as any;

    await registerSwagger(mockFastify);
    expect(swaggerOpts.openapi.openapi).toBe("3.0.3");
    expect(swaggerOpts.openapi.info.title).toBe("AIBYAI API");
    expect(swaggerOpts.openapi.info.version).toBe("1.0.0");
  });

  it("should define security schemes and tags", async () => {
    let swaggerOpts: any;
    const mockFastify = {
      register: vi.fn(async (plugin: any, opts: any) => {
        if (opts?.openapi) swaggerOpts = opts;
      }),
    } as any;

    await registerSwagger(mockFastify);
    expect(swaggerOpts.openapi.components.securitySchemes.bearerAuth.type).toBe("http");
    expect(swaggerOpts.openapi.tags.length).toBeGreaterThan(0);
    expect(swaggerOpts.openapi.tags.some((t: any) => t.name === "Health")).toBe(true);
  });

  it("should configure swagger-ui at /api/docs", async () => {
    let uiOpts: any;
    const mockFastify = {
      register: vi.fn(async (plugin: any, opts: any) => {
        if (opts?.routePrefix) uiOpts = opts;
      }),
    } as any;

    await registerSwagger(mockFastify);
    expect(uiOpts.routePrefix).toBe("/api/docs");
  });
});

import { describe, it, expect } from "vitest";
import { swaggerSpec } from "../../src/lib/swagger.js";

describe("Swagger Config", () => {
  it("should have correct OpenAPI version", () => {
    expect(swaggerSpec.openapi).toBe("3.0.3");
  });

  it("should have API info defined", () => {
    expect(swaggerSpec.info).toBeDefined();
    expect(swaggerSpec.info.title).toBe("AIBYAI API");
    expect(swaggerSpec.info.version).toBe("1.0.0");
  });

  it("should define components and security schemes", () => {
    expect(swaggerSpec.components?.securitySchemes).toBeDefined();
    expect((swaggerSpec.components!.securitySchemes as any).bearerAuth.type).toBe("http");
  });

  it("should define some tags", () => {
    expect(swaggerSpec.tags).toBeDefined();
    expect(swaggerSpec.tags!.length).toBeGreaterThan(0);
    const hasHealthTag = swaggerSpec.tags!.some(t => t.name === "Health");
    expect(hasHealthTag).toBe(true);
  });
});

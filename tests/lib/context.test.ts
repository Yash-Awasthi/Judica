import { describe, it, expect } from "vitest";
import { requestContext } from "../../src/lib/context.js";

describe("Request Context Utility", () => {
  it("should store and retrieve context", async () => {
    const mockContext = { requestId: "test-id" };
    
    await requestContext.run(mockContext, () => {
      const stored = requestContext.getStore();
      expect(stored).toEqual(mockContext);
    });
    
    expect(requestContext.getStore()).toBeUndefined();
  });
});

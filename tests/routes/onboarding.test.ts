import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/services/onboarding.service.js", () => ({
  getOrCreateState: vi.fn(),
  completeStep: vi.fn(),
  skipOnboarding: vi.fn(),
  resetOnboarding: vi.fn(),
  getOnboardingSummary: vi.fn(),
}));

vi.mock("../../src/db/schema/onboarding.js", () => ({
  ONBOARDING_STEPS: [
    "welcome",
    "provider_keys",
    "first_council",
    "sample_run",
    "explore",
    "complete",
  ] as const,
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import {
  getOrCreateState,
  completeStep,
  skipOnboarding,
  resetOnboarding,
  getOnboardingSummary,
} from "../../src/services/onboarding.service.js";

const registeredRoutes: Record<string, { handler: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      registeredRoutes[`${method.toUpperCase()} ${path}`] = {
        handler: handler ?? opts,
      };
    });
  return {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    delete: register("DELETE"),
    patch: register("PATCH"),
    addHook: vi.fn(),
    addContentTypeParser: vi.fn(),
    register: vi.fn(),
  };
}

function makeReq(overrides: any = {}): any {
  const base = {
    userId: 1,
    role: "member",
    body: {},
    params: {},
    query: {},
    headers: {},
    // Simulate authenticated user object used by getUserId()
    user: { id: overrides.userId ?? 1 },
  };
  return { ...base, ...overrides, user: { id: overrides.userId ?? 1 } };
}

function makeReply(): any {
  const r: any = {};
  r.code = vi.fn(() => r);
  r.send = vi.fn(() => r);
  r.header = vi.fn(() => r);
  r.status = vi.fn(() => r);
  return r;
}

let fastify: any;

beforeEach(async () => {
  vi.clearAllMocks();
  Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
  fastify = createFastifyInstance();
  const { default: onboardingPlugin } = await import("../../src/routes/onboarding.js");
  await onboardingPlugin(fastify, {});
});

describe("GET /", () => {
  it("returns the user's onboarding state", async () => {
    const mockState = {
      userId: 1,
      currentStep: "welcome",
      completedSteps: [],
      completed: false,
      skipped: false,
    };
    vi.mocked(getOrCreateState).mockResolvedValue(mockState as any);

    const handler = registeredRoutes["GET /"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ userId: 1 });
    const result = await handler(req, makeReply());

    expect(getOrCreateState).toHaveBeenCalledWith(1);
    expect(result).toEqual(mockState);
  });

  it("creates a new state if one does not exist", async () => {
    const newState = { userId: 99, currentStep: "welcome", completedSteps: [], completed: false };
    vi.mocked(getOrCreateState).mockResolvedValue(newState as any);

    const handler = registeredRoutes["GET /"]?.handler;
    const req = makeReq({ userId: 99 });
    const result = await handler(req, makeReply());

    expect(getOrCreateState).toHaveBeenCalledWith(99);
    expect(result).toEqual(newState);
  });
});

describe("GET /summary", () => {
  it("returns onboarding progress summary", async () => {
    const mockSummary = {
      totalSteps: 6,
      completedCount: 2,
      percentComplete: 33,
      currentStep: "provider_keys",
      nextStep: "first_council",
    };
    vi.mocked(getOnboardingSummary).mockResolvedValue(mockSummary as any);

    const handler = registeredRoutes["GET /summary"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ userId: 5 });
    const result = await handler(req, makeReply());

    expect(getOnboardingSummary).toHaveBeenCalledWith(5);
    expect(result).toEqual(mockSummary);
  });
});

describe("GET /steps", () => {
  it("returns list of all onboarding steps without requiring auth", async () => {
    const handler = registeredRoutes["GET /steps"]?.handler;
    expect(handler).toBeDefined();

    const result = await handler(makeReq(), makeReply());

    expect(result).toEqual({
      steps: ["welcome", "provider_keys", "first_council", "sample_run", "explore", "complete"],
    });
  });

  it("does not call any service function", async () => {
    const handler = registeredRoutes["GET /steps"]?.handler;
    await handler(makeReq(), makeReply());

    expect(getOrCreateState).not.toHaveBeenCalled();
    expect(completeStep).not.toHaveBeenCalled();
  });
});

describe("POST /steps/:step", () => {
  it("marks a valid step as completed", async () => {
    const updatedState = {
      userId: 1,
      currentStep: "provider_keys",
      completedSteps: ["welcome"],
    };
    vi.mocked(completeStep).mockResolvedValue(updatedState as any);

    const handler = registeredRoutes["POST /steps/:step"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ userId: 1, params: { step: "welcome" }, body: {} });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(completeStep).toHaveBeenCalledWith(1, "welcome", undefined);
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(result).toEqual(updatedState);
  });

  it("passes step metadata when body is provided", async () => {
    vi.mocked(completeStep).mockResolvedValue({ currentStep: "first_council" } as any);

    const handler = registeredRoutes["POST /steps/:step"]?.handler;
    const metadata = { selectedArchetypes: ["Architect", "Pragmatist"] };
    const req = makeReq({
      userId: 2,
      params: { step: "provider_keys" },
      body: metadata,
    });
    await handler(req, makeReply());

    expect(completeStep).toHaveBeenCalledWith(2, "provider_keys", metadata);
  });

  it("throws AppError 400 for an unknown step", async () => {
    const handler = registeredRoutes["POST /steps/:step"]?.handler;
    const req = makeReq({ userId: 1, params: { step: "nonexistent_step" }, body: {} });

    await expect(handler(req, makeReply())).rejects.toThrow("Unknown onboarding step");
  });

  it("does not pass metadata when body is empty", async () => {
    vi.mocked(completeStep).mockResolvedValue({} as any);

    const handler = registeredRoutes["POST /steps/:step"]?.handler;
    const req = makeReq({ userId: 1, params: { step: "welcome" }, body: {} });
    await handler(req, makeReply());

    expect(completeStep).toHaveBeenCalledWith(1, "welcome", undefined);
  });

  it("accepts all valid steps", async () => {
    vi.mocked(completeStep).mockResolvedValue({} as any);
    const handler = registeredRoutes["POST /steps/:step"]?.handler;
    const validSteps = ["welcome", "provider_keys", "first_council", "sample_run", "explore", "complete"];

    for (const step of validSteps) {
      const req = makeReq({ userId: 1, params: { step }, body: {} });
      await expect(handler(req, makeReply())).resolves.not.toThrow();
    }

    expect(completeStep).toHaveBeenCalledTimes(validSteps.length);
  });
});

describe("POST /skip", () => {
  it("skips onboarding for authenticated user", async () => {
    const skippedState = { userId: 1, skipped: true, completed: false };
    vi.mocked(skipOnboarding).mockResolvedValue(skippedState as any);

    const handler = registeredRoutes["POST /skip"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ userId: 1 });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(skipOnboarding).toHaveBeenCalledWith(1);
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(result).toEqual(skippedState);
  });

  it("passes correct userId to skipOnboarding", async () => {
    vi.mocked(skipOnboarding).mockResolvedValue({} as any);

    const handler = registeredRoutes["POST /skip"]?.handler;
    await handler(makeReq({ userId: 42 }), makeReply());

    expect(skipOnboarding).toHaveBeenCalledWith(42);
  });
});

describe("DELETE /:userId — admin reset", () => {
  it("resets onboarding for a valid userId and returns 204", async () => {
    vi.mocked(resetOnboarding).mockResolvedValue(undefined as any);

    const handler = registeredRoutes["DELETE /:userId"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ role: "admin", params: { userId: "7" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(resetOnboarding).toHaveBeenCalledWith(7);
    expect(reply.status).toHaveBeenCalledWith(204);
  });

  it("throws AppError 400 for non-numeric userId", async () => {
    const handler = registeredRoutes["DELETE /:userId"]?.handler;
    const req = makeReq({ role: "admin", params: { userId: "not-a-number" } });

    await expect(handler(req, makeReply())).rejects.toThrow("Invalid userId");
  });

  it("parses userId string to integer correctly", async () => {
    vi.mocked(resetOnboarding).mockResolvedValue(undefined as any);

    const handler = registeredRoutes["DELETE /:userId"]?.handler;
    await handler(
      makeReq({ role: "admin", params: { userId: "123" } }),
      makeReply()
    );

    expect(resetOnboarding).toHaveBeenCalledWith(123);
  });
});

describe("route registration", () => {
  it("registers GET / route", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
  });

  it("registers GET /summary route", () => {
    expect(registeredRoutes["GET /summary"]).toBeDefined();
  });

  it("registers GET /steps route", () => {
    expect(registeredRoutes["GET /steps"]).toBeDefined();
  });

  it("registers POST /steps/:step route", () => {
    expect(registeredRoutes["POST /steps/:step"]).toBeDefined();
  });

  it("registers POST /skip route", () => {
    expect(registeredRoutes["POST /skip"]).toBeDefined();
  });

  it("registers DELETE /:userId route", () => {
    expect(registeredRoutes["DELETE /:userId"]).toBeDefined();
  });
});

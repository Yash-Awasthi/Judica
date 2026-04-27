import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const {
  mockInsert,
  mockInsertValues,
  mockInsertReturning,
  mockSelect,
  mockFrom,
  mockWhere,
  mockWhereLimitResult,
  mockUpdate,
  mockSet,
  mockSetWhere,
  mockSetWhereReturning,
  mockDelete,
  mockDeleteWhere,
  dbSelectResult,
} = vi.hoisted(() => {
  // Shared mutable state that controls what the select chain resolves to
  const dbSelectResult = { rows: [] as unknown[] };

  // Insert chain: db.insert().values().returning()
  const mockInsertReturning = vi.fn().mockResolvedValue([{
    id: 1,
    userId: 1,
    currentStep: "welcome",
    completedSteps: [],
    completed: false,
    skipped: false,
    stepData: {},
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
  }]);
  const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  // Select chain: db.select().from().where().limit(1) → thenable
  const mockWhereLimitResult = vi.fn().mockImplementation(() =>
    Promise.resolve(dbSelectResult.rows),
  );
  const mockWhere = vi.fn().mockReturnValue({ limit: mockWhereLimitResult });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  // Update chain: db.update().set().where().returning()
  const mockSetWhereReturning = vi.fn().mockResolvedValue([{
    id: 1,
    userId: 1,
    currentStep: "provider_keys",
    completedSteps: ["welcome"],
    completed: false,
    skipped: false,
    stepData: {},
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
  }]);
  const mockSetWhere = vi.fn().mockReturnValue({ returning: mockSetWhereReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

  // Delete chain: db.delete().where()
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

  return {
    mockInsert,
    mockInsertValues,
    mockInsertReturning,
    mockSelect,
    mockFrom,
    mockWhere,
    mockWhereLimitResult,
    mockUpdate,
    mockSet,
    mockSetWhere,
    mockSetWhereReturning,
    mockDelete,
    mockDeleteWhere,
    dbSelectResult,
  };
});

// ─── Mocks (before import) ────────────────────────────────────────────────────

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    get insert() { return mockInsert; },
    get select() { return mockSelect; },
    get update() { return mockUpdate; },
    get delete() { return mockDelete; },
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock("../../src/db/schema/onboarding.js", () => ({
  onboardingStates: {
    id: "id",
    userId: "userId",
    currentStep: "currentStep",
    completedSteps: "completedSteps",
    completed: "completed",
    skipped: "skipped",
    stepData: "stepData",
    startedAt: "startedAt",
    completedAt: "completedAt",
    updatedAt: "updatedAt",
  },
  ONBOARDING_STEPS: [
    "welcome",
    "provider_keys",
    "first_council",
    "sample_run",
    "explore",
    "complete",
  ],
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: true, a, b })),
  and: vi.fn((...args) => ({ and: true, args })),
  desc: vi.fn((col) => ({ desc: true, col })),
  count: vi.fn(() => "count(*)"),
  sql: vi.fn(() => "sql"),
  gte: vi.fn((a, b) => ({ gte: true, a, b })),
  lte: vi.fn((a, b) => ({ lte: true, a, b })),
}));

// ─── Import under test (after mocks) ─────────────────────────────────────────

import {
  getOrCreateState,
  completeStep,
  skipOnboarding,
  resetOnboarding,
  getOnboardingSummary,
} from "../../src/services/onboarding.service.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const makeState = (overrides: Partial<{
  id: number;
  userId: number;
  currentStep: string;
  completedSteps: string[];
  completed: boolean;
  skipped: boolean;
  stepData: Record<string, unknown>;
  completedAt: Date | null;
}> = {}) => ({
  id: 1,
  userId: 1,
  currentStep: "welcome",
  completedSteps: [],
  completed: false,
  skipped: false,
  stepData: {},
  startedAt: new Date(),
  completedAt: null,
  updatedAt: new Date(),
  ...overrides,
});

// ─── getOrCreateState ─────────────────────────────────────────────────────────

describe("getOrCreateState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing state when a record is found", async () => {
    const existing = makeState({ userId: 10 });
    dbSelectResult.rows = [existing];

    const result = await getOrCreateState(10);

    expect(result).toEqual(existing);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("creates and returns a new state when no record exists", async () => {
    dbSelectResult.rows = [];
    const created = makeState({ userId: 10 });
    mockInsertReturning.mockResolvedValueOnce([created]);

    const result = await getOrCreateState(10);

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledWith({ userId: 10 });
    expect(result).toEqual(created);
  });

  it("calls select().from().where().limit(1) to look up state", async () => {
    const existing = makeState();
    dbSelectResult.rows = [existing];

    await getOrCreateState(1);

    expect(mockSelect).toHaveBeenCalledOnce();
    expect(mockFrom).toHaveBeenCalledOnce();
    expect(mockWhere).toHaveBeenCalledOnce();
    expect(mockWhereLimitResult).toHaveBeenCalledWith(1);
  });

  it("propagates DB errors from select", async () => {
    mockWhereLimitResult.mockRejectedValueOnce(new Error("select error"));

    await expect(getOrCreateState(1)).rejects.toThrow("select error");
  });

  it("propagates DB errors from insert", async () => {
    dbSelectResult.rows = [];
    mockInsertReturning.mockRejectedValueOnce(new Error("insert error"));

    await expect(getOrCreateState(1)).rejects.toThrow("insert error");
  });
});

// ─── completeStep ─────────────────────────────────────────────────────────────

describe("completeStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks 'welcome' as completed and advances to 'provider_keys'", async () => {
    const state = makeState({ completedSteps: [], currentStep: "welcome" });
    dbSelectResult.rows = [state];

    const updated = makeState({ completedSteps: ["welcome"], currentStep: "provider_keys" });
    mockSetWhereReturning.mockResolvedValueOnce([updated]);

    const result = await completeStep(1, "welcome");

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledOnce();
    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.completedSteps).toContain("welcome");
    expect(setArg.currentStep).toBe("provider_keys");
    expect(result).toEqual(updated);
  });

  it("is idempotent: does not update when step is already completed", async () => {
    const state = makeState({ completedSteps: ["welcome"], currentStep: "provider_keys" });
    dbSelectResult.rows = [state];

    const result = await completeStep(1, "welcome");

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result).toEqual(state);
  });

  it("advances from 'explore' to 'complete' and sets completed=true", async () => {
    const state = makeState({
      completedSteps: ["welcome", "provider_keys", "first_council", "sample_run"],
      currentStep: "explore",
    });
    dbSelectResult.rows = [state];

    const updated = makeState({
      completedSteps: ["welcome", "provider_keys", "first_council", "sample_run", "explore"],
      currentStep: "complete",
      completed: true,
      completedAt: new Date(),
    });
    mockSetWhereReturning.mockResolvedValueOnce([updated]);

    const result = await completeStep(1, "explore");

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.currentStep).toBe("complete");
    expect(setArg.completed).toBe(true);
    expect(setArg.completedAt).toBeInstanceOf(Date);
    expect(result.completed).toBe(true);
  });

  it("stores step metadata in stepData", async () => {
    const state = makeState({ completedSteps: [], currentStep: "welcome" });
    dbSelectResult.rows = [state];
    mockSetWhereReturning.mockResolvedValueOnce([makeState({ completedSteps: ["welcome"] })]);

    await completeStep(1, "welcome", { clickedCta: true });

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.stepData).toMatchObject({ welcome: { clickedCta: true } });
  });

  it("preserves existing stepData from previous steps", async () => {
    const state = makeState({
      completedSteps: ["welcome"],
      currentStep: "provider_keys",
      stepData: { welcome: { seen: true } },
    });
    dbSelectResult.rows = [state];
    mockSetWhereReturning.mockResolvedValueOnce([makeState()]);

    await completeStep(1, "provider_keys", { key: "openai" });

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.stepData).toMatchObject({ welcome: { seen: true }, provider_keys: { key: "openai" } });
  });

  it("advances from 'provider_keys' to 'first_council'", async () => {
    const state = makeState({ completedSteps: ["welcome"], currentStep: "provider_keys" });
    dbSelectResult.rows = [state];
    mockSetWhereReturning.mockResolvedValueOnce([makeState()]);

    await completeStep(1, "provider_keys");

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.currentStep).toBe("first_council");
  });

  it("creates state if none exists before completing step", async () => {
    const created = makeState({ completedSteps: [], currentStep: "welcome" });
    // getOrCreateState: select returns empty → triggers insert
    mockWhereLimitResult.mockResolvedValueOnce([]);
    mockInsertReturning.mockResolvedValueOnce([created]);
    mockSetWhereReturning.mockResolvedValueOnce([makeState({ completedSteps: ["welcome"] })]);

    await completeStep(1, "welcome");

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});

// ─── skipOnboarding ───────────────────────────────────────────────────────────

describe("skipOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets skipped=true on the state", async () => {
    const state = makeState();
    dbSelectResult.rows = [state];

    const updated = makeState({ skipped: true });
    mockSetWhereReturning.mockResolvedValueOnce([updated]);

    const result = await skipOnboarding(1);

    expect(mockUpdate).toHaveBeenCalledOnce();
    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.skipped).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("calls getOrCreateState before updating", async () => {
    const state = makeState();
    dbSelectResult.rows = [state];
    mockSetWhereReturning.mockResolvedValueOnce([makeState({ skipped: true })]);

    await skipOnboarding(1);

    expect(mockSelect).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("propagates DB errors from update", async () => {
    const state = makeState();
    dbSelectResult.rows = [state];
    mockSetWhereReturning.mockRejectedValueOnce(new Error("update failed"));

    await expect(skipOnboarding(1)).rejects.toThrow("update failed");
  });
});

// ─── resetOnboarding ──────────────────────────────────────────────────────────

describe("resetOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteWhere.mockResolvedValue(undefined);
  });

  it("calls delete().where() with userId", async () => {
    await resetOnboarding(1);

    expect(mockDelete).toHaveBeenCalledOnce();
    expect(mockDeleteWhere).toHaveBeenCalledOnce();
  });

  it("resolves to undefined (void)", async () => {
    await expect(resetOnboarding(1)).resolves.toBeUndefined();
  });

  it("propagates DB errors", async () => {
    mockDeleteWhere.mockRejectedValueOnce(new Error("delete error"));

    await expect(resetOnboarding(1)).rejects.toThrow("delete error");
  });
});

// ─── getOnboardingSummary ─────────────────────────────────────────────────────

describe("getOnboardingSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0% progress when no steps completed", async () => {
    const state = makeState({ completedSteps: [], currentStep: "welcome", completed: false, skipped: false });
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    expect(summary.progressPercent).toBe(0);
    expect(summary.completedSteps).toHaveLength(0);
  });

  it("returns 100% when onboarding is marked complete", async () => {
    const state = makeState({ completed: true, completedSteps: ["welcome", "provider_keys", "first_council", "sample_run", "explore", "complete"] });
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    expect(summary.progressPercent).toBe(100);
    expect(summary.completed).toBe(true);
  });

  it("returns 20% when 1 of 5 non-complete steps is done", async () => {
    const state = makeState({ completedSteps: ["welcome"], currentStep: "provider_keys", completed: false });
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    // 1 / (6 - 1) * 100 = 20
    expect(summary.progressPercent).toBe(20);
  });

  it("returns 80% when 4 of 5 non-complete steps are done", async () => {
    const state = makeState({
      completedSteps: ["welcome", "provider_keys", "first_council", "sample_run"],
      currentStep: "explore",
      completed: false,
    });
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    expect(summary.progressPercent).toBe(80);
  });

  it("returns currentStep from state", async () => {
    const state = makeState({ currentStep: "first_council" });
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    expect(summary.currentStep).toBe("first_council");
  });

  it("returns correct completedSteps array", async () => {
    const state = makeState({ completedSteps: ["welcome", "provider_keys"] });
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    expect(summary.completedSteps).toEqual(["welcome", "provider_keys"]);
  });

  it("returns skipped flag from state", async () => {
    const state = makeState({ skipped: true });
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    expect(summary.skipped).toBe(true);
  });

  it("returns a steps array with all 6 steps", async () => {
    const state = makeState({ completedSteps: [], currentStep: "welcome" });
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    expect(summary.steps).toHaveLength(6);
    expect(summary.steps.map((s) => s.id)).toEqual([
      "welcome",
      "provider_keys",
      "first_council",
      "sample_run",
      "explore",
      "complete",
    ]);
  });

  it("marks the current step as current=true in steps array", async () => {
    const state = makeState({ currentStep: "provider_keys", completedSteps: ["welcome"] });
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    const current = summary.steps.find((s) => s.current);
    expect(current?.id).toBe("provider_keys");
  });

  it("marks completed steps as completed=true in steps array", async () => {
    const state = makeState({ completedSteps: ["welcome", "provider_keys"], currentStep: "first_council" });
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    const welcomeStep = summary.steps.find((s) => s.id === "welcome");
    const providerStep = summary.steps.find((s) => s.id === "provider_keys");
    const firstCouncilStep = summary.steps.find((s) => s.id === "first_council");

    expect(welcomeStep?.completed).toBe(true);
    expect(providerStep?.completed).toBe(true);
    expect(firstCouncilStep?.completed).toBe(false);
  });

  it("returns step labels", async () => {
    const state = makeState();
    dbSelectResult.rows = [state];

    const summary = await getOnboardingSummary(1);

    const welcomeStep = summary.steps.find((s) => s.id === "welcome");
    expect(welcomeStep?.label).toBe("Welcome");
  });

  it("creates new state when none exists", async () => {
    dbSelectResult.rows = [];
    const created = makeState();
    mockInsertReturning.mockResolvedValueOnce([created]);

    const summary = await getOnboardingSummary(1);

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(summary.currentStep).toBe("welcome");
  });
});

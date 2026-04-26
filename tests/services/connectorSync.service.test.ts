import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock variables ──────────────────────────────────────────────────
const {
  mockReturning,
  mockSet,
  mockValues,
  mockOrderBy,
  mockChain,
  mockResult,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockSet = vi.fn();
  const mockValues = vi.fn();
  const mockOrderBy = vi.fn();

  const mockResult = { value: [] as unknown[] };

  const mockChain: Record<string, any> = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    orderBy: mockOrderBy,
    insert: vi.fn(),
    values: mockValues,
    update: vi.fn(),
    set: mockSet,
    delete: vi.fn(),
    returning: mockReturning,
    execute: vi.fn(),
    then: vi.fn((resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve(mockResult.value).then(resolve, reject);
    }),
  };

  return {
    mockReturning,
    mockSet,
    mockValues,
    mockOrderBy,
    mockChain,
    mockResult,
  };
});

// ─── Schema mocks ────────────────────────────────────────────────────────────
vi.mock("../../src/db/schema/connectorSync.js", () => ({
  connectorSyncJobs: {
    id: "id",
    connectorId: "connectorId",
    userId: "userId",
    syncMode: "syncMode",
    status: "status",
    createdAt: "createdAt",
  },
  connectorSyncSchedules: {
    id: "id",
    connectorId: "connectorId",
    userId: "userId",
    syncMode: "syncMode",
    enabled: "enabled",
    nextRunAt: "nextRunAt",
    createdAt: "createdAt",
  },
}));

vi.mock("../../src/db/schema/connectors.js", () => ({
  connectorInstances: { id: "id", source: "source", lastSyncAt: "lastSyncAt" },
  connectorCredentials: { connectorId: "connectorId", credentialJson: "credentialJson" },
}));

// ─── Logger mock ─────────────────────────────────────────────────────────────
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// ─── Drizzle mock ────────────────────────────────────────────────────────────
vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockChain,
}));

// ─── drizzle-orm operators mock ──────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  desc: vi.fn((col: unknown) => ({ op: "desc", col })),
  lte: vi.fn((...args: unknown[]) => ({ op: "lte", args })),
}));

// ─── Connector mocks ────────────────────────────────────────────────────────
vi.mock("../../src/connectors/index.js", () => ({
  instantiateConnector: vi.fn().mockResolvedValue({
    loadFromState: vi.fn(),
    pollSource: vi.fn(),
    retrieveAllSlimDocs: vi.fn(),
    sourceType: "google_drive",
  }),
  runConnector: vi.fn().mockResolvedValue({
    documents: [{ id: "doc-1" }, { id: "doc-2" }],
    failures: [],
    checkpoint: undefined,
  }),
  isSlimConnector: vi.fn().mockReturnValue(false),
  DocumentSource: { GOOGLE_DRIVE: "google_drive" },
  InputType: { LOAD_STATE: "load_state", POLL: "poll", SLIM_RETRIEVAL: "slim_retrieval" },
}));

// ─── crypto mock ─────────────────────────────────────────────────────────────
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-1234"),
}));

import {
  createSyncJob,
  getSyncJobById,
  getSyncJobs,
  cancelSyncJob,
  executeSyncJob,
  createSyncSchedule,
  getSyncSchedules,
  updateSyncSchedule,
  deleteSyncSchedule,
  triggerScheduledSyncs,
  SyncMode,
  SyncJobStatus,
} from "../../src/services/connectorSync.service.js";

describe("connectorSync.service", () => {
  function setChainResult(val: unknown[]) {
    mockResult.value = val;
    mockChain.then.mockImplementation(
      (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(val).then(resolve, reject),
    );
  }

  function setChainResults(...results: unknown[][]) {
    let callIdx = 0;
    mockChain.then.mockImplementation(
      (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        const val = results[callIdx] ?? [];
        callIdx++;
        return Promise.resolve(val).then(resolve, reject);
      },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockChain.select.mockReturnValue(mockChain);
    mockChain.from.mockReturnValue(mockChain);
    mockChain.where.mockReturnValue(mockChain);
    mockChain.limit.mockReturnValue(mockChain);
    mockChain.offset.mockReturnValue(mockChain);
    mockOrderBy.mockReturnValue(mockChain);
    mockValues.mockReturnValue(mockChain);
    mockSet.mockReturnValue(mockChain);
    mockReturning.mockResolvedValue([{ id: "test-uuid-1234" }]);
    mockChain.insert.mockReturnValue(mockChain);
    mockChain.update.mockReturnValue(mockChain);
    mockChain.delete.mockReturnValue(mockChain);
    setChainResult([]);
  });

  // ─── createSyncJob ──────────────────────────────────────────────────────────
  describe("createSyncJob", () => {
    it("should create a pending sync job", async () => {
      mockValues.mockResolvedValue(undefined);
      const result = await createSyncJob("conn-1", 42, SyncMode.LOAD);
      expect(result).toEqual({ id: "test-uuid-1234" });
      expect(mockChain.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "test-uuid-1234",
          connectorId: "conn-1",
          userId: 42,
          syncMode: "load",
          status: "pending",
        }),
      );
    });

    it("should accept all three sync modes", async () => {
      mockValues.mockResolvedValue(undefined);

      for (const mode of [SyncMode.LOAD, SyncMode.POLL, SyncMode.SLIM]) {
        vi.clearAllMocks();
        mockChain.insert.mockReturnValue(mockChain);
        mockValues.mockResolvedValue(undefined);
        await createSyncJob("conn-1", 42, mode);
        expect(mockValues).toHaveBeenCalledWith(
          expect.objectContaining({ syncMode: mode }),
        );
      }
    });
  });

  // ─── getSyncJobById ─────────────────────────────────────────────────────────
  describe("getSyncJobById", () => {
    it("should return a job when found", async () => {
      const mockJob = { id: "job-1", connectorId: "conn-1", userId: 42, syncMode: "load", status: "running" };
      setChainResult([mockJob]);
      const job = await getSyncJobById("job-1", 42);
      expect(job).toEqual(mockJob);
    });

    it("should return null when job not found", async () => {
      setChainResult([]);
      const job = await getSyncJobById("nonexistent", 42);
      expect(job).toBeNull();
    });
  });

  // ─── getSyncJobs ────────────────────────────────────────────────────────────
  describe("getSyncJobs", () => {
    it("should return jobs for a connector", async () => {
      const mockJobs = [
        { id: "job-1", connectorId: "conn-1", syncMode: "load", status: "completed" },
        { id: "job-2", connectorId: "conn-1", syncMode: "poll", status: "running" },
      ];
      setChainResult(mockJobs);
      const jobs = await getSyncJobs("conn-1", 42);
      expect(jobs).toEqual(mockJobs);
    });

    it("should apply pagination options", async () => {
      setChainResult([]);
      await getSyncJobs("conn-1", 42, { limit: 5, offset: 10 });
      expect(mockChain.limit).toHaveBeenCalledWith(5);
      expect(mockChain.offset).toHaveBeenCalledWith(10);
    });
  });

  // ─── cancelSyncJob ──────────────────────────────────────────────────────────
  describe("cancelSyncJob", () => {
    it("should cancel a pending job", async () => {
      const mockJob = { id: "job-1", connectorId: "conn-1", userId: 42, syncMode: "load", status: "pending" };
      setChainResult([mockJob]);
      mockSet.mockReturnValue(mockChain);
      const result = await cancelSyncJob("job-1", 42);
      expect(result).toEqual({ cancelled: true });
    });

    it("should return null for nonexistent job", async () => {
      setChainResult([]);
      const result = await cancelSyncJob("nonexistent", 42);
      expect(result).toBeNull();
    });

    it("should refuse to cancel a completed job", async () => {
      const mockJob = { id: "job-1", connectorId: "conn-1", userId: 42, status: "completed" };
      setChainResult([mockJob]);
      const result = await cancelSyncJob("job-1", 42);
      expect(result).toEqual({ error: "Cannot cancel a job that has already finished" });
    });
  });

  // ─── executeSyncJob ─────────────────────────────────────────────────────────
  describe("executeSyncJob", () => {
    it("should execute a load sync job", async () => {
      const mockJob = {
        id: "job-1",
        connectorId: "conn-1",
        userId: 42,
        syncMode: "load",
        status: "pending",
        checkpoint: null,
      };
      const mockConnector = {
        id: "conn-1",
        source: "google_drive",
        settings: {},
        lastSyncAt: null,
      };
      const mockCred = { credentialJson: { token: "abc" } };

      // First call: job lookup; second: connector; third: credentials; rest: updates
      setChainResults([mockJob], [mockJob], [mockConnector], [mockCred], [], [], []);

      mockSet.mockReturnValue(mockChain);

      const result = await executeSyncJob("job-1");
      expect(result).toEqual(
        expect.objectContaining({
          jobId: "job-1",
          status: "completed",
          documentsProcessed: 2,
        }),
      );
    });

    it("should throw when job not found", async () => {
      setChainResult([]);
      await expect(executeSyncJob("nonexistent")).rejects.toThrow("Sync job nonexistent not found");
    });
  });

  // ─── Schedule CRUD ──────────────────────────────────────────────────────────
  describe("createSyncSchedule", () => {
    it("should create a schedule", async () => {
      mockValues.mockResolvedValue(undefined);
      const result = await createSyncSchedule({
        connectorId: "conn-1",
        userId: 42,
        syncMode: SyncMode.POLL,
        cronExpression: "0 */6 * * *",
      });
      expect(result).toEqual({ id: "test-uuid-1234" });
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorId: "conn-1",
          syncMode: "poll",
          cronExpression: "0 */6 * * *",
          enabled: true,
        }),
      );
    });
  });

  describe("getSyncSchedules", () => {
    it("should return schedules for a connector", async () => {
      const mockSchedules = [
        { id: "sched-1", connectorId: "conn-1", syncMode: "poll", cronExpression: "0 * * * *" },
      ];
      setChainResult(mockSchedules);
      const schedules = await getSyncSchedules("conn-1", 42);
      expect(schedules).toEqual(mockSchedules);
    });
  });

  describe("updateSyncSchedule", () => {
    it("should update an existing schedule", async () => {
      setChainResult([{ id: "sched-1" }]);
      mockSet.mockReturnValue(mockChain);
      const result = await updateSyncSchedule("sched-1", 42, {
        cronExpression: "0 */12 * * *",
        enabled: false,
      });
      expect(result).toEqual({ updated: true });
    });

    it("should return null for nonexistent schedule", async () => {
      setChainResult([]);
      const result = await updateSyncSchedule("nonexistent", 42, { enabled: false });
      expect(result).toBeNull();
    });
  });

  describe("deleteSyncSchedule", () => {
    it("should delete an existing schedule", async () => {
      setChainResult([{ id: "sched-1" }]);
      const result = await deleteSyncSchedule("sched-1", 42);
      expect(result).toEqual({ deleted: true });
      expect(mockChain.delete).toHaveBeenCalled();
    });

    it("should return null for nonexistent schedule", async () => {
      setChainResult([]);
      const result = await deleteSyncSchedule("nonexistent", 42);
      expect(result).toBeNull();
    });
  });

  // ─── triggerScheduledSyncs ──────────────────────────────────────────────────
  describe("triggerScheduledSyncs", () => {
    it("should trigger due schedules", async () => {
      const dueSchedule = {
        id: "sched-1",
        connectorId: "conn-1",
        userId: 42,
        syncMode: "poll",
        enabled: true,
        nextRunAt: new Date(Date.now() - 60_000),
      };
      // First call: due schedules lookup; second: createSyncJob insert; third: schedule update
      setChainResults([dueSchedule], [], []);
      mockValues.mockResolvedValue(undefined);
      mockSet.mockReturnValue(mockChain);

      const result = await triggerScheduledSyncs();
      expect(result).toEqual({ triggered: 1 });
    });

    it("should return zero when no schedules are due", async () => {
      setChainResult([]);
      const result = await triggerScheduledSyncs();
      expect(result).toEqual({ triggered: 0 });
    });
  });
});

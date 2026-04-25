import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock logger ──
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock errorHandler ──
vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    isOperational: boolean;
    constructor(statusCode: number, message: string, code = "INTERNAL_ERROR", isOperational = true) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
      this.isOperational = isOperational;
    }
  },
}));

// ── Mock Docker (dockerode) ──
const mockExecInspect = vi.fn().mockResolvedValue({ ExitCode: 0 });
const mockExecStart = vi.fn().mockImplementation(() => {
  const { PassThrough } = require("stream");
  const s = new PassThrough();
  setTimeout(() => {
    s.push(Buffer.from("mock output"));
    s.end();
  }, 10);
  return Promise.resolve(s);
});
const mockExec = vi.fn().mockResolvedValue({
  start: mockExecStart,
  inspect: mockExecInspect,
});
const mockContainerStop = vi.fn().mockResolvedValue(undefined);
const mockContainerStart = vi.fn().mockResolvedValue(undefined);
const mockContainerRemove = vi.fn().mockResolvedValue(undefined);
const mockContainerAttach = vi.fn().mockImplementation(() => {
  const { PassThrough } = require("stream");
  const s = new PassThrough();
  setTimeout(() => s.end(), 10);
  return Promise.resolve(s);
});
const mockContainerWait = vi.fn().mockResolvedValue({ StatusCode: 0 });
const mockContainer = {
  id: "container-123",
  exec: mockExec,
  stop: mockContainerStop,
  start: mockContainerStart,
  remove: mockContainerRemove,
  attach: mockContainerAttach,
  wait: mockContainerWait,
};
const mockCreateContainer = vi.fn().mockResolvedValue(mockContainer);
const mockGetContainer = vi.fn().mockReturnValue(mockContainer);
const mockCreateVolume = vi.fn().mockResolvedValue({ Name: "test-vol" });
const mockGetVolume = vi.fn().mockReturnValue({
  inspect: vi.fn().mockRejectedValue(new Error("not found")),
  remove: vi.fn().mockResolvedValue(undefined),
});

vi.mock("dockerode", () => {
  function DockerMock() {
    return {
      createContainer: mockCreateContainer,
      getContainer: mockGetContainer,
      createVolume: mockCreateVolume,
      getVolume: mockGetVolume,
      modem: {
        demuxStream: vi.fn().mockImplementation((_stream: any, stdout: any, _stderr: any) => {
          stdout.write(Buffer.from("mock output"));
        }),
      },
    };
  }
  return { default: DockerMock };
});

// Import after mocks
import {
  createSession,
  execCommand,
  listSessions,
  getSession,
  stopSession,
  destroySession,
} from "../../src/sandbox/sessionManager.js";

describe("sessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createSession", () => {
    it("creates a session with default options", async () => {
      const session = await createSession("user-1");

      expect(session.id).toMatch(/^sbx-/);
      expect(session.userId).toBe("user-1");
      expect(session.status).toBe("running");
      expect(session.gitConfigured).toBe(false);
      expect(mockCreateVolume).toHaveBeenCalled();
      expect(mockCreateContainer).toHaveBeenCalled();
      expect(mockContainerStart).toHaveBeenCalled();
    });

    it("creates a session with git credentials", async () => {
      const session = await createSession("user-2", {
        gitName: "Test User",
        gitEmail: "test@example.com",
        gitPat: "ghp_test123",
      });

      expect(session.gitConfigured).toBe(true);
      // Should have configured git credential helper
      expect(mockExec).toHaveBeenCalled();
    });

    it("stores session in registry", async () => {
      const session = await createSession("user-3");
      const retrieved = getSession(session.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(session.id);
    });

    it("lists sessions for a user", async () => {
      await createSession("user-list-1");
      await createSession("user-list-1");
      await createSession("user-list-2");

      const sessions1 = listSessions("user-list-1");
      const sessions2 = listSessions("user-list-2");

      expect(sessions1.length).toBe(2);
      expect(sessions2.length).toBe(1);
    });

    it("enforces max sessions per user", async () => {
      await createSession("user-limit");
      await createSession("user-limit");
      await createSession("user-limit");

      await expect(createSession("user-limit")).rejects.toThrow(/Max 3 concurrent/);
    });
  });

  describe("execCommand", () => {
    it("throws for non-existent session", async () => {
      await expect(execCommand("nonexistent", "ls")).rejects.toThrow(/not found/);
    });
  });

  describe("stopSession", () => {
    it("stops a running session", async () => {
      const session = await createSession("stop-user");
      await stopSession(session.id);

      expect(getSession(session.id)!.status).toBe("stopped");
      expect(mockContainerStop).toHaveBeenCalled();
    });

    it("throws for non-existent session", async () => {
      await expect(stopSession("nonexistent")).rejects.toThrow(/not found/);
    });
  });

  describe("destroySession", () => {
    it("destroys a session and removes from registry", async () => {
      const session = await createSession("destroy-user");
      await destroySession(session.id);

      expect(getSession(session.id)).toBeUndefined();
      expect(mockContainerRemove).toHaveBeenCalled();
    });
  });
});

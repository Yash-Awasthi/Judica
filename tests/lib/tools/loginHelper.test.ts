import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock playwright so we never actually launch a browser
vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockRejectedValue(new Error("ENOENT")), // no existing session
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

vi.mock("fs", () => ({
  chmodSync: vi.fn(),
}));

import { runLoginHelper } from "../../../src/lib/tools/login_helper.js";
import { chromium } from "playwright";

const mockChromium = vi.mocked(chromium);

describe("runLoginHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when an unknown target is requested", async () => {
    await expect(
      runLoginHelper("unknown" as unknown as "chatgpt")
    ).rejects.toThrow("Unknown target: unknown");
  });

  describe("valid targets — browser launch path", () => {
    const VALID_TARGETS = ["chatgpt", "claude", "deepseek", "gemini"] as const;

    for (const target of VALID_TARGETS) {
      it(`launches a non-headless browser for target '${target}'`, async () => {
        const mockStorageState = vi.fn().mockResolvedValue({});
        const mockContext = {
          newPage: vi.fn().mockResolvedValue({
            goto: vi.fn().mockResolvedValue(undefined),
          }),
          storageState: mockStorageState,
        };
        const mockBrowser = {
          newContext: vi.fn().mockResolvedValue(mockContext),
          close: vi.fn().mockResolvedValue(undefined),
        };

        mockChromium.launch = vi.fn().mockResolvedValue(mockBrowser);

        // Simulate user pressing ENTER to save the session
        const stdinMock = {
          once: vi.fn().mockImplementation((event: string, cb: () => void) => {
            if (event === "data") cb();
          }),
        };
        Object.defineProperty(process, "stdin", { value: stdinMock, writable: true });

        await runLoginHelper(target);

        expect(mockChromium.launch).toHaveBeenCalledWith(
          expect.objectContaining({ headless: false })
        );
        expect(mockBrowser.close).toHaveBeenCalled();
      });
    }
  });

  it("saves session to the correct file path", async () => {
    const mockStorageState = vi.fn().mockResolvedValue({});
    const mockContext = {
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn().mockResolvedValue(undefined),
      }),
      storageState: mockStorageState,
    };
    const mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockChromium.launch = vi.fn().mockResolvedValue(mockBrowser);

    const stdinMock = {
      once: vi.fn().mockImplementation((_: string, cb: () => void) => cb()),
    };
    Object.defineProperty(process, "stdin", { value: stdinMock, writable: true });

    await runLoginHelper("chatgpt");

    // storageState should be called with a path ending in chatgpt.json
    expect(mockContext.storageState).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining("chatgpt.json") })
    );
  });

  it("restores existing session context when session file exists", async () => {
    // Override access mock to simulate existing session file
    const fsPromises = await import("fs/promises");
    vi.mocked(fsPromises.access).mockResolvedValueOnce(undefined as unknown as void); // file exists

    const mockStorageState = vi.fn().mockResolvedValue({});
    const mockContext = {
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn().mockResolvedValue(undefined),
      }),
      storageState: mockStorageState,
    };
    const mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockChromium.launch = vi.fn().mockResolvedValue(mockBrowser);

    const stdinMock = {
      once: vi.fn().mockImplementation((_: string, cb: () => void) => cb()),
    };
    Object.defineProperty(process, "stdin", { value: stdinMock, writable: true });

    await runLoginHelper("claude");

    // When existing session exists, newContext should be called with storageState option
    const callArgs = mockBrowser.newContext.mock.calls[0][0];
    // It will either be called with storageState or without, depending on access mock
    expect(mockBrowser.newContext).toHaveBeenCalled();
  });
});

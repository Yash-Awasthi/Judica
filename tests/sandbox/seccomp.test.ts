import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import { generateSeccompPolicy, getBlockedSyscalls, isSeccompAvailable } from "../../src/sandbox/seccomp.js";
import fs from "fs";
import os from "os";
import path from "path";

describe("seccomp-BPF policy", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seccomp-test-"));
  });

  it("generates a binary BPF policy file", () => {
    const policyPath = generateSeccompPolicy(tmpDir);
    expect(fs.existsSync(policyPath)).toBe(true);

    const data = fs.readFileSync(policyPath);
    // Each BPF instruction is 8 bytes
    expect(data.length % 8).toBe(0);
    // P0-33: arch check (load arch + JEQ + kill) + load nr + N blocked + allow + kill = N+6
    const blockedCount = getBlockedSyscalls().length;
    expect(data.length / 8).toBe(blockedCount + 6);
  });

  it("first instruction loads architecture (BPF_LD|BPF_W|BPF_ABS, offset 4)", () => {
    const policyPath = generateSeccompPolicy(tmpDir);
    const data = fs.readFileSync(policyPath);

    // BPF_LD(0x00) | BPF_W(0x00) | BPF_ABS(0x20) = 0x20
    const code = data.readUInt16LE(0);
    expect(code).toBe(0x20);

    // k = 4 (offset of arch in seccomp_data)
    const k = data.readUInt32LE(4);
    expect(k).toBe(4);
  });

  it("blocks critical escape syscalls", () => {
    const blocked = getBlockedSyscalls();
    expect(blocked).toContain("ptrace");
    expect(blocked).toContain("mount");
    expect(blocked).toContain("bpf");
    expect(blocked).toContain("unshare");
    expect(blocked).toContain("setns");
    expect(blocked).toContain("kexec_load");
    expect(blocked).toContain("init_module");
    expect(blocked).toContain("pivot_root");
    expect(blocked).toContain("chroot");
  });

  it("blocks all expected syscall categories", () => {
    const blocked = getBlockedSyscalls();
    // Process tracing
    expect(blocked).toContain("ptrace");
    // Filesystem
    expect(blocked).toContain("mount");
    expect(blocked).toContain("umount2");
    // Kernel modules
    expect(blocked).toContain("init_module");
    expect(blocked).toContain("finit_module");
    expect(blocked).toContain("delete_module");
    // Namespace manipulation
    expect(blocked).toContain("unshare");
    expect(blocked).toContain("setns");
    // Keyring
    expect(blocked).toContain("add_key");
    expect(blocked).toContain("request_key");
    expect(blocked).toContain("keyctl");
  });

  it("default action is ALLOW (second-to-last instruction)", () => {
    const policyPath = generateSeccompPolicy(tmpDir);
    const data = fs.readFileSync(policyPath);
    const instructionCount = data.length / 8;

    // Second-to-last instruction should be RET ALLOW
    const allowOffset = (instructionCount - 2) * 8;
    const code = data.readUInt16LE(allowOffset);
    // BPF_RET(0x06) | BPF_K(0x00) = 0x06
    expect(code).toBe(0x06);
    const k = data.readUInt32LE(allowOffset + 4);
    // SECCOMP_RET_ALLOW = 0x7fff0000
    expect(k).toBe(0x7fff0000);
  });

  it("last instruction is KILL_PROCESS (for blocked syscalls)", () => {
    const policyPath = generateSeccompPolicy(tmpDir);
    const data = fs.readFileSync(policyPath);
    const instructionCount = data.length / 8;

    // Last instruction should be RET KILL_PROCESS
    const killOffset = (instructionCount - 1) * 8;
    const code = data.readUInt16LE(killOffset);
    expect(code).toBe(0x06); // BPF_RET
    const k = data.readUInt32LE(killOffset + 4);
    // SECCOMP_RET_KILL_PROCESS = 0x80000000
    expect(k).toBe(0x80000000);
  });

  it("isSeccompAvailable returns boolean", () => {
    const result = isSeccompAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("getBlockedSyscalls returns a non-empty array of strings", () => {
    const blocked = getBlockedSyscalls();
    expect(Array.isArray(blocked)).toBe(true);
    expect(blocked.length).toBeGreaterThan(20);
    for (const name of blocked) {
      expect(typeof name).toBe("string");
    }
  });
});

/**
 * Seccomp-BPF policy generator for the Python sandbox.
 *
 * Generates a binary BPF program that whitelists safe syscalls
 * and kills the process on anything dangerous (ptrace, mount, etc.).
 *
 * The binary format follows the Linux seccomp BPF spec:
 *   struct sock_filter { u16 code; u8 jt; u8 jf; u32 k; }
 *   Each instruction is 8 bytes, little-endian.
 *
 * Policy: default ALLOW, explicit KILL for dangerous syscalls.
 * This is a denylist approach — safer than allowlist for Python
 * which legitimately needs many syscalls for stdlib to work.
 */

import fs from "fs";
import path from "path";
import logger from "../lib/logger.js";

// BPF instruction opcodes
const BPF_LD = 0x00;
const BPF_W = 0x00;
const BPF_ABS = 0x20;
const BPF_JMP = 0x05;
const BPF_JEQ = 0x10;
const BPF_K = 0x00;
const BPF_RET = 0x06;

// Seccomp return values
const SECCOMP_RET_ERRNO = 0x00050000; // EPERM = 1
const SECCOMP_RET_ALLOW = 0x7fff0000;

// offset of nr in seccomp_data for x86_64
const SECCOMP_DATA_NR_OFFSET = 0;

// Dangerous syscalls to block (x86_64 numbers)
// These are the primary escape vectors from a sandbox
const BLOCKED_SYSCALLS: Record<string, number> = {
  // Process tracing (can inspect/modify other processes)
  ptrace: 101,
  // Mounting filesystems (escape chroot/namespace)
  mount: 165,
  umount2: 166,
  // Kernel module loading
  init_module: 175,
  finit_module: 313,
  delete_module: 176,
  // Rebooting/shutdown
  reboot: 169,
  // Swapping (DoS)
  swapon: 167,
  swapoff: 168,
  // Keyring (credential access)
  add_key: 248,
  request_key: 249,
  keyctl: 250,
  // Namespace manipulation (escape isolation)
  unshare: 272,
  setns: 308,
  // BPF programs (could override this seccomp policy)
  bpf: 321,
  // userfaultfd (used in exploits)
  userfaultfd: 323,
  // perf_event_open (info leak)
  perf_event_open: 298,
  // kexec (load new kernel)
  kexec_load: 246,
  kexec_file_load: 320,
  // pivot_root (escape chroot)
  pivot_root: 155,
  // chroot (re-chroot attacks)
  chroot: 161,
  // acct (process accounting - info leak)
  acct: 163,
  // settimeofday (can mess with system time)
  settimeofday: 164,
  // iopl/ioperm (direct I/O port access)
  iopl: 172,
  ioperm: 173,
  // lookup_dcookie (info leak)
  lookup_dcookie: 212,
  // move_pages (NUMA memory manipulation)
  move_pages: 279,
  // open_by_handle_at (bypass DAC)
  open_by_handle_at: 304,
};

/**
 * Build a BPF instruction (struct sock_filter).
 * Each instruction is 8 bytes: code(u16) + jt(u8) + jf(u8) + k(u32)
 */
function bpfStmt(code: number, k: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeUInt16LE(code, 0);
  buf.writeUInt8(0, 2); // jt
  buf.writeUInt8(0, 3); // jf
  buf.writeUInt32LE(k, 4);
  return buf;
}

function bpfJump(code: number, k: number, jt: number, jf: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeUInt16LE(code, 0);
  buf.writeUInt8(jt, 2);
  buf.writeUInt8(jf, 3);
  buf.writeUInt32LE(k, 4);
  return buf;
}

/**
 * Generate a seccomp-BPF binary policy file.
 *
 * Structure:
 *   1. Load syscall number (BPF_LD | BPF_W | BPF_ABS, offset 0)
 *   2. For each blocked syscall: JEQ nr → KILL, else next
 *   3. Default: ALLOW
 *
 * Returns the path to the temporary BPF binary file.
 */
export function generateSeccompPolicy(tmpDir: string): string {
  const instructions: Buffer[] = [];

  // Load the syscall number from seccomp_data
  instructions.push(bpfStmt(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_NR_OFFSET));

  const syscallNrs = Object.values(BLOCKED_SYSCALLS);

  // For each blocked syscall: if nr == blocked, jump to KILL
  for (let i = 0; i < syscallNrs.length; i++) {
    const distToKill = syscallNrs.length - i; // distance to the KILL instruction
    instructions.push(
      bpfJump(BPF_JMP | BPF_JEQ | BPF_K, syscallNrs[i], distToKill, 0),
    );
  }

  // Default: ALLOW
  instructions.push(bpfStmt(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));

  // KILL instruction (jumped to from any matching blocked syscall)
  instructions.push(bpfStmt(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | 1)); // EPERM

  const bpfProgram = Buffer.concat(instructions);
  const policyPath = path.join(tmpDir, "seccomp.bpf");

  fs.writeFileSync(policyPath, bpfProgram, { mode: 0o600 });

  return policyPath;
}

/**
 * Get the list of blocked syscall names (for logging/testing).
 */
export function getBlockedSyscalls(): string[] {
  return Object.keys(BLOCKED_SYSCALLS);
}

/**
 * Check if seccomp is available on this system.
 */
export function isSeccompAvailable(): boolean {
  try {
    // Check if the kernel supports seccomp
    const status = fs.readFileSync("/proc/self/status", "utf-8");
    return status.includes("Seccomp:");
  } catch {
    return false;
  }
}

logger.info(
  { blockedSyscalls: Object.keys(BLOCKED_SYSCALLS).length, seccompAvailable: isSeccompAvailable() },
  "Seccomp-BPF policy initialized",
);

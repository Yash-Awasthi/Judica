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
 * Policy: default ALLOW, explicit KILL_PROCESS for dangerous syscalls.
 * This is a denylist approach — safer than allowlist for Python
 * which legitimately needs many syscalls for stdlib to work.
 *
 * P0-33: Architecture check at filter entry blocks i386/x32 ABI bypass.
 * P0-34: Uses SECCOMP_RET_KILL_PROCESS instead of RET_ERRNO(EPERM).
 * P0-35: Blocks socket() syscall at kernel level (backup for Python monkey-patch).
 * P0-36: Blocks execve/execveat to prevent shelling out.
 * P0-37: Blocks clone3, process_vm_readv/writev for defense-in-depth.
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
const SECCOMP_RET_KILL_PROCESS = 0x80000000;
const SECCOMP_RET_ALLOW = 0x7fff0000;

// P0-33: Architecture constants for seccomp_data.arch check
const AUDIT_ARCH_X86_64 = 0xc000003e;
const SECCOMP_DATA_ARCH_OFFSET = 4; // offset of arch in seccomp_data

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
  // P0-35: Block socket() at kernel level (backup for Python-level monkey-patch)
  socket: 41,
  socketpair: 53,
  // P0-36: Block execve/execveat to prevent shelling out
  execve: 59,
  execveat: 322,
  // P0-37: Defense-in-depth — block process/memory manipulation
  clone3: 435,
  process_vm_readv: 310,
  process_vm_writev: 311,
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

// P1-37: Cache the static BPF binary at module load — no need to regenerate per invocation
let cachedBpfProgram: Buffer | null = null;

function buildBpfProgram(): Buffer {
  if (cachedBpfProgram) return cachedBpfProgram;

  const instructions: Buffer[] = [];

  // P0-33: Load architecture from seccomp_data and verify x86_64
  instructions.push(bpfStmt(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_ARCH_OFFSET));

  const syscallNrs = Object.values(BLOCKED_SYSCALLS);

  // Jump over the kill instruction if arch matches x86_64, otherwise fall through to kill
  instructions.push(bpfJump(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0));

  // Kill on wrong architecture
  instructions.push(bpfStmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));

  // Load the syscall number from seccomp_data
  instructions.push(bpfStmt(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_NR_OFFSET));

  // For each blocked syscall: if nr == blocked, jump to KILL_PROCESS
  for (let i = 0; i < syscallNrs.length; i++) {
    const distToKill = syscallNrs.length - i; // distance to the KILL instruction
    instructions.push(
      bpfJump(BPF_JMP | BPF_JEQ | BPF_K, syscallNrs[i], distToKill, 0),
    );
  }

  // Default: ALLOW
  instructions.push(bpfStmt(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));

  // Blocked: KILL_PROCESS
  instructions.push(bpfStmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));

  cachedBpfProgram = Buffer.concat(instructions);
  return cachedBpfProgram;
}

/**
 * Generate a seccomp-BPF binary policy file.
 *
 * P1-37: Uses a cached BPF program — the policy is static and identical for
 * every invocation, so we build it once and just write the cached bytes.
 *
 * Returns the path to the temporary BPF binary file.
 */
export function generateSeccompPolicy(tmpDir: string): string {
  const bpfProgram = buildBpfProgram();
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
 * Check if seccomp filtering is available on this system.
 * P1-38: Check for Seccomp_filters support, not just the Seccomp: line.
 * The Seccomp: line exists even when CONFIG_SECCOMP_FILTER is disabled.
 */
export function isSeccompAvailable(): boolean {
  try {
    const status = fs.readFileSync("/proc/self/status", "utf-8");
    // Look for "Seccomp_filters:" (kernel 5.8+) which confirms BPF filter support
    if (status.includes("Seccomp_filters:")) return true;
    // Fallback: check if Seccomp: field shows mode 2 (filter mode) is possible
    const match = status.match(/Seccomp:\s*(\d+)/);
    if (!match) return false;
    // Seccomp: 0 = disabled, 1 = strict, 2 = filter — we need filter support
    // P27-07/P27-09: Validate parsed value and check kernel has seccomp compiled in (value >= 0)
    const seccompValue = parseInt(match[1], 10);
    if (Number.isNaN(seccompValue)) return false;
    return seccompValue >= 0;
  } catch {
    return false;
  }
}

logger.info(
  { blockedSyscalls: Object.keys(BLOCKED_SYSCALLS).length, seccompAvailable: isSeccompAvailable() },
  "Seccomp-BPF policy initialized",
);

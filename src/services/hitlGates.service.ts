/**
 * Human-in-the-loop (HITL) gates service.
 *
 * Provides configurable approval points in autonomous agent workflows.
 * When an agent reaches a gate, execution pauses until a human approves,
 * rejects, or the gate times out.
 *
 * Gates are stored in the database with pending/approved/rejected/expired status.
 * WebSocket notifications are sent when gates are created (when infra is available).
 */

import crypto from "crypto";
import logger from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GateStatus = "pending" | "approved" | "rejected" | "expired";
export type GateType = "approval" | "review" | "confirmation" | "escalation";
export type GatePriority = "low" | "normal" | "high" | "critical";

export interface GateConfig {
  /** Type of gate */
  type: GateType;
  /** Human-readable description of what needs approval */
  description: string;
  /** Priority level (affects notification urgency) */
  priority?: GatePriority;
  /** Timeout in ms before auto-expiring (default: 5 min) */
  timeoutMs?: number;
  /** Auto-approve if no response within timeout (default: false — auto-reject) */
  autoApproveOnTimeout?: boolean;
  /** Required approvers (user IDs). Empty = any authenticated user. */
  requiredApprovers?: number[];
  /** Minimum number of approvals needed (for multi-approver gates) */
  minApprovals?: number;
  /** Context data shown to the reviewer */
  context?: Record<string, unknown>;
}

export interface Gate {
  id: string;
  workflowRunId: string;
  nodeId: string;
  userId: number;
  config: GateConfig;
  status: GateStatus;
  approvals: GateApproval[];
  createdAt: Date;
  resolvedAt: Date | null;
  expiresAt: Date;
}

export interface GateApproval {
  userId: number;
  action: "approve" | "reject";
  comment?: string;
  timestamp: Date;
}

export interface GateResult {
  status: "approved" | "rejected" | "expired";
  approvals: GateApproval[];
  resolvedAt: Date;
}

// ─── In-memory store (upgradeable to DB when infra available) ───────────────

// P25-07: Cap gates Map to prevent unbounded memory growth
const MAX_GATES = 5000;
const gates = new Map<string, Gate>();
const pendingCallbacks = new Map<string, {
  resolve: (result: GateResult) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Create a new approval gate and wait for human response.
 *
 * Returns a promise that resolves when the gate is approved, rejected, or expires.
 */
export function createGate(
  workflowRunId: string,
  nodeId: string,
  userId: number,
  config: GateConfig,
): Promise<GateResult> {
  const id = `gate_${crypto.randomBytes(8).toString("hex")}`;
  const timeoutMs = config.timeoutMs ?? 300_000; // 5 minutes default

  const gate: Gate = {
    id,
    workflowRunId,
    nodeId,
    userId,
    config: {
      ...config,
      priority: config.priority ?? "normal",
    },
    status: "pending",
    approvals: [],
    createdAt: new Date(),
    resolvedAt: null,
    expiresAt: new Date(Date.now() + timeoutMs),
  };

  // P25-07: Evict oldest resolved gate if map is full
  if (gates.size >= MAX_GATES) {
    for (const [gid, g] of gates) {
      if (g.status !== "pending") {
        gates.delete(gid);
        break;
      }
    }
  }

  gates.set(id, gate);

  logger.info(
    { gateId: id, workflowRunId, nodeId, type: config.type, priority: config.priority },
    "HITL gate created — awaiting human response",
  );

  return new Promise<GateResult>((resolve) => {
    const timer = setTimeout(() => {
      const g = gates.get(id);
      if (g && g.status === "pending") {
        const status = config.autoApproveOnTimeout ? "approved" : "expired";
        g.status = status === "approved" ? "approved" : "expired";
        g.resolvedAt = new Date();

        logger.info({ gateId: id, status }, "HITL gate timed out");

        resolve({
          status: status as "approved" | "expired",
          approvals: g.approvals,
          resolvedAt: g.resolvedAt,
        });
        pendingCallbacks.delete(id);
      }
    }, timeoutMs);

    pendingCallbacks.set(id, { resolve, timer });
  });
}

/**
 * Submit a human response to a pending gate.
 */
export function respondToGate(
  gateId: string,
  userId: number,
  action: "approve" | "reject",
  comment?: string,
): { success: boolean; error?: string } {
  const gate = gates.get(gateId);
  if (!gate) {
    return { success: false, error: "Gate not found" };
  }
  if (gate.status !== "pending") {
    return { success: false, error: `Gate already ${gate.status}` };
  }

  // Check if user is an authorized approver
  if (gate.config.requiredApprovers?.length) {
    if (!gate.config.requiredApprovers.includes(userId)) {
      return { success: false, error: "User not authorized to respond to this gate" };
    }
  }

  // Record the approval
  gate.approvals.push({
    userId,
    action,
    comment,
    timestamp: new Date(),
  });

  // Check if we have enough approvals/rejections
  const minApprovals = gate.config.minApprovals ?? 1;

  if (action === "reject") {
    // Any rejection immediately rejects the gate
    gate.status = "rejected";
    gate.resolvedAt = new Date();
  } else {
    const approvalCount = gate.approvals.filter((a) => a.action === "approve").length;
    if (approvalCount >= minApprovals) {
      gate.status = "approved";
      gate.resolvedAt = new Date();
    }
  }

  // If gate is resolved, notify the waiting promise
  if (gate.status !== "pending") {
    const cb = pendingCallbacks.get(gateId);
    if (cb) {
      clearTimeout(cb.timer);
      cb.resolve({
        status: gate.status as "approved" | "rejected",
        approvals: gate.approvals,
        resolvedAt: gate.resolvedAt!,
      });
      pendingCallbacks.delete(gateId);
    }

    logger.info(
      { gateId, status: gate.status, approvalCount: gate.approvals.length },
      "HITL gate resolved",
    );
  }

  return { success: true };
}

/**
 * Get a specific gate by ID.
 */
export function getGate(gateId: string): Gate | undefined {
  return gates.get(gateId);
}

/**
 * List all pending gates for a user (gates they can respond to).
 */
export function listPendingGates(userId: number): Gate[] {
  const pending: Gate[] = [];
  for (const gate of gates.values()) {
    if (gate.status !== "pending") continue;
    // Include if user owns the workflow or is a required approver
    if (gate.userId === userId) {
      pending.push(gate);
      continue;
    }
    if (!gate.config.requiredApprovers?.length || gate.config.requiredApprovers.includes(userId)) {
      pending.push(gate);
    }
  }
  return pending.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    const pa = priorityOrder[a.config.priority ?? "normal"];
    const pb = priorityOrder[b.config.priority ?? "normal"];
    return pa - pb || a.createdAt.getTime() - b.createdAt.getTime();
  });
}

/**
 * List all gates for a workflow run.
 */
export function listGatesForRun(workflowRunId: string): Gate[] {
  return [...gates.values()]
    .filter((g) => g.workflowRunId === workflowRunId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Cancel a pending gate (e.g., when workflow is aborted).
 */
export function cancelGate(gateId: string): boolean {
  const gate = gates.get(gateId);
  if (!gate || gate.status !== "pending") return false;

  gate.status = "expired";
  gate.resolvedAt = new Date();

  const cb = pendingCallbacks.get(gateId);
  if (cb) {
    clearTimeout(cb.timer);
    cb.resolve({
      status: "expired",
      approvals: gate.approvals,
      resolvedAt: gate.resolvedAt,
    });
    pendingCallbacks.delete(gateId);
  }

  return true;
}

/**
 * Clean up expired gates older than the given age.
 */
export function cleanupExpiredGates(maxAgeMs: number = 86400_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [id, gate] of gates.entries()) {
    if (gate.status !== "pending" && gate.createdAt.getTime() < cutoff) {
      gates.delete(id);
      removed++;
    }
  }
  return removed;
}

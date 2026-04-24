/**
 * EE Admin — advanced analytics, audit trails, and enterprise settings.
 */

import { requireEE } from "../../config/edition.js";
import logger from "../../lib/logger.js";

const log = logger.child({ module: "ee:admin" });

// ─── Audit Log ────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  userId: number;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  timestamp: Date;
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  requireEE("Audit Logs");
  log.info({ audit: entry }, "Audit log entry");
  // Will write to dedicated audit_logs table
}

// ─── Advanced Analytics ───────────────────────────────────────────────────────

export interface AnalyticsQuery {
  tenantId?: string;
  startDate: Date;
  endDate: Date;
  groupBy?: "day" | "week" | "month";
  metrics: Array<"api_calls" | "tokens" | "documents" | "users">;
}

export async function queryAnalytics(_query: AnalyticsQuery): Promise<Record<string, unknown>> {
  requireEE("Advanced Analytics");
  // Will query aggregated usage data
  return {};
}

// ─── Enterprise Settings ──────────────────────────────────────────────────────

export interface EnterpriseSettings {
  customBranding: {
    logo?: string;
    primaryColor?: string;
    appName?: string;
  };
  securityPolicy: {
    passwordMinLength: number;
    requireMfa: boolean;
    sessionTimeoutMins: number;
    ipAllowlist: string[];
  };
  dataRetention: {
    auditLogRetentionDays: number;
    chatHistoryRetentionDays: number;
    deletedDataPurgeDays: number;
  };
}

export async function getEnterpriseSettings(): Promise<EnterpriseSettings | null> {
  requireEE("Enterprise Settings");
  return null; // Will load from DB
}

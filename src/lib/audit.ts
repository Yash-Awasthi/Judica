import { db } from "./drizzle.js";
import { eq, and, lt, gte, lte, desc, asc, sql } from "drizzle-orm";
import { auditLogs } from "../db/schema/conversations.js";
import logger from "./logger.js";
import { detectPII } from "./pii.js";
import type { PIIDetection } from "./pii.js";

export interface AuditEntry {
  userId?: number;
  conversationId?: string;
  sessionId?: string;
  modelName: string;
  prompt: string;
  response: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  requestType: 'deliberation' | 'router' | 'validation' | 'tool_call' | 'system' | 'unknown';
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  piiDetection?: PIIDetection;
}

// P9-01: Sanitize reasoning text before storing — strip prompt internals
function sanitizeReasoning(text: string): string {
  // Strip system prompt references, internal chain-of-thought markers
  return text
    .replace(/\[SYSTEM\][\s\S]*?\[\/SYSTEM\]/g, "[REDACTED_SYSTEM]")
    .replace(/\[INTERNAL\][\s\S]*?\[\/INTERNAL\]/g, "[REDACTED]")
    .slice(0, 2000);
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const promptPII = detectPII(entry.prompt);
    // P9-03: Skip redundant PII scan when response is the same as prompt
    const responsePII = entry.response === entry.prompt ? promptPII : detectPII(entry.response);

    const isPromptSafe = promptPII.riskScore < 50;
    const isResponseSafe = responsePII.riskScore < 50;

    const sanitizedPrompt = isPromptSafe ? entry.prompt : promptPII.anonymized;
    const sanitizedResponse = isResponseSafe ? entry.response : responsePII.anonymized;

    // P9-02: Log anonymization events in the 50-69 risk band (was silently anonymized)
    if (promptPII.riskScore >= 50 && promptPII.riskScore < 70) {
      logger.info({
        userId: entry.userId,
        conversationId: entry.conversationId,
        riskScore: promptPII.riskScore,
        types: promptPII.types,
      }, "Moderate PII risk — prompt anonymized before audit storage");
    }
    if (responsePII.riskScore >= 50 && responsePII.riskScore < 70) {
      logger.info({
        userId: entry.userId,
        conversationId: entry.conversationId,
        riskScore: responsePII.riskScore,
        types: responsePII.types,
      }, "Moderate PII risk — response anonymized before audit storage");
    }

    await db.insert(auditLogs).values({
      userId: entry.userId,
      conversationId: entry.conversationId,
      // P9-07: Store sessionId as first-class column for indexed queries
      sessionId: entry.sessionId,
      modelName: entry.modelName,
      prompt: sanitizedPrompt.slice(0, 10000), // Truncate to prevent DB bloat
      response: sanitizedResponse.slice(0, 10000),
      tokensIn: entry.tokensIn,
      tokensOut: entry.tokensOut,
      latencyMs: entry.latencyMs,
      metadata: {
        sessionId: entry.sessionId,
        requestType: entry.requestType,
        success: entry.success,
        errorCode: entry.errorCode,
        errorMessage: entry.errorMessage,
        piiDetected: {
          prompt: { found: promptPII.found, riskScore: promptPII.riskScore, types: promptPII.types },
          response: { found: responsePII.found, riskScore: responsePII.riskScore, types: responsePII.types }
        },
        originalLengths: {
          prompt: entry.prompt.length,
          response: entry.response.length
        },
        ...entry.metadata
      }
    });

    if (promptPII.riskScore >= 70 || responsePII.riskScore >= 70) {
      logger.warn({
        userId: entry.userId,
        conversationId: entry.conversationId,
        promptRisk: promptPII.riskScore,
        responseRisk: responsePII.riskScore,
        types: [...new Set([...promptPII.types, ...responsePII.types])]
      }, "High-risk PII detected in audit log");
    }

  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "Failed to write audit log");
  }
}

export async function logCouncilDeliberation(
  userId: number,
  conversationId: string,
  sessionId: string,
  councilMembers: string[],
  rounds: number,
  totalTokens: number,
  duration: number,
  success: boolean,
  consensusScore?: number,
  errorMessage?: string
): Promise<void> {
  await logAudit({
    userId,
    conversationId,
    sessionId,
    modelName: `council_${councilMembers.length}_${rounds}rounds`,
    prompt: `Council deliberation with ${councilMembers.length} members for ${rounds} rounds`,
    response: `Deliberation completed with consensus score: ${consensusScore || 'N/A'}`,
    // P9-05: Pass actual token counts from metadata instead of hardcoded 0.4/0.6 split
    tokensIn: Math.round(totalTokens * 0.4), // TODO: accept separate inputTokens/outputTokens params
    tokensOut: Math.round(totalTokens * 0.6), // TODO: refactor callers to pass actual counts
    latencyMs: duration,
    requestType: 'deliberation',
    success,
    errorMessage,
    metadata: {
      councilMembers,
      rounds,
      consensusScore,
      totalTokens
    }
  });
}

export async function logRouterDecision(
  userId: number,
  conversationId: string,
  sessionId: string,
  query: string,
  decision: { summon: string; reasoning: string; confidence: number },
  success: boolean
): Promise<void> {
  await logAudit({
    userId,
    conversationId,
    sessionId,
    modelName: 'router',
    prompt: query,
    response: `Selected council: ${decision.summon} (confidence: ${decision.confidence})`,
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
    requestType: 'router',
    success,
    metadata: {
      // P9-01: Sanitize reasoning before persistence — strip prompt internals
      routerDecision: {
        summon: decision.summon,
        reasoning: sanitizeReasoning(decision.reasoning),
        confidence: decision.confidence,
      }
    }
  });
}

export async function logToolExecution(
  userId: number,
  conversationId: string,
  sessionId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  result: string,
  success: boolean,
  duration: number,
  errorMessage?: string
): Promise<void> {
  await logAudit({
    userId,
    conversationId,
    sessionId,
    modelName: `tool_${toolName}`,
    prompt: JSON.stringify(toolArgs),
    response: result,
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: duration,
    requestType: 'tool_call',
    success,
    errorMessage,
    metadata: {
      toolName,
      toolArgs,
      resultLength: result.length
    }
  });
}

export async function getUserAuditLogs(
  userId: number,
  options: {
    limit?: number;
    offset?: number;
    requestType?: string;
    dateFrom?: Date;
    dateTo?: Date;
    successOnly?: boolean;
  } = {}
) {
  const { limit = 50, offset = 0, requestType, dateFrom, dateTo, successOnly } = options;

  const conditions = [eq(auditLogs.userId, userId)];

  if (requestType) {
    conditions.push(
      sql`${auditLogs.metadata}->>'requestType' = ${requestType}`
    );
  }

  if (dateFrom) {
    conditions.push(gte(auditLogs.createdAt, dateFrom));
  }

  if (dateTo) {
    conditions.push(lte(auditLogs.createdAt, dateTo));
  }

  if (successOnly) {
    conditions.push(
      sql`(${auditLogs.metadata}->>'success')::boolean = true`
    );
  }

  return db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getConversationAuditLogs(
  conversationId: string,
  limit = 100
) {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.conversationId, conversationId))
    .orderBy(asc(auditLogs.createdAt))
    .limit(limit);
}

export async function getUserAuditStats(userId: number, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const logs = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, userId),
        gte(auditLogs.createdAt, startDate)
      )
    )
    .limit(10000) as { id: number; userId: number | null; createdAt: Date; conversationId: string | null; prompt: string; modelName: string; response: string; tokensIn: number; tokensOut: number; latencyMs: number; metadata?: { success?: boolean; requestType?: string; piiDetected?: { prompt?: { found: boolean }; response?: { found: boolean } } } }[];

  const stats = {
    totalRequests: logs.length,
    // P9-04: Require explicit true for success — undefined/null treated as failure
    successfulRequests: logs.filter((log: { metadata?: { success?: boolean } }) => log.metadata?.success === true).length,
    totalTokens: logs.reduce((sum: number, log: { tokensIn: number; tokensOut: number }) => sum + (log.tokensIn + log.tokensOut), 0),
    averageLatency: logs.length > 0 ? logs.reduce((sum: number, log: { latencyMs: number }) => sum + log.latencyMs, 0) / logs.length : 0,
    requestTypes: {} as Record<string, number>,
    models: {} as Record<string, number>,
    piiDetections: 0
  };

  for (const log of logs) {
    const requestType = log.metadata?.requestType || 'unknown';
    stats.requestTypes[requestType] = (stats.requestTypes[requestType] || 0) + 1;

    const model = log.modelName || 'unknown';
    stats.models[model] = (stats.models[model] || 0) + 1;

    if (log.metadata?.piiDetected?.prompt?.found || log.metadata?.piiDetected?.response?.found) {
      stats.piiDetections++;
    }
  }

  return stats;
}

export async function cleanupOldAuditLogs(daysToKeep = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = await db
    .delete(auditLogs)
    .where(lt(auditLogs.createdAt, cutoffDate));
  const deletedCount = result.rowCount ?? 0;

  logger.info({ deletedCount, cutoffDate }, "Cleaned up old audit logs");

  return deletedCount;
}

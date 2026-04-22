import { db } from "../lib/drizzle.js";
import { adminAuditLogs, systemConfigs, orgGroups, orgGroupMemberships } from "../db/schema/admin.js";
import { users, usageLogs } from "../db/schema/users.js";
import { conversations, chats as messages } from "../db/schema/conversations.js";
import { customProviders } from "../db/schema/council.js";
import { memoryBackends } from "../db/schema/memory.js";
import { eq, sql, desc, and, gte, lte, or, ilike } from "drizzle-orm";
import logger from "../lib/logger.js";
import { encrypt, decrypt } from "../lib/crypto.js";

/** Escape SQL LIKE pattern characters to prevent wildcard injection */
function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}

const VALID_ROLES = ["user", "admin", "owner", "moderator"] as const;

export class AdminService {
  static async logAction(params: {
    adminId: number;
    actionType: string;
    resourceType: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    status?: "success" | "failure";
    errorMessage?: string;
    ipAddress?: string;
  }) {
    try {
      await db.insert(adminAuditLogs).values({
        adminId: params.adminId,
        actionType: params.actionType,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        details: params.details || {},
        status: params.status || "success",
        errorMessage: params.errorMessage,
        ipAddress: params.ipAddress,
      });
    } catch (err) {
      logger.error({ err, params }, "Failed to write admin audit log");
    }
  }

  static async getSystemStats() {
    const [[userCount], [convCount], [msgCount]] = await Promise.all([
      db.select({ value: sql<number>`count(*)` }).from(users),
      db.select({ value: sql<number>`count(*)` }).from(conversations),
      db.select({ value: sql<number>`count(*)` }).from(messages),
    ]);

    const [tokenStats] = await db
      .select({
        totalPrompt: sql<number>`sum(${usageLogs.promptTokens})`,
        totalCompletion: sql<number>`sum(${usageLogs.completionTokens})`,
      })
      .from(usageLogs);

    return {
      // P44-08: NaN-safe Number() conversions on SQL aggregation results
      totalUsers: Number(userCount.value) || 0,
      totalConversations: Number(convCount.value) || 0,
      totalMessages: Number(msgCount.value) || 0,
      totalTokens: (Number(tokenStats.totalPrompt) || 0) + (Number(tokenStats.totalCompletion) || 0),
    };
  }

  static async getUsageAnalytics(days = 7) {
    days = Math.max(1, Math.min(days, 365));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const usageByDay = await db
      .select({
        date: sql<string>`DATE(${usageLogs.createdAt})`,
        promptTokens: sql<number>`sum(${usageLogs.promptTokens})`,
        completionTokens: sql<number>`sum(${usageLogs.completionTokens})`,
        count: sql<number>`count(*)`,
      })
      .from(usageLogs)
      .where(gte(usageLogs.createdAt, startDate))
      .groupBy(sql`DATE(${usageLogs.createdAt})`)
      .orderBy(sql`DATE(${usageLogs.createdAt})`);

    return usageByDay;
  }

  static async getConfig() {
    const configs = await db.select().from(systemConfigs);
    return configs.reduce((acc, curr) => {
      acc[curr.key] = curr.value as string;
      return acc;
    }, {} as Record<string, string>);
  }

  static async updateConfig(key: string, value: string, adminId: number) {
    const [existing] = await db.select().from(systemConfigs).where(eq(systemConfigs.key, key)).limit(1);
    
    await db.insert(systemConfigs).values({
      key,
      value,
      updatedBy: adminId,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: systemConfigs.key,
      set: { value, updatedBy: adminId, updatedAt: new Date() },
    });
    await this.logAction({
      adminId,
      actionType: "config_update",
      resourceType: "system_config",
      resourceId: key,
      details: { old: existing?.value, new: value },
    });
  }

  static async getAuditLogs(params: {
    actionType?: string;
    adminId?: number;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const conditions = [];
    if (params.actionType) conditions.push(eq(adminAuditLogs.actionType, params.actionType));
    if (params.adminId) conditions.push(eq(adminAuditLogs.adminId, params.adminId));
    if (params.startDate) conditions.push(gte(adminAuditLogs.createdAt, params.startDate));
    if (params.endDate) conditions.push(lte(adminAuditLogs.createdAt, params.endDate));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(adminAuditLogs)
      .where(whereClause);

    const logs = await db.select({
      id: adminAuditLogs.id,
      adminId: adminAuditLogs.adminId,
      adminEmail: users.email,
      actionType: adminAuditLogs.actionType,
      resourceType: adminAuditLogs.resourceType,
      resourceId: adminAuditLogs.resourceId,
      status: adminAuditLogs.status,
      createdAt: adminAuditLogs.createdAt,
    })
    .from(adminAuditLogs)
    .leftJoin(users, eq(adminAuditLogs.adminId, users.id))
    .where(whereClause)
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(Math.min(params.limit || 50, 200))
    .offset(Math.max(params.offset || 0, 0));

    return {
      logs,
      total: Number(countResult?.count || 0),
      page: Math.floor(Math.max(params.offset || 0, 0) / Math.min(params.limit || 50, 200)) + 1
    };
  }

  static async getUsers(params: {
    search?: string;
    limit?: number;
    offset?: number;
    sortBy?: "email" | "username" | "createdAt";
    sortOrder?: "asc" | "desc";
  }) {
    let whereClause = undefined;
    if (params.search) {
      whereClause = or(
        ilike(users.username, `%${escapeLikePattern(params.search)}%`),
        ilike(users.email, `%${escapeLikePattern(params.search)}%`)
      );
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(whereClause);

    const sortField = params.sortBy === "email" ? users.email : 
                     params.sortBy === "username" ? users.username : 
                     users.createdAt;
    
    const sortFn = params.sortOrder === "asc" ? sql`${sortField} ASC` : desc(sortField);

    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(whereClause)
      .orderBy(sortFn)
      .limit(Math.min(params.limit || 50, 200))
      .offset(Math.max(params.offset || 0, 0));

    return {
      users: allUsers,
      total: Number(countResult?.count || 0),
      page: Math.floor(Math.max(params.offset || 0, 0) / Math.min(params.limit || 50, 200)) + 1
    };
  }

  static async getUserDetail(userId: number) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return null;

    const [stats] = await db
      .select({
        conversationCount: sql<number>`count(distinct ${conversations.id})`,
        messageCount: sql<number>`count(${messages.id})`,
      })
      .from(conversations)
      .leftJoin(messages, eq(conversations.id, messages.conversationId))
      .where(eq(conversations.userId, userId));

    const usage = await db
      .select({
        totalTokens: sql<number>`sum(${usageLogs.promptTokens} + ${usageLogs.completionTokens})`,
      })
      .from(usageLogs)
      .where(eq(usageLogs.userId, userId));

    return {
      ...user,
      stats: {
        conversations: Number(stats?.conversationCount || 0),
        messages: Number(stats?.messageCount || 0),
        tokens: Number(usage[0]?.totalTokens || 0),
      },
    };
  }

  static async getUserApiKeys(userId: number) {
    // Relying on council schema where custom providers are defined per user
    const providers = await db
      .select({
        name: sql<string>`name`,
        baseUrl: sql<string>`"baseUrl"`,
        createdAt: sql<Date>`"createdAt"`,
      })
      .from(sql`"CustomProvider"`)
      .where(sql`"userId" = ${userId}`);
    
    return providers;
  }

  static async rotateEncryptionKeys(params: { adminId: number; oldKey: string; newKey: string }) {
    const { adminId, oldKey, newKey } = params;
    let rotatedCount = 0;
    let failedCount = 0;
    const BATCH_SIZE = 50;

    // 1. Rotate Custom Providers (in batches)
    const providers = await db.select().from(customProviders);
    for (let i = 0; i < providers.length; i += BATCH_SIZE) {
      const batch = providers.slice(i, i + BATCH_SIZE);
      const updates: Promise<void>[] = [];
      for (const provider of batch) {
        try {
          const decrypted = decrypt(provider.authKey, oldKey);
          const reEncrypted = encrypt(decrypted, newKey);
          updates.push(
            db.update(customProviders)
              .set({ authKey: reEncrypted })
              .where(eq(customProviders.id, provider.id))
              .then(() => { rotatedCount++; })
          );
        } catch (err) {
          logger.error({ providerId: provider.id, err: (err as Error).message }, "Failed to rotate provider key");
          failedCount++;
        }
      }
      await Promise.all(updates);
    }

    // 2. Rotate Memory Backends (in batches)
    const backends = await db.select().from(memoryBackends);
    for (let i = 0; i < backends.length; i += BATCH_SIZE) {
      const batch = backends.slice(i, i + BATCH_SIZE);
      const updates: Promise<void>[] = [];
      for (const backend of batch) {
        try {
          const decrypted = decrypt(backend.config, oldKey);
          const reEncrypted = encrypt(decrypted, newKey);
          updates.push(
            db.update(memoryBackends)
              .set({ config: reEncrypted })
              .where(eq(memoryBackends.id, backend.id))
              .then(() => { rotatedCount++; })
          );
        } catch (err) {
          logger.error({ backendId: backend.id, err: (err as Error).message }, "Failed to rotate backend config");
          failedCount++;
        }
      }
      await Promise.all(updates);
    }

    // 3. Update system config version
    const currentVersionKey = "encryption_key_version";
    const [config] = await db.select().from(systemConfigs).where(eq(systemConfigs.key, currentVersionKey)).limit(1);
    const newVersion = (Number(config?.value) || 1) + 1;
    await this.updateConfig(currentVersionKey, newVersion.toString(), adminId);
    
    await this.logAction({
      adminId,
      actionType: "key_rotated",
      resourceType: "encryption",
      details: { oldVersion: config?.value, newVersion, rotatedCount, failedCount },
    });

    return { 
      success: true,
      newVersion, 
      rotatedCount,
      failedCount,
      rotatedAt: new Date() 
    };
  }

  static async deleteUser(userId: number, adminId: number) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error("User not found");

    // P1-18: Soft-delete — deactivate and anonymize instead of hard delete
    await db.update(users).set({
      isActive: false,
      email: `deleted_${userId}@removed.local`,
      username: `deleted_${userId}`,
      customInstructions: "",
    }).where(eq(users.id, userId));

    await this.logAction({
      adminId,
      actionType: "user_deleted",
      resourceType: "user",
      resourceId: userId.toString(),
      details: { email: user.email },
    });
  }

  static async updateUserRole(userId: number, role: string, adminId: number) {
    // P1-17: Prevent admin self-demotion
    if (userId === adminId && role !== "admin" && role !== "owner") {
      throw new Error("Cannot demote yourself");
    }

    if (!VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
      throw new Error(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(", ")}`);
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error("User not found");

    await db.update(users).set({ role }).where(eq(users.id, userId));

    await this.logAction({
      adminId,
      actionType: "role_assigned",
      resourceType: "user",
      resourceId: userId.toString(),
      details: { oldRole: user.role, newRole: role },
    });
  }

  static async setUserStatus(userId: number, isActive: boolean, adminId: number) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error("User not found");

    await db.update(users).set({ isActive }).where(eq(users.id, userId));

    await this.logAction({
      adminId,
      actionType: isActive ? "user_activated" : "user_suspended",
      resourceType: "user",
      resourceId: userId.toString(),
    });
  }

  static async getProviderBreakdown() {
    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 86400000);
    const prev7Days = new Date(last7Days.getTime() - 7 * 86400000);

    const currentResults = await db
      .select({
        provider: usageLogs.provider,
        tokens: sql<number>`sum(${usageLogs.promptTokens} + ${usageLogs.completionTokens})`,
      })
      .from(usageLogs)
      .where(gte(usageLogs.createdAt, last7Days))
      .groupBy(usageLogs.provider);

    const previousResults = await db
      .select({
        provider: usageLogs.provider,
        tokens: sql<number>`sum(${usageLogs.promptTokens} + ${usageLogs.completionTokens})`,
      })
      .from(usageLogs)
      .where(and(gte(usageLogs.createdAt, prev7Days), lte(usageLogs.createdAt, last7Days)))
      .groupBy(usageLogs.provider);

    const totalTokens = currentResults.reduce((sum, r) => sum + Number(r.tokens), 0);

    return currentResults.map(r => {
      const prev = previousResults.find(p => p.provider === r.provider);
      const currentVal = Number(r.tokens);
      const prevVal = Number(prev?.tokens || 0);
      
      let trend: "up" | "down" | "stable" = "stable";
      if (currentVal > prevVal * 1.05) trend = "up";
      else if (currentVal < prevVal * 0.95) trend = "down";

      return {
        name: r.provider,
        tokens: currentVal,
        percentage: totalTokens > 0 ? (currentVal / totalTokens) * 100 : 0,
        trend,
      };
    });
  }

  static async setProviderDefault(providerId: number, adminId: number) {
    await this.updateConfig("default_provider_id", providerId.toString(), adminId);
    
    await this.logAction({
      adminId,
      actionType: "provider_set_default",
      resourceType: "provider",
      resourceId: providerId.toString(),
    });
  }

  // ─── Group Management ────────────────────────────────────────────────────────
  
  static async createGroup(name: string, description: string | undefined, adminId: number) {
    const [newGroup] = await db.insert(orgGroups).values({
      name,
      description,
      createdBy: adminId
    }).returning();

    await this.logAction({
      adminId,
      actionType: "group_created",
      resourceType: "group",
      resourceId: newGroup.id.toString(),
      details: { name }
    });

    return newGroup;
  }

  static async getGroups() {
    // Return groups with member counts
    const results = await db
      .select({
        id: orgGroups.id,
        name: orgGroups.name,
        description: orgGroups.description,
        createdAt: orgGroups.createdAt,
        memberCount: sql<number>`count(${orgGroupMemberships.userId})`
      })
      .from(orgGroups)
      .leftJoin(orgGroupMemberships, eq(orgGroups.id, orgGroupMemberships.groupId))
      .groupBy(orgGroups.id);
    
    return results;
  }

  static async addMemberToGroup(groupId: number, userId: number, adminId: number) {
    await db.insert(orgGroupMemberships).values({
      groupId,
      userId
    });

    await this.logAction({
      adminId,
      actionType: "group_member_added",
      resourceType: "group",
      resourceId: groupId.toString(),
      details: { userId }
    });
  }

  static async removeMemberFromGroup(groupId: number, userId: number, adminId: number) {
    await db.delete(orgGroupMemberships).where(
      and(eq(orgGroupMemberships.groupId, groupId), eq(orgGroupMemberships.userId, userId))
    );

    await this.logAction({
      adminId,
      actionType: "group_member_removed",
      resourceType: "group",
      resourceId: groupId.toString(),
      details: { userId }
    });
  }
}

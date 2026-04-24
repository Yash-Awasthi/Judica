/**
 * Notification Service — CRUD and delivery for server-side notifications.
 */

import { db } from "../lib/drizzle.js";
import { notifications } from "../db/schema/notifications.js";
import { eq, and, desc } from "drizzle-orm";
import logger from "../lib/logger.js";

type NotificationType = typeof notifications.$inferInsert.type;

export async function createNotification(input: {
  userId: number;
  type: NonNullable<NotificationType>;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ id: number }> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      actionUrl: input.actionUrl,
      metadata: input.metadata ?? {},
    })
    .returning({ id: notifications.id });

  logger.debug({ userId: input.userId, type: input.type }, "Notification created");
  return { id: row.id };
}

export async function getUserNotifications(
  userId: number,
  options: { includeDismissed?: boolean; limit?: number; offset?: number } = {},
) {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  const conditions = [eq(notifications.userId, userId)];
  if (!options.includeDismissed) {
    conditions.push(eq(notifications.dismissed, false));
  }

  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getUnreadCount(userId: number): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.read, false),
        eq(notifications.dismissed, false),
      ),
    );
  return rows.length;
}

export async function markAsRead(userId: number, notificationId: number): Promise<void> {
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

export async function dismissNotification(userId: number, notificationId: number): Promise<void> {
  await db
    .update(notifications)
    .set({ dismissed: true, read: true })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

export async function dismissAll(userId: number): Promise<void> {
  await db
    .update(notifications)
    .set({ dismissed: true, read: true })
    .where(eq(notifications.userId, userId));
}

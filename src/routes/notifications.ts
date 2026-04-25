/**
 * Notification Routes — REST API for notification management.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  dismissNotification,
  dismissAll,
} from "../services/notification.service.js";

const notificationsPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/notifications — list user notifications
  fastify.get("/", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const query = request.query as { includeDismissed?: string; limit?: string; offset?: string };
    const notifs = await getUserNotifications(request.userId!, {
      includeDismissed: query.includeDismissed === "true",
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
    const unreadCount = await getUnreadCount(request.userId!);
    return { notifications: notifs, unreadCount };
  });

  // GET /api/notifications/count — unread count only
  fastify.get("/count", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const count = await getUnreadCount(request.userId!);
    return { unreadCount: count };
  });

  // POST /api/notifications/:id/read — mark as read
  fastify.post("/:id/read", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const notifId = parseInt(id, 10);
    if (isNaN(notifId)) throw new AppError(400, "Invalid notification ID");
    await markAsRead(request.userId!, notifId);
    return { success: true };
  });

  // POST /api/notifications/:id/dismiss — dismiss single
  fastify.post("/:id/dismiss", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const notifId = parseInt(id, 10);
    if (isNaN(notifId)) throw new AppError(400, "Invalid notification ID");
    await dismissNotification(request.userId!, notifId);
    return { success: true };
  });

  // POST /api/notifications/dismiss-all — dismiss all
  fastify.post("/dismiss-all", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    await dismissAll(request.userId!);
    return { success: true };
  });
};

export default notificationsPlugin;

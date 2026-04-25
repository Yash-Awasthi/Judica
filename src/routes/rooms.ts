/**
 * Rooms — collaborative AI sessions where multiple users can post messages
 * and all participants see AI responses in real-time via WebSocket.
 *
 * Distinct from conversation sharing (read-only).
 * Any room participant can send messages to the AI council.
 *
 * Flow:
 *   Host: POST /api/rooms → gets inviteCode → shares link
 *   Guest: POST /api/rooms/join/:inviteCode → becomes participant
 *   All: POST /api/ask { conversationId: room.conversationId } → AI responds → everyone sees it
 */

import type { FastifyPluginAsync } from "fastify";
import { randomBytes } from "crypto";
import { db } from "../lib/drizzle.js";
import { rooms, roomParticipants } from "../db/schema/rooms.js";
import { conversations } from "../db/schema/conversations.js";
import { eq, and } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { emitToConversation } from "../lib/socket.js";
import logger from "../lib/logger.js";

function generateRoomId(): string {
  return `room_${randomBytes(8).toString("hex")}`;
}

function generateInviteCode(): string {
  return randomBytes(12).toString("base64url");
}

const roomsPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── POST / — Create a room ───────────────────────────────────────────────
  fastify.post("/", {
    preHandler: [fastifyRequireAuth],
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      summary: "Create a collaborative AI room",
      tags: ["rooms"],
      body: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 100 },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "string" },
            inviteCode: { type: "string" },
            conversationId: { type: "string" },
            name: { type: "string" },
            inviteUrl: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.userId!;
    const { name = "Untitled Room" } = request.body as { name?: string };

    // Create a shared conversation for this room
    const conversationId = `conv_room_${randomBytes(8).toString("hex")}`;
    await db.insert(conversations).values({
      id: conversationId,
      userId,
      title: name,
      isPublic: false,
      updatedAt: new Date(),
    });

    const roomId = generateRoomId();
    const inviteCode = generateInviteCode();

    await db.insert(rooms).values({
      id: roomId,
      hostUserId: userId,
      conversationId,
      inviteCode,
      name,
    });

    // Host is automatically a participant
    await db.insert(roomParticipants).values({ roomId, userId });

    logger.info({ roomId, userId, conversationId }, "Room created");

    reply.code(201);
    return {
      id: roomId,
      inviteCode,
      conversationId,
      name,
      inviteUrl: `/api/rooms/join/${inviteCode}`,
    };
  });

  // ─── POST /join/:inviteCode — Join a room ─────────────────────────────────
  fastify.post("/join/:inviteCode", {
    preHandler: [fastifyRequireAuth],
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: {
      summary: "Join a room via invite code",
      tags: ["rooms"],
      params: {
        type: "object",
        required: ["inviteCode"],
        properties: { inviteCode: { type: "string" } },
      },
      response: {
        200: {
          type: "object",
          properties: {
            roomId: { type: "string" },
            conversationId: { type: "string" },
            name: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.userId!;
    const { inviteCode } = request.params as { inviteCode: string };

    const [room] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.inviteCode, inviteCode), eq(rooms.isActive, true)))
      .limit(1);

    if (!room) throw new AppError(404, "Room not found or no longer active", "ROOM_NOT_FOUND");

    // Upsert participant (idempotent join)
    await db
      .insert(roomParticipants)
      .values({ roomId: room.id, userId })
      .onConflictDoNothing();

    // Notify existing room members via WebSocket
    emitToConversation(room.conversationId, "room:user_joined", {
      userId,
      username: (request as any).username,
      roomId: room.id,
      timestamp: Date.now(),
    });

    logger.info({ roomId: room.id, userId }, "User joined room");

    return {
      roomId: room.id,
      conversationId: room.conversationId,
      name: room.name,
    };
  });

  // ─── GET /:id — Get room info + participants ───────────────────────────────
  fastify.get("/:id", {
    preHandler: [fastifyRequireAuth],
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    schema: {
      summary: "Get room details and participants",
      tags: ["rooms"],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
  }, async (request) => {
    const userId = request.userId!;
    const { id } = request.params as { id: string };

    const [room] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
    if (!room) throw new AppError(404, "Room not found", "ROOM_NOT_FOUND");

    // Only participants and host can view room details
    const isParticipant = await db
      .select()
      .from(roomParticipants)
      .where(and(eq(roomParticipants.roomId, id), eq(roomParticipants.userId, userId)))
      .limit(1);

    if (!isParticipant.length && room.hostUserId !== userId) {
      throw new AppError(403, "Not a room participant", "ROOM_ACCESS_DENIED");
    }

    const participants = await db
      .select({ userId: roomParticipants.userId, joinedAt: roomParticipants.joinedAt })
      .from(roomParticipants)
      .where(eq(roomParticipants.roomId, id));

    return {
      id: room.id,
      name: room.name,
      conversationId: room.conversationId,
      hostUserId: room.hostUserId,
      isActive: room.isActive,
      createdAt: room.createdAt,
      participants,
    };
  });

  // ─── DELETE /:id — Close a room (host only) ────────────────────────────────
  fastify.delete("/:id", {
    preHandler: [fastifyRequireAuth],
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      summary: "Close a room (host only)",
      tags: ["rooms"],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
  }, async (request, reply) => {
    const userId = request.userId!;
    const { id } = request.params as { id: string };

    const [room] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
    if (!room) throw new AppError(404, "Room not found", "ROOM_NOT_FOUND");
    if (room.hostUserId !== userId) throw new AppError(403, "Only the host can close a room", "ROOM_FORBIDDEN");

    await db.update(rooms).set({ isActive: false, updatedAt: new Date() }).where(eq(rooms.id, id));

    emitToConversation(room.conversationId, "room:closed", { roomId: id, timestamp: Date.now() });

    logger.info({ roomId: id, userId }, "Room closed by host");
    reply.code(204);
  });
};

export default roomsPlugin;

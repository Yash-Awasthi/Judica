import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import logger from "./logger.js";
import { env } from "../config/env.js";

let io: Server | null = null;

/**
 * Initialize Socket.io server.
 * Attaches to the HTTP server instance.
 */
export function initSocket(server: HttpServer): Server {
  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:5173"];

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Client connected");

    // Join a conversation room
    socket.on("join:conversation", (conversationId: string) => {
      void socket.join(`conversation:${conversationId}`);
      logger.debug({ socketId: socket.id, conversationId }, "Joined conversation room");
    });

    // Leave a conversation room
    socket.on("leave:conversation", (conversationId: string) => {
      void socket.leave(`conversation:${conversationId}`);
      logger.debug({ socketId: socket.id, conversationId }, "Left conversation room");
    });

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "Client disconnected");
    });

    // Handle errors
    socket.on("error", (err) => {
      logger.error({ socketId: socket.id, err: err.message }, "Socket error");
    });
  });

  logger.info("Socket.io initialized");
  return io;
}

/**
 * Get the Socket.io server instance.
 */
export function getSocket(): Server | null {
  return io;
}

/**
 * Emit an event to all clients in a conversation room.
 */
export function emitToConversation(conversationId: string, event: string, data: any): void {
  if (io) {
    io.to(`conversation:${conversationId}`).emit(event, data);
  }
}

/**
 * Emit an event to all connected clients.
 */
export function emitToAll(event: string, data: any): void {
  if (io) {
    io.emit(event, data);
  }
}

/**
 * Get the number of connected clients.
 */
export function getConnectedClients(): number {
  if (!io) return 0;
  return io.engine?.clientsCount ?? 0;
}
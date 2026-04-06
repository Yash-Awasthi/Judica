import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import logger from "./logger.js";
import { env } from "../config/env.js";

let io: Server | null = null;

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

    socket.on("join:conversation", (conversationId: string) => {
      void socket.join(`conversation:${conversationId}`);
      logger.debug({ socketId: socket.id, conversationId }, "Joined conversation room");
    });

    socket.on("leave:conversation", (conversationId: string) => {
      void socket.leave(`conversation:${conversationId}`);
      logger.debug({ socketId: socket.id, conversationId }, "Left conversation room");
    });

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "Client disconnected");
    });

    socket.on("error", (err) => {
      logger.error({ socketId: socket.id, err: err.message }, "Socket error");
    });
  });

  logger.info("Socket.io initialized");
  return io;
}

export function getSocket(): Server | null {
  return io;
}

export function emitToConversation(conversationId: string, event: string, data: any): void {
  if (io) {
    io.to(`conversation:${conversationId}`).emit(event, data);
  }
}

export function emitToAll(event: string, data: any): void {
  if (io) {
    io.emit(event, data);
  }
}

export function getConnectedClients(): number {
  if (!io) return 0;
  return io.engine?.clientsCount ?? 0;
}
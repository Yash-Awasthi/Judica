import { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { z } from "zod";
import logger from "./logger.js";
import { env } from "../config/env.js";
import redis from "./redis.js";
import { findConversationById } from "../services/conversation.service.js";

let wss: WebSocketServer | null = null;
// P8-06: Track per-user connection count to prevent FD exhaustion
const MAX_CONNECTIONS_PER_USER = 10;
const MAX_CONNECTIONS_GLOBAL = 5000;
const userConnectionCount = new Map<number, number>();

const jwtPayloadSchema = z.object({
  userId: z.number(),
  username: z.string(),
  role: z.string().default("member"),
});

interface ClientSocket extends WebSocket {
  isAlive?: boolean;
  rooms?: Set<string>;
  userId?: number;
  username?: string;
}

function extractToken(req: IncomingMessage): string | null {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const tokenFromQuery = url.searchParams.get("token");
  if (tokenFromQuery) return tokenFromQuery;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  // Check cookies
  const cookies = req.headers.cookie;
  if (cookies) {
    const match = cookies.match(/(?:^|;\s*)access_token=([^;]*)/);
    if (match) return match[1];
  }

  return null;
}

export function initSocket(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  // Handle upgrade with JWT verification
  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const token = extractToken(req);
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      const payload = jwtPayloadSchema.parse(decoded);

      // Check if user is suspended
      const userStatus = await redis.get(`user:status:${payload.userId}`);
      if (userStatus === "suspended") {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss!.handleUpgrade(req, socket, head, (ws: ClientSocket) => {
        // P8-06: Enforce per-user and global connection limits
        const currentGlobal = wss!.clients.size;
        if (currentGlobal >= MAX_CONNECTIONS_GLOBAL) {
          ws.close(1013, "Server at capacity");
          return;
        }
        const userCount = userConnectionCount.get(payload.userId) || 0;
        if (userCount >= MAX_CONNECTIONS_PER_USER) {
          ws.close(1013, "Too many connections");
          return;
        }
        userConnectionCount.set(payload.userId, userCount + 1);

        ws.userId = payload.userId;
        ws.username = payload.username;
        wss!.emit("connection", ws, req);
      });
    } catch (err) {
      logger.debug({ err: (err as Error).message }, "WebSocket auth failed");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    }
  });

  // Heartbeat interval
  const interval = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients as Set<ClientSocket>) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on("close", () => clearInterval(interval));

  wss.on("connection", (ws: ClientSocket) => {
    ws.isAlive = true;
    ws.rooms = new Set();

    logger.info({ userId: ws.userId }, "WebSocket client connected");

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "join:conversation" && msg.conversationId) {
          // Verify the user owns this conversation (or it's public)
          const conversation = await findConversationById(msg.conversationId, ws.userId);
          if (!conversation) {
            // Check if it's a public conversation
            const publicConv = await findConversationById(msg.conversationId);
            if (!publicConv || !publicConv.isPublic) {
              ws.send(JSON.stringify({ event: "error", data: { message: "Conversation not found or access denied" } }));
              return;
            }
          }
          ws.rooms!.add(`conversation:${msg.conversationId}`);
          logger.debug({ conversationId: msg.conversationId, userId: ws.userId }, "Joined conversation room");
        } else if (msg.type === "leave:conversation" && msg.conversationId) {
          ws.rooms!.delete(`conversation:${msg.conversationId}`);
          logger.debug({ conversationId: msg.conversationId, userId: ws.userId }, "Left conversation room");
        }
      } catch {
        // Ignore non-JSON messages
      }
    });

    ws.on("close", () => {
      // P8-06: Decrement per-user connection counter
      if (ws.userId) {
        const count = userConnectionCount.get(ws.userId) || 1;
        if (count <= 1) userConnectionCount.delete(ws.userId);
        else userConnectionCount.set(ws.userId, count - 1);
      }
      logger.info({ userId: ws.userId }, "WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err: err.message, userId: ws.userId }, "WebSocket error");
    });
  });

  logger.info("WebSocket server initialized (authenticated)");
  return wss;
}

export function getSocket(): WebSocketServer | null {
  return wss;
}

export function emitToConversation(conversationId: string, event: string, data: unknown): void {
  if (!wss) return;
  const room = `conversation:${conversationId}`;
  const payload = JSON.stringify({ event, data });
  for (const client of wss.clients as Set<ClientSocket>) {
    if (client.readyState === WebSocket.OPEN && client.rooms?.has(room)) {
      client.send(payload);
    }
  }
}

export function emitToAll(event: string, data: unknown): void {
  if (!wss) return;
  const payload = JSON.stringify({ event, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function getConnectedClients(): number {
  return wss?.clients.size ?? 0;
}

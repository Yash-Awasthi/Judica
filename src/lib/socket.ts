import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import logger from "./logger.js";
import { env } from "../config/env.js";

let wss: WebSocketServer | null = null;

interface ClientSocket extends WebSocket {
  isAlive?: boolean;
  rooms?: Set<string>;
}

export function initSocket(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws" });

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

    logger.info("WebSocket client connected");

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "join:conversation" && msg.conversationId) {
          ws.rooms!.add(`conversation:${msg.conversationId}`);
          logger.debug({ conversationId: msg.conversationId }, "Joined conversation room");
        } else if (msg.type === "leave:conversation" && msg.conversationId) {
          ws.rooms!.delete(`conversation:${msg.conversationId}`);
          logger.debug({ conversationId: msg.conversationId }, "Left conversation room");
        }
      } catch {
        // Ignore non-JSON messages
      }
    });

    ws.on("close", () => {
      logger.info("WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err: err.message }, "WebSocket error");
    });
  });

  logger.info("WebSocket server initialized");
  return wss;
}

export function getSocket(): WebSocketServer | null {
  return wss;
}

export function emitToConversation(conversationId: string, event: string, data: any): void {
  if (!wss) return;
  const room = `conversation:${conversationId}`;
  const payload = JSON.stringify({ event, data });
  for (const client of wss.clients as Set<ClientSocket>) {
    if (client.readyState === WebSocket.OPEN && client.rooms?.has(room)) {
      client.send(payload);
    }
  }
}

export function emitToAll(event: string, data: any): void {
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

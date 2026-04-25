import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Server as HttpServer } from "http";

vi.mock("ws", () => {
  const mockClients = new Set();

  const WebSocketMock = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    send: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    readyState: 1,
    rooms: new Set(),
    isAlive: true,
  }));
  (WebSocketMock as any).OPEN = 1;

  const WebSocketServerMock = vi.fn().mockImplementation(function (this: any) {
    this.on = vi.fn();
    this.emit = vi.fn();
    this.handleUpgrade = vi.fn();
    this.clients = mockClients;
  });

  return {
    WebSocketServer: WebSocketServerMock,
    WebSocket: WebSocketMock,
  };
});

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    JWT_SECRET: "test-secret-key-min-16",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    REDIS_URL: "redis://localhost:6379",
  },
}));

vi.mock("jsonwebtoken", () => ({
  default: {
    verify: vi.fn(),
  },
}));

vi.mock("../../src/lib/redis.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../../src/services/conversation.service.js", () => ({
  findConversationById: vi.fn().mockResolvedValue({ id: "conv-1", userId: 1, isPublic: false }),
}));

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {},
}));

vi.mock("../../src/lib/db.js", () => ({
  pool: { query: vi.fn(), on: vi.fn(), totalCount: 0, idleCount: 0 },
}));

describe("Socket (extended)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes WebSocket server with noServer mode", async () => {
    const { initSocket } = await import("../../src/lib/socket.js");
    const { WebSocketServer } = await import("ws");
    const server = new HttpServer();

    const wss = initSocket(server);

    expect(WebSocketServer).toHaveBeenCalledWith(
      expect.objectContaining({ noServer: true })
    );
    expect(wss).toBeDefined();
  });

  it("handles client connections and sets isAlive", async () => {
    const { initSocket } = await import("../../src/lib/socket.js");
    const server = new HttpServer();
    const wss = initSocket(server);

    // Find the connection handler
    const connectionCall = (wss.on as any).mock.calls.find(
      (c: any[]) => c[0] === "connection"
    );
    expect(connectionCall).toBeDefined();

    if (connectionCall) {
      const mockWs = {
        isAlive: false,
        rooms: undefined as any,
        userId: undefined as any,
        username: undefined as any,
        on: vi.fn(),
        send: vi.fn(),
        ping: vi.fn(),
        terminate: vi.fn(),
      };

      connectionCall[1](mockWs);

      expect(mockWs.isAlive).toBe(true);
      expect(mockWs.rooms).toBeInstanceOf(Set);
      // Should register pong, message, close, error handlers
      const events = mockWs.on.mock.calls.map((c: any[]) => c[0]);
      expect(events).toContain("pong");
      expect(events).toContain("message");
      expect(events).toContain("close");
      expect(events).toContain("error");
    }
  });

  it("handles heartbeat/ping-pong: terminates dead clients", async () => {
    const { initSocket } = await import("../../src/lib/socket.js");
    const server = new HttpServer();
    const wss = initSocket(server);

    const deadClient = {
      isAlive: false,
      rooms: new Set(),
      on: vi.fn(),
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      readyState: 1,
    };
    const aliveClient = {
      isAlive: true,
      rooms: new Set(),
      on: vi.fn(),
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      readyState: 1,
    };

    wss.clients.add(deadClient);
    wss.clients.add(aliveClient);

    // Trigger heartbeat interval (30s)
    vi.advanceTimersByTime(31000);

    expect(deadClient.terminate).toHaveBeenCalled();
    expect(aliveClient.ping).toHaveBeenCalled();
    expect(aliveClient.isAlive).toBe(false);

    wss.clients.clear();
  });

  it("broadcasts to specific conversation room only", async () => {
    const { emitToConversation, initSocket } = await import("../../src/lib/socket.js");
    const server = new HttpServer();
    const wss = initSocket(server);

    const inRoom = {
      readyState: 1,
      rooms: new Set(["conversation:abc"]),
      send: vi.fn(),
    };
    const outRoom = {
      readyState: 1,
      rooms: new Set(["conversation:xyz"]),
      send: vi.fn(),
    };
    const noRooms = {
      readyState: 1,
      rooms: new Set(),
      send: vi.fn(),
    };

    wss.clients.add(inRoom);
    wss.clients.add(outRoom);
    wss.clients.add(noRooms);

    emitToConversation("abc", "update", { text: "hello" });

    expect(inRoom.send).toHaveBeenCalledWith(
      JSON.stringify({ event: "update", data: { text: "hello" } })
    );
    expect(outRoom.send).not.toHaveBeenCalled();
    expect(noRooms.send).not.toHaveBeenCalled();

    wss.clients.clear();
  });

  it("handles disconnection gracefully", async () => {
    const { initSocket } = await import("../../src/lib/socket.js");
    const logger = (await import("../../src/lib/logger.js")).default;
    const server = new HttpServer();
    const wss = initSocket(server);

    const connectionCall = (wss.on as any).mock.calls.find(
      (c: any[]) => c[0] === "connection"
    );

    if (connectionCall) {
      const mockWs = {
        isAlive: false,
        rooms: undefined as any,
        userId: 42,
        username: "testuser",
        on: vi.fn(),
        send: vi.fn(),
        ping: vi.fn(),
        terminate: vi.fn(),
      };

      connectionCall[1](mockWs);

      // Find the close handler
      const closeCall = mockWs.on.mock.calls.find((c: any[]) => c[0] === "close");
      expect(closeCall).toBeDefined();

      if (closeCall) {
        closeCall[1](); // trigger disconnect
        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({ userId: 42 }),
          "WebSocket client disconnected"
        );
      }
    }
  });

  it("emitToAll sends to all open clients", async () => {
    const { emitToAll, initSocket } = await import("../../src/lib/socket.js");
    const server = new HttpServer();
    const wss = initSocket(server);

    const client1 = { readyState: 1, send: vi.fn() };
    const client2 = { readyState: 1, send: vi.fn() };
    const closedClient = { readyState: 3, send: vi.fn() }; // CLOSED

    wss.clients.add(client1);
    wss.clients.add(client2);
    wss.clients.add(closedClient);

    emitToAll("broadcast", { msg: "hi" });

    expect(client1.send).toHaveBeenCalled();
    expect(client2.send).toHaveBeenCalled();
    expect(closedClient.send).not.toHaveBeenCalled();

    wss.clients.clear();
  });

  it("getConnectedClients returns correct count", async () => {
    const { getConnectedClients, initSocket } = await import("../../src/lib/socket.js");
    const server = new HttpServer();
    const wss = initSocket(server);

    expect(getConnectedClients()).toBe(0);

    wss.clients.add({});
    wss.clients.add({});
    wss.clients.add({});
    expect(getConnectedClients()).toBe(3);

    wss.clients.clear();
  });
});

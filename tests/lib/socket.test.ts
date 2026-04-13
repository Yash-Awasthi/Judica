import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

vi.mock("ws", () => {
  const mockClients = new Set();
  
  const WebSocketMock = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    send: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    readyState: 1, // OPEN
    rooms: new Set()
  }));
  (WebSocketMock as any).OPEN = 1;

  const WebSocketServerMock = vi.fn().mockImplementation(function(this: any) {
    this.on = vi.fn((event, cb) => {
      if (event === "connection") {
          // we can trigger this manually
      }
    });
    this.clients = mockClients;
  });

  return {
    WebSocketServer: WebSocketServerMock,
    WebSocket: WebSocketMock
  };
});

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Socket", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("should initialize websocket server and setup intervals", async () => {
        const { initSocket, getSocket } = await import("../../src/lib/socket.js");
        const server = new HttpServer();
        const wss = initSocket(server);
        expect(wss).toBeDefined();
        expect(getSocket()).toBe(wss);
        
        // Let's trigger interval
        vi.advanceTimersByTime(35000);
    });

    it("should emit to all clients", async () => {
        const { emitToAll, initSocket } = await import("../../src/lib/socket.js");
        const server = new HttpServer();
        const wss = initSocket(server);
        
        const mockClient = {
            readyState: 1, // OPEN
            send: vi.fn()
        };
        wss.clients.add(mockClient);

        emitToAll("test-event", { hello: "world" });
        expect(mockClient.send).toHaveBeenCalledWith(JSON.stringify({ event: "test-event", data: { hello: "world" } }));

        wss.clients.clear();
    });

    it("should emit to specific conversation", async () => {
        const { emitToConversation, initSocket } = await import("../../src/lib/socket.js");
        const server = new HttpServer();
        const wss = initSocket(server);
        
        const mockClientInRoom = {
            readyState: 1,
            rooms: new Set(["conversation:123"]),
            send: vi.fn()
        };
        const mockClientOutRoom = {
            readyState: 1,
            rooms: new Set(["conversation:456"]),
            send: vi.fn()
        };
        wss.clients.add(mockClientInRoom);
        wss.clients.add(mockClientOutRoom);

        emitToConversation("123", "test-event", { msg: "hi" });
        
        expect(mockClientInRoom.send).toHaveBeenCalled();
        expect(mockClientOutRoom.send).not.toHaveBeenCalled();

        wss.clients.clear();
    });

    it("should return connected clients count", async () => {
        const { getConnectedClients, initSocket } = await import("../../src/lib/socket.js");
        expect(getConnectedClients()).toBe(0);
        
        const server = new HttpServer();
        const wss = initSocket(server);
        wss.clients.add({});
        wss.clients.add({});
        expect(getConnectedClients()).toBe(2);
        wss.clients.clear();
    });
});

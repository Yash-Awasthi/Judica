import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code?: string;
    constructor(statusCode: number, message: string, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

// Chainable DB mock builder
function makeChainableQuery(finalResult: any) {
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(finalResult)),
    select: vi.fn(() => chain),
    values: vi.fn(() => Promise.resolve()),
    set: vi.fn(() => chain),
    onConflictDoNothing: vi.fn(() => Promise.resolve()),
  };
  return chain;
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("../../src/lib/drizzle.js", () => ({ db: mockDb }));

vi.mock("../../src/lib/socket.js", () => ({
  emitToConversation: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../src/db/schema/rooms.js", () => ({
  rooms: { id: "rooms.id", hostUserId: "rooms.hostUserId", inviteCode: "rooms.inviteCode", isActive: "rooms.isActive", conversationId: "rooms.conversationId" },
  roomParticipants: { roomId: "rp.roomId", userId: "rp.userId", joinedAt: "rp.joinedAt" },
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
}));

const registeredRoutes: Record<string, { handler: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      registeredRoutes[`${method.toUpperCase()} ${path}`] = {
        handler: handler ?? opts,
      };
    });
  return {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    delete: register("DELETE"),
    patch: register("PATCH"),
    addHook: vi.fn(),
    addContentTypeParser: vi.fn(),
    register: vi.fn(),
  };
}

function makeReq(overrides = {}): any {
  return {
    userId: 1,
    role: "member",
    body: {},
    params: {},
    query: {},
    headers: {},
    log: { error: vi.fn(), info: vi.fn() },
    ...overrides,
  };
}

function makeReply(): any {
  const r: any = {};
  r.code = vi.fn(() => r);
  r.send = vi.fn(() => r);
  r.header = vi.fn(() => r);
  r.status = vi.fn(() => r);
  return r;
}

let fastify: any;

beforeEach(async () => {
  vi.clearAllMocks();
  Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);

  // Default mock setup for db operations
  mockDb.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });

  fastify = createFastifyInstance();
  const { default: roomsPlugin } = await import("../../src/routes/rooms.js");
  await roomsPlugin(fastify, {});
});

describe("POST / — create room", () => {
  it("registers the POST / route", () => {
    expect(registeredRoutes["POST /"]).toBeDefined();
  });

  it("creates a room and returns 201 with room details", async () => {
    const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
    mockDb.insert.mockReturnValue(insertChain);

    const handler = registeredRoutes["POST /"]?.handler;
    const req = makeReq({ userId: 10, body: { name: "Team Session" } });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(result).toMatchObject({
      id: expect.stringMatching(/^room_/),
      inviteCode: expect.any(String),
      conversationId: expect.stringMatching(/^conv_room_/),
      name: "Team Session",
      inviteUrl: expect.stringContaining("/api/rooms/join/"),
    });
  });

  it("uses default room name when name is not provided", async () => {
    const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
    mockDb.insert.mockReturnValue(insertChain);

    const handler = registeredRoutes["POST /"]?.handler;
    const req = makeReq({ userId: 10, body: {} });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(result.name).toBe("Untitled Room");
  });

  it("inserts conversation, room, and participant records", async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values: insertValues });

    const handler = registeredRoutes["POST /"]?.handler;
    const req = makeReq({ userId: 5, body: { name: "My Room" } });
    await handler(req, makeReply());

    // Three inserts: conversation, room, participant
    expect(mockDb.insert).toHaveBeenCalledTimes(3);
  });

  it("generates unique roomId and inviteCode for each room", async () => {
    const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
    mockDb.insert.mockReturnValue(insertChain);

    const handler = registeredRoutes["POST /"]?.handler;
    const req1 = makeReq({ userId: 1, body: {} });
    const req2 = makeReq({ userId: 2, body: {} });

    const result1 = await handler(req1, makeReply());
    const result2 = await handler(req2, makeReply());

    expect(result1.id).not.toBe(result2.id);
    expect(result1.inviteCode).not.toBe(result2.inviteCode);
  });
});

describe("POST /join/:inviteCode — join room", () => {
  it("registers the POST /join/:inviteCode route", () => {
    expect(registeredRoutes["POST /join/:inviteCode"]).toBeDefined();
  });

  it("joins an active room with valid invite code", async () => {
    const mockRoom = {
      id: "room_abc123",
      conversationId: "conv_xyz",
      name: "Team Session",
      isActive: true,
      inviteCode: "valid-code",
    };

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockRoom]),
        }),
      }),
    });

    const insertChain = {
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    };
    mockDb.insert.mockReturnValue(insertChain);

    const handler = registeredRoutes["POST /join/:inviteCode"]?.handler;
    const req = makeReq({ userId: 7, params: { inviteCode: "valid-code" } });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(result).toMatchObject({
      roomId: "room_abc123",
      conversationId: "conv_xyz",
      name: "Team Session",
    });
  });

  it("throws 404 when invite code is invalid", async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const handler = registeredRoutes["POST /join/:inviteCode"]?.handler;
    const req = makeReq({ userId: 7, params: { inviteCode: "bad-code" } });

    await expect(handler(req, makeReply())).rejects.toThrow("Room not found");
  });
});

describe("GET /:id — get room details", () => {
  it("registers the GET /:id route", () => {
    expect(registeredRoutes["GET /:id"]).toBeDefined();
  });

  it("returns room details for a participant", async () => {
    const mockRoom = {
      id: "room_abc",
      name: "Dev Session",
      conversationId: "conv_abc",
      hostUserId: 1,
      isActive: true,
      createdAt: new Date(),
    };
    const mockParticipants = [{ userId: 1, joinedAt: new Date() }];

    let callCount = 0;
    mockDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve([mockRoom]);
            return Promise.resolve(mockParticipants);
          }),
        }),
      }),
    }));

    const handler = registeredRoutes["GET /:id"]?.handler;
    const req = makeReq({ userId: 1, params: { id: "room_abc" } });
    const result = await handler(req, makeReply());

    expect(result).toMatchObject({
      id: "room_abc",
      name: "Dev Session",
      hostUserId: 1,
    });
  });

  it("throws 404 when room does not exist", async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const handler = registeredRoutes["GET /:id"]?.handler;
    const req = makeReq({ userId: 1, params: { id: "nonexistent" } });

    await expect(handler(req, makeReply())).rejects.toThrow("Room not found");
  });

  it("throws 403 when user is not a participant or host", async () => {
    const mockRoom = {
      id: "room_abc",
      name: "Private Room",
      conversationId: "conv_abc",
      hostUserId: 99, // different user
      isActive: true,
      createdAt: new Date(),
    };

    let callCount = 0;
    mockDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve([mockRoom]);
            return Promise.resolve([]); // not a participant
          }),
        }),
      }),
    }));

    const handler = registeredRoutes["GET /:id"]?.handler;
    const req = makeReq({ userId: 1, params: { id: "room_abc" } });

    await expect(handler(req, makeReply())).rejects.toThrow("Not a room participant");
  });

  it("allows host to view room even if not in participants table", async () => {
    const mockRoom = {
      id: "room_abc",
      name: "Host's Room",
      conversationId: "conv_abc",
      hostUserId: 1, // same as req.userId
      isActive: true,
      createdAt: new Date(),
    };
    const mockParticipants = [{ userId: 1, joinedAt: new Date() }];

    let callCount = 0;
    mockDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve([mockRoom]);
            if (callCount === 2) return Promise.resolve([]); // not in participants table
            return Promise.resolve(mockParticipants);
          }),
        }),
      }),
    }));

    const handler = registeredRoutes["GET /:id"]?.handler;
    const req = makeReq({ userId: 1, params: { id: "room_abc" } });
    const result = await handler(req, makeReply());

    expect(result).toMatchObject({ id: "room_abc", hostUserId: 1 });
  });
});

describe("DELETE /:id — close room", () => {
  it("registers the DELETE /:id route", () => {
    expect(registeredRoutes["DELETE /:id"]).toBeDefined();
  });

  it("allows host to close their room with 204", async () => {
    const mockRoom = {
      id: "room_abc",
      name: "My Room",
      conversationId: "conv_abc",
      hostUserId: 1,
      isActive: true,
    };

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockRoom]),
        }),
      }),
    });
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const handler = registeredRoutes["DELETE /:id"]?.handler;
    const req = makeReq({ userId: 1, params: { id: "room_abc" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(204);
  });

  it("throws 403 when non-host tries to close room", async () => {
    const mockRoom = {
      id: "room_abc",
      hostUserId: 99,
      conversationId: "conv_abc",
      isActive: true,
    };

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockRoom]),
        }),
      }),
    });

    const handler = registeredRoutes["DELETE /:id"]?.handler;
    const req = makeReq({ userId: 1, params: { id: "room_abc" } }); // userId 1, but host is 99

    await expect(handler(req, makeReply())).rejects.toThrow("Only the host can close a room");
  });

  it("throws 404 when room does not exist", async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const handler = registeredRoutes["DELETE /:id"]?.handler;
    const req = makeReq({ userId: 1, params: { id: "nonexistent" } });

    await expect(handler(req, makeReply())).rejects.toThrow("Room not found");
  });

  it("sets isActive=false when room is closed", async () => {
    const mockRoom = {
      id: "room_xyz",
      hostUserId: 5,
      conversationId: "conv_xyz",
      isActive: true,
    };

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockRoom]),
        }),
      }),
    });

    const mockSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDb.update.mockReturnValue({ set: mockSet });

    const handler = registeredRoutes["DELETE /:id"]?.handler;
    const req = makeReq({ userId: 5, params: { id: "room_xyz" } });
    await handler(req, makeReply());

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false })
    );
  });
});

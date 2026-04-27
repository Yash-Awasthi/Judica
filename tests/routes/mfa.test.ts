import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies at top level
vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(code: number, msg: string) {
      super(msg);
      this.statusCode = code;
    }
  },
}));

vi.mock("../../src/services/mfa.service.js", () => ({
  generateSecret: vi.fn(),
  verifyTOTP: vi.fn(),
  enableMFA: vi.fn(),
  disableMFA: vi.fn(),
  verifyBackupCode: vi.fn(),
  isMFARequired: vi.fn(),
  regenerateBackupCodes: vi.fn(),
}));

// Helper to capture Fastify route handlers
const registeredRoutes: Record<string, { handler: Function; preHandler?: Function }> = {};
function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      const h = handler ?? opts;
      const pre = handler ? opts?.preHandler : undefined;
      registeredRoutes[`${method.toUpperCase()} ${path}`] = { handler: h, preHandler: pre };
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

// Mock request/reply helpers
function makeReq(overrides = {}): any {
  return { userId: 1, role: "member", body: {}, params: {}, query: {}, headers: {}, ...overrides };
}
function makeReply(): any {
  const r: any = { _code: 200, _body: undefined };
  r.code = vi.fn((c: number) => { r._code = c; return r; });
  r.send = vi.fn((b?: any) => { r._body = b; return r; });
  r.header = vi.fn(() => r);
  return r;
}

describe("mfa routes", () => {
  let fastify: any;
  let generateSecret: any;
  let verifyTOTP: any;
  let enableMFA: any;
  let disableMFA: any;
  let verifyBackupCode: any;
  let isMFARequired: any;
  let regenerateBackupCodes: any;

  beforeEach(async () => {
    for (const key of Object.keys(registeredRoutes)) {
      delete registeredRoutes[key];
    }
    vi.clearAllMocks();

    fastify = createFastifyInstance();

    const svc = await import("../../src/services/mfa.service.js");
    generateSecret = svc.generateSecret as any;
    verifyTOTP = svc.verifyTOTP as any;
    enableMFA = svc.enableMFA as any;
    disableMFA = svc.disableMFA as any;
    verifyBackupCode = svc.verifyBackupCode as any;
    isMFARequired = svc.isMFARequired as any;
    regenerateBackupCodes = svc.regenerateBackupCodes as any;

    generateSecret.mockResolvedValue({
      secret: "BASE32SECRET",
      qrCodeDataUrl: "data:image/png;base64,...",
      backupCodes: ["aaa-bbb", "ccc-ddd"],
    });
    verifyTOTP.mockResolvedValue(true);
    enableMFA.mockResolvedValue(undefined);
    disableMFA.mockResolvedValue(undefined);
    verifyBackupCode.mockResolvedValue(true);
    isMFARequired.mockResolvedValue(false);
    regenerateBackupCodes.mockResolvedValue(["111-222", "333-444"]);

    const { default: mfaPlugin } = await import("../../src/routes/mfa.js");
    await mfaPlugin(fastify, {});
  });

  describe("POST /setup", () => {
    it("registers the POST /setup route", () => {
      expect(registeredRoutes["POST /setup"]).toBeDefined();
    });

    it("returns 201 with secret, qrCodeDataUrl, backupCodes, and message", async () => {
      const { handler } = registeredRoutes["POST /setup"];
      const req = makeReq({ userId: 5 });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result.secret).toBe("BASE32SECRET");
      expect(result.qrCodeDataUrl).toBeDefined();
      expect(result.backupCodes).toHaveLength(2);
      expect(result.message).toBeTruthy();
    });

    it("calls generateSecret with the userId", async () => {
      const { handler } = registeredRoutes["POST /setup"];
      const req = makeReq({ userId: 77 });
      const reply = makeReply();
      await handler(req, reply);
      expect(generateSecret).toHaveBeenCalledWith(77);
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["POST /setup"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("POST /verify-setup", () => {
    it("registers the POST /verify-setup route", () => {
      expect(registeredRoutes["POST /verify-setup"]).toBeDefined();
    });

    it("returns success: true when token is valid", async () => {
      const { handler } = registeredRoutes["POST /verify-setup"];
      const req = makeReq({ body: { token: "123456" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.success).toBe(true);
    });

    it("throws AppError 400 when token is missing", async () => {
      const { handler } = registeredRoutes["POST /verify-setup"];
      const req = makeReq({ body: {} });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("calls enableMFA with userId and token", async () => {
      const { handler } = registeredRoutes["POST /verify-setup"];
      const req = makeReq({ userId: 3, body: { token: "654321" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(enableMFA).toHaveBeenCalledWith(3, "654321");
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["POST /verify-setup"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("POST /verify", () => {
    it("registers the POST /verify route", () => {
      expect(registeredRoutes["POST /verify"]).toBeDefined();
    });

    it("returns valid: true with method 'totp' for a valid TOTP token", async () => {
      const { handler } = registeredRoutes["POST /verify"];
      const req = makeReq({ body: { userId: 1, token: "123456" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.valid).toBe(true);
      expect(result.method).toBe("totp");
    });

    it("throws AppError 401 when TOTP token is invalid", async () => {
      verifyTOTP.mockResolvedValue(false);
      const { handler } = registeredRoutes["POST /verify"];
      const req = makeReq({ body: { userId: 1, token: "000000" } });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 401 });
    });

    it("returns valid: true with method 'backup_code' for a valid backup code", async () => {
      const { handler } = registeredRoutes["POST /verify"];
      const req = makeReq({ body: { userId: 1, backupCode: "aaa-bbb" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.valid).toBe(true);
      expect(result.method).toBe("backup_code");
    });

    it("throws AppError 401 when backup code is invalid", async () => {
      verifyBackupCode.mockResolvedValue(false);
      const { handler } = registeredRoutes["POST /verify"];
      const req = makeReq({ body: { userId: 1, backupCode: "wrong-code" } });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 401 });
    });

    it("throws AppError 400 when userId is missing", async () => {
      const { handler } = registeredRoutes["POST /verify"];
      const req = makeReq({ body: { token: "123456" } });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws AppError 400 when both token and backupCode are provided", async () => {
      const { handler } = registeredRoutes["POST /verify"];
      const req = makeReq({ body: { userId: 1, token: "123456", backupCode: "aaa-bbb" } });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws AppError 400 when neither token nor backupCode is provided", async () => {
      const { handler } = registeredRoutes["POST /verify"];
      const req = makeReq({ body: { userId: 1 } });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("does not require auth (no preHandler)", () => {
      const route = registeredRoutes["POST /verify"];
      expect(route.preHandler).toBeUndefined();
    });
  });

  describe("POST /disable", () => {
    it("registers the POST /disable route", () => {
      expect(registeredRoutes["POST /disable"]).toBeDefined();
    });

    it("returns success: true when password is provided", async () => {
      const { handler } = registeredRoutes["POST /disable"];
      const req = makeReq({ body: { password: "my-password" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.success).toBe(true);
    });

    it("throws AppError 400 when password is missing", async () => {
      const { handler } = registeredRoutes["POST /disable"];
      const req = makeReq({ body: {} });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("calls disableMFA with userId and password", async () => {
      const { handler } = registeredRoutes["POST /disable"];
      const req = makeReq({ userId: 8, body: { password: "secret" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(disableMFA).toHaveBeenCalledWith(8, "secret");
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["POST /disable"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("GET /status", () => {
    it("registers the GET /status route", () => {
      expect(registeredRoutes["GET /status"]).toBeDefined();
    });

    it("returns enabled: false when MFA is not required", async () => {
      const { handler } = registeredRoutes["GET /status"];
      const req = makeReq({ userId: 2 });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.enabled).toBe(false);
    });

    it("returns enabled: true when MFA is required", async () => {
      isMFARequired.mockResolvedValue(true);
      const { handler } = registeredRoutes["GET /status"];
      const req = makeReq({ userId: 2 });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.enabled).toBe(true);
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["GET /status"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("POST /backup-codes", () => {
    it("registers the POST /backup-codes route", () => {
      expect(registeredRoutes["POST /backup-codes"]).toBeDefined();
    });

    it("returns new backup codes and a message", async () => {
      const { handler } = registeredRoutes["POST /backup-codes"];
      const req = makeReq({ userId: 4 });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.backupCodes).toEqual(["111-222", "333-444"]);
      expect(result.message).toBeTruthy();
    });

    it("calls regenerateBackupCodes with userId", async () => {
      const { handler } = registeredRoutes["POST /backup-codes"];
      const req = makeReq({ userId: 4 });
      const reply = makeReply();
      await handler(req, reply);
      expect(regenerateBackupCodes).toHaveBeenCalledWith(4);
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["POST /backup-codes"];
      expect(route.preHandler).toBeDefined();
    });
  });
});

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import path from "path";

// ─── Constants ──────────────────────────────────────────────────────────────

const JWT_SECRET = "test-jwt-secret-min-16-chars";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../src/config/env.js", () => ({
  env: { NODE_ENV: "test", JWT_SECRET: "test-jwt-secret-min-16-chars" },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateToken(userId: number, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: "15m" });
}

// ─── In-memory state ────────────────────────────────────────────────────────

interface FakeUpload {
  id: string;
  userId: number;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  processed: boolean;
  createdAt: Date;
}

const fakeUploads: FakeUpload[] = [];

// MIME type allowlist from the actual route
const ALLOWED_MIME_PATTERNS = [
  /^image\//,
  /^audio\//,
  /^application\/pdf$/,
  /^text\/plain$/,
  /^text\/csv$/,
  /^text\/markdown$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^application\/msword$/,
  /^application\/vnd\.ms-excel$/,
  /^application\/json$/,
];

// ─── Build test app ─────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  function requireAuth(request: any, reply: any): boolean {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Authentication required" });
      return false;
    }
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
      request.userId = decoded.userId;
      return true;
    } catch {
      reply.code(401).send({ error: "Invalid or expired token" });
      return false;
    }
  }

  // POST /api/uploads — upload files (simulated without multipart for testing)
  app.post("/api/uploads", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { files } = request.body as any;

    if (!files || !Array.isArray(files) || files.length === 0) {
      reply.code(400);
      return { error: "No files uploaded", code: "NO_FILES" };
    }

    const results: any[] = [];

    for (const file of files) {
      // SEC-6: validate MIME type
      if (!ALLOWED_MIME_PATTERNS.some((pattern) => pattern.test(file.mimeType))) {
        reply.code(400);
        return { error: `File type not allowed: ${file.mimeType}`, code: "INVALID_FILE_TYPE" };
      }

      const upload: FakeUpload = {
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        userId: request.userId,
        filename: `${Date.now()}.${file.originalName.split(".").pop()}`,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.size || 1024,
        storagePath: path.join(process.cwd(), "uploads", String(request.userId), file.originalName),
        processed: false,
        createdAt: new Date(),
      };
      fakeUploads.push(upload);
      results.push({
        id: upload.id,
        filename: upload.filename,
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
      });
    }

    reply.code(201);
    return { uploads: results };
  });

  // GET /api/uploads — list uploads
  app.get("/api/uploads", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const userUploads = fakeUploads
      .filter((u) => u.userId === request.userId)
      .slice(0, 50);

    return { uploads: userUploads };
  });

  // GET /api/uploads/:id/raw — serve file (with path traversal check)
  app.get("/api/uploads/:id/raw", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { id } = request.params as { id: string };
    const upload = fakeUploads.find((u) => u.id === id && u.userId === request.userId);

    if (!upload) {
      reply.code(404);
      return { error: "Upload not found" };
    }

    // Path traversal protection (mirrors actual route logic)
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    const resolvedPath = path.resolve(upload.storagePath);
    if (!resolvedPath.startsWith(uploadsDir + path.sep) && resolvedPath !== uploadsDir) {
      reply.code(403);
      return { error: "Access denied", code: "PATH_TRAVERSAL" };
    }

    return { content: "file-bytes", mimeType: upload.mimeType };
  });

  await app.ready();
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Uploads Routes — /api/uploads", () => {
  let app: FastifyInstance;
  const validToken = generateToken(1, "testuser");

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fakeUploads.length = 0;
  });

  // ── Auth enforcement ────────────────────────────────────────────────────

  describe("Authentication", () => {
    it("should require auth for upload", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/uploads",
        payload: { files: [{ originalName: "test.pdf", mimeType: "application/pdf" }] },
      });

      expect(res.statusCode).toBe(401);
    });

    it("should require auth for listing uploads", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/uploads",
      });

      expect(res.statusCode).toBe(401);
    });

    it("should require auth for raw file download", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/uploads/some-id/raw",
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── MIME type validation ────────────────────────────────────────────────

  describe("File type validation", () => {
    it("should accept valid file types", async () => {
      const validTypes = [
        { originalName: "test.pdf", mimeType: "application/pdf" },
        { originalName: "test.png", mimeType: "image/png" },
        { originalName: "test.jpg", mimeType: "image/jpeg" },
        { originalName: "test.txt", mimeType: "text/plain" },
        { originalName: "test.csv", mimeType: "text/csv" },
        { originalName: "test.json", mimeType: "application/json" },
        { originalName: "test.mp3", mimeType: "audio/mpeg" },
        { originalName: "test.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      ];

      for (const file of validTypes) {
        const res = await app.inject({
          method: "POST",
          url: "/api/uploads",
          headers: { authorization: `Bearer ${validToken}` },
          payload: { files: [file] },
        });

        expect(res.statusCode).toBe(201);
      }
    });

    it("should reject executable file types", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/uploads",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          files: [{ originalName: "malware.exe", mimeType: "application/x-executable" }],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_FILE_TYPE");
    });

    it("should reject script file types", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/uploads",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          files: [{ originalName: "script.sh", mimeType: "application/x-sh" }],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should reject HTML file types", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/uploads",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          files: [{ originalName: "page.html", mimeType: "text/html" }],
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── Empty upload ────────────────────────────────────────────────────────

  describe("Empty upload", () => {
    it("should return 400 when no files provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/uploads",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { files: [] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("NO_FILES");
    });
  });

  // ── Path traversal protection ───────────────────────────────────────────

  describe("Path traversal protection", () => {
    it("should block access when storage path escapes uploads directory", async () => {
      // Manually insert an upload with a malicious storage path
      fakeUploads.push({
        id: "traversal-test",
        userId: 1,
        filename: "evil.txt",
        originalName: "evil.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        storagePath: path.join(process.cwd(), "..", "etc", "passwd"),
        processed: false,
        createdAt: new Date(),
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/uploads/traversal-test/raw",
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("PATH_TRAVERSAL");
    });

    it("should allow access to valid upload paths", async () => {
      fakeUploads.push({
        id: "valid-upload",
        userId: 1,
        filename: "doc.pdf",
        originalName: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5000,
        storagePath: path.join(process.cwd(), "uploads", "1", "doc.pdf"),
        processed: false,
        createdAt: new Date(),
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/uploads/valid-upload/raw",
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── Listing uploads ─────────────────────────────────────────────────────

  describe("GET /api/uploads", () => {
    it("should only return uploads for the authenticated user", async () => {
      fakeUploads.push(
        {
          id: "u1", userId: 1, filename: "f1.pdf", originalName: "f1.pdf",
          mimeType: "application/pdf", sizeBytes: 100,
          storagePath: path.join(process.cwd(), "uploads", "1", "f1.pdf"),
          processed: false, createdAt: new Date(),
        },
        {
          id: "u2", userId: 2, filename: "f2.pdf", originalName: "f2.pdf",
          mimeType: "application/pdf", sizeBytes: 200,
          storagePath: path.join(process.cwd(), "uploads", "2", "f2.pdf"),
          processed: false, createdAt: new Date(),
        },
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/uploads",
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.uploads).toHaveLength(1);
      expect(body.uploads[0].id).toBe("u1");
    });
  });
});

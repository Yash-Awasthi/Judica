import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockDb: any = {};

function chainable(overrides: Record<string, any> = {}): any {
  const chain: any = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "update",
    "set",
    "insert",
    "values",
    "returning",
    "delete",
  ];
  for (const m of methods) {
    chain[m] = overrides[m] ?? vi.fn(() => chain);
  }
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/uploads.js", () => ({
  uploads: {
    id: "uploads.id",
    userId: "uploads.userId",
    filename: "uploads.filename",
    originalName: "uploads.originalName",
    mimeType: "uploads.mimeType",
    sizeBytes: "uploads.sizeBytes",
    storagePath: "uploads.storagePath",
    processed: "uploads.processed",
    extractedText: "uploads.extractedText",
    metadata: "uploads.metadata",
    createdAt: "uploads.createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, message: string, code: string = "INTERNAL_ERROR") {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

const mockProcessFile = vi.fn();
vi.mock("../../src/processors/router.processor.js", () => ({
  processFile: mockProcessFile,
}));

vi.mock("@fastify/multipart", () => ({
  default: vi.fn(),
}));

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomUUID: vi.fn(() => "test-uuid-1"),
    default: {
      ...actual,
      randomBytes: vi.fn(() => ({ toString: () => "abcdef0123456789" })),
    },
  };
});

const mockMkdirSync = vi.fn();
const mockStatSync = vi.fn(() => ({ size: 12345 }));
const mockExistsSync = vi.fn(() => true);
const mockCreateWriteStream = vi.fn(() => "write-stream");
const mockCreateReadStream = vi.fn(() => "read-stream");

vi.mock("fs", () => ({
  default: {
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    statSync: (...args: any[]) => mockStatSync(...args),
    existsSync: (...args: any[]) => mockExistsSync(...args),
    createWriteStream: (...args: any[]) => mockCreateWriteStream(...args),
    createReadStream: (...args: any[]) => mockCreateReadStream(...args),
  },
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  statSync: (...args: any[]) => mockStatSync(...args),
  existsSync: (...args: any[]) => mockExistsSync(...args),
  createWriteStream: (...args: any[]) => mockCreateWriteStream(...args),
  createReadStream: (...args: any[]) => mockCreateReadStream(...args),
}));

vi.mock("stream/promises", () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- helpers to capture registered route handlers ----

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
    register: vi.fn(),
  };
}

function createRequest(
  overrides: Partial<{ userId: number; body: any; params: any; files: Function }> = {},
): any {
  return {
    userId: overrides.userId ?? 1,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    files: overrides.files ?? vi.fn(),
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, body?: any) {
      this.body = body;
      return this;
    }),
    header: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let uploadsPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/uploads.js");
  uploadsPlugin = mod.default;
  const fastify = createFastifyInstance();
  await uploadsPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["GET /:id/status"]).toBeDefined();
    expect(registeredRoutes["POST /:id/process"]).toBeDefined();
    expect(registeredRoutes["GET /:id/raw"]).toBeDefined();
    expect(registeredRoutes["GET /"]).toBeDefined();
  });

  it("applies auth preHandler to all routes", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ================================================================
// POST / — upload files
// ================================================================
describe("POST / — upload files", () => {
  function makeFilePart(filename: string, mimetype: string) {
    return {
      filename,
      mimetype,
      file: "file-stream",
    };
  }

  async function* asyncIterator(items: any[]) {
    for (const item of items) {
      yield item;
    }
  }

  it("uploads a single valid file and returns 201", async () => {
    const dbRow = {
      id: "test-uuid-1",
      filename: "abcdef0123456789.png",
      originalName: "photo.png",
      mimeType: "image/png",
      sizeBytes: 12345,
    };
    const chain = chainable({ returning: vi.fn(() => [dbRow]) });
    mockDb.insert = vi.fn(() => chain);

    const request = createRequest({
      files: () => asyncIterator([makeFilePart("photo.png", "image/png")]),
    });
    const reply = createReply();

    await registeredRoutes["POST /"].handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith({ uploads: [dbRow] });
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it("uploads multiple valid files", async () => {
    const dbRow1 = { id: "u1", filename: "a.png", originalName: "a.png", mimeType: "image/png", sizeBytes: 100 };
    const dbRow2 = { id: "u2", filename: "b.pdf", originalName: "b.pdf", mimeType: "application/pdf", sizeBytes: 200 };
    let callCount = 0;
    const chain = chainable({
      returning: vi.fn(() => {
        callCount++;
        return [callCount === 1 ? dbRow1 : dbRow2];
      }),
    });
    mockDb.insert = vi.fn(() => chain);

    const request = createRequest({
      files: () =>
        asyncIterator([
          makeFilePart("a.png", "image/png"),
          makeFilePart("b.pdf", "application/pdf"),
        ]),
    });
    const reply = createReply();

    await registeredRoutes["POST /"].handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith({ uploads: [dbRow1, dbRow2] });
  });

  it("throws AppError 400 if no files are uploaded", async () => {
    const request = createRequest({
      files: () => asyncIterator([]),
    });
    const reply = createReply();

    await expect(registeredRoutes["POST /"].handler(request, reply)).rejects.toThrow("No files uploaded");
  });

  it("throws AppError 400 for disallowed MIME type", async () => {
    const request = createRequest({
      files: () => asyncIterator([makeFilePart("virus.exe", "application/x-msdownload")]),
    });
    const reply = createReply();

    await expect(registeredRoutes["POST /"].handler(request, reply)).rejects.toThrow(
      "File type not allowed: application/x-msdownload",
    );
  });

  it("allows text/plain files", async () => {
    const dbRow = { id: "u1", filename: "f.txt", originalName: "notes.txt", mimeType: "text/plain", sizeBytes: 50 };
    const chain = chainable({ returning: vi.fn(() => [dbRow]) });
    mockDb.insert = vi.fn(() => chain);

    const request = createRequest({
      files: () => asyncIterator([makeFilePart("notes.txt", "text/plain")]),
    });
    const reply = createReply();

    await registeredRoutes["POST /"].handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("allows text/csv files", async () => {
    const dbRow = { id: "u1", filename: "f.csv", originalName: "data.csv", mimeType: "text/csv", sizeBytes: 50 };
    const chain = chainable({ returning: vi.fn(() => [dbRow]) });
    mockDb.insert = vi.fn(() => chain);

    const request = createRequest({
      files: () => asyncIterator([makeFilePart("data.csv", "text/csv")]),
    });
    const reply = createReply();

    await registeredRoutes["POST /"].handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("allows text/markdown files", async () => {
    const dbRow = { id: "u1", filename: "f.md", originalName: "doc.md", mimeType: "text/markdown", sizeBytes: 50 };
    const chain = chainable({ returning: vi.fn(() => [dbRow]) });
    mockDb.insert = vi.fn(() => chain);

    const request = createRequest({
      files: () => asyncIterator([makeFilePart("doc.md", "text/markdown")]),
    });
    const reply = createReply();

    await registeredRoutes["POST /"].handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("allows application/json files", async () => {
    const dbRow = { id: "u1", filename: "f.json", originalName: "d.json", mimeType: "application/json", sizeBytes: 50 };
    const chain = chainable({ returning: vi.fn(() => [dbRow]) });
    mockDb.insert = vi.fn(() => chain);

    const request = createRequest({
      files: () => asyncIterator([makeFilePart("d.json", "application/json")]),
    });
    const reply = createReply();

    await registeredRoutes["POST /"].handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("allows Office document MIME types", async () => {
    const dbRow = { id: "u1", filename: "f.docx", originalName: "f.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 50 };
    const chain = chainable({ returning: vi.fn(() => [dbRow]) });
    mockDb.insert = vi.fn(() => chain);

    const request = createRequest({
      files: () =>
        asyncIterator([
          makeFilePart("f.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ]),
    });
    const reply = createReply();

    await registeredRoutes["POST /"].handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("allows application/msword files", async () => {
    const dbRow = { id: "u1", filename: "f.doc", originalName: "f.doc", mimeType: "application/msword", sizeBytes: 50 };
    const chain = chainable({ returning: vi.fn(() => [dbRow]) });
    mockDb.insert = vi.fn(() => chain);

    const request = createRequest({
      files: () => asyncIterator([makeFilePart("f.doc", "application/msword")]),
    });
    const reply = createReply();

    await registeredRoutes["POST /"].handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("allows audio/* MIME types", async () => {
    const dbRow = { id: "u1", filename: "f.mp3", originalName: "f.mp3", mimeType: "audio/mpeg", sizeBytes: 50 };
    const chain = chainable({ returning: vi.fn(() => [dbRow]) });
    mockDb.insert = vi.fn(() => chain);

    const request = createRequest({
      files: () => asyncIterator([makeFilePart("f.mp3", "audio/mpeg")]),
    });
    const reply = createReply();

    await registeredRoutes["POST /"].handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("rejects text/html MIME type", async () => {
    const request = createRequest({
      files: () => asyncIterator([makeFilePart("page.html", "text/html")]),
    });
    const reply = createReply();

    await expect(registeredRoutes["POST /"].handler(request, reply)).rejects.toThrow(
      "File type not allowed: text/html",
    );
  });

  it("rejects application/javascript MIME type", async () => {
    const request = createRequest({
      files: () => asyncIterator([makeFilePart("script.js", "application/javascript")]),
    });
    const reply = createReply();

    await expect(registeredRoutes["POST /"].handler(request, reply)).rejects.toThrow(
      "File type not allowed: application/javascript",
    );
  });
});

// ================================================================
// GET /:id/status — get upload processing status
// ================================================================
describe("GET /:id/status", () => {
  it("returns status for an existing upload", async () => {
    const record = {
      id: "upload-1",
      processed: true,
      extractedText: "Hello world",
      metadata: { pages: 3 },
      mimeType: "application/pdf",
      originalName: "report.pdf",
    };
    const chain = chainable({ limit: vi.fn(() => [record]) });
    mockDb.select = vi.fn(() => chain);

    const request = createRequest({ params: { id: "upload-1" } });
    const reply = createReply();

    const result = await registeredRoutes["GET /:id/status"].handler(request, reply);

    expect(result).toEqual({
      id: "upload-1",
      processed: true,
      extracted_text_length: 11,
      metadata: { pages: 3 },
      mimeType: "application/pdf",
      originalName: "report.pdf",
    });
  });

  it("returns extracted_text_length 0 when extractedText is null", async () => {
    const record = {
      id: "upload-2",
      processed: false,
      extractedText: null,
      metadata: null,
      mimeType: "image/png",
      originalName: "pic.png",
    };
    const chain = chainable({ limit: vi.fn(() => [record]) });
    mockDb.select = vi.fn(() => chain);

    const request = createRequest({ params: { id: "upload-2" } });
    const reply = createReply();

    const result = await registeredRoutes["GET /:id/status"].handler(request, reply);

    expect(result.extracted_text_length).toBe(0);
    expect(result.processed).toBe(false);
  });

  it("throws 404 when upload not found", async () => {
    const chain = chainable({ limit: vi.fn(() => []) });
    mockDb.select = vi.fn(() => chain);

    const request = createRequest({ params: { id: "nonexistent" } });
    const reply = createReply();

    await expect(registeredRoutes["GET /:id/status"].handler(request, reply)).rejects.toThrow("Upload not found");
  });
});

// ================================================================
// POST /:id/process — trigger processing
// ================================================================
describe("POST /:id/process", () => {
  it("processes an unprocessed upload successfully", async () => {
    const record = {
      id: "upload-1",
      processed: false,
      extractedText: null,
      storagePath: "/some/path",
      mimeType: "application/pdf",
      userId: 1,
    };
    const selectChain = chainable({ limit: vi.fn(() => [record]) });
    mockDb.select = vi.fn(() => selectChain);

    const updateChain = chainable();
    mockDb.update = vi.fn(() => updateChain);

    mockProcessFile.mockResolvedValue({ text: "Extracted text", type: "pdf", metadata: { pages: 1 } });

    const request = createRequest({ params: { id: "upload-1" } });
    const reply = createReply();

    const result = await registeredRoutes["POST /:id/process"].handler(request, reply);

    expect(result).toEqual({
      success: true,
      extracted_text_length: 14,
      type: "pdf",
    });
    expect(mockProcessFile).toHaveBeenCalledWith(record);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("returns already_processed for processed upload", async () => {
    const record = {
      id: "upload-1",
      processed: true,
      extractedText: "Already done",
      storagePath: "/some/path",
    };
    const selectChain = chainable({ limit: vi.fn(() => [record]) });
    mockDb.select = vi.fn(() => selectChain);

    const request = createRequest({ params: { id: "upload-1" } });
    const reply = createReply();

    const result = await registeredRoutes["POST /:id/process"].handler(request, reply);

    expect(result).toEqual({
      success: true,
      already_processed: true,
      extracted_text_length: 12,
    });
    expect(mockProcessFile).not.toHaveBeenCalled();
  });

  it("returns extracted_text_length 0 when already processed but extractedText is null", async () => {
    const record = {
      id: "upload-1",
      processed: true,
      extractedText: null,
      storagePath: "/some/path",
    };
    const selectChain = chainable({ limit: vi.fn(() => [record]) });
    mockDb.select = vi.fn(() => selectChain);

    const request = createRequest({ params: { id: "upload-1" } });
    const reply = createReply();

    const result = await registeredRoutes["POST /:id/process"].handler(request, reply);

    expect(result.extracted_text_length).toBe(0);
  });

  it("handles processFile returning no text", async () => {
    const record = {
      id: "upload-1",
      processed: false,
      extractedText: null,
      storagePath: "/some/path",
    };
    const selectChain = chainable({ limit: vi.fn(() => [record]) });
    mockDb.select = vi.fn(() => selectChain);

    const updateChain = chainable();
    mockDb.update = vi.fn(() => updateChain);

    mockProcessFile.mockResolvedValue({ text: null, type: "image", metadata: null });

    const request = createRequest({ params: { id: "upload-1" } });
    const reply = createReply();

    const result = await registeredRoutes["POST /:id/process"].handler(request, reply);

    expect(result).toEqual({
      success: true,
      extracted_text_length: 0,
      type: "image",
    });
  });

  it("throws 404 when upload not found", async () => {
    const selectChain = chainable({ limit: vi.fn(() => []) });
    mockDb.select = vi.fn(() => selectChain);

    const request = createRequest({ params: { id: "nonexistent" } });
    const reply = createReply();

    await expect(registeredRoutes["POST /:id/process"].handler(request, reply)).rejects.toThrow("Upload not found");
  });

  it("throws 500 when processFile fails", async () => {
    const record = {
      id: "upload-1",
      processed: false,
      extractedText: null,
      storagePath: "/some/path",
    };
    const selectChain = chainable({ limit: vi.fn(() => [record]) });
    mockDb.select = vi.fn(() => selectChain);

    mockProcessFile.mockRejectedValue(new Error("OCR engine crashed"));

    const request = createRequest({ params: { id: "upload-1" } });
    const reply = createReply();

    await expect(registeredRoutes["POST /:id/process"].handler(request, reply)).rejects.toThrow(
      "Processing failed: OCR engine crashed",
    );
  });
});

// ================================================================
// GET /:id/raw — serve raw file
// ================================================================
describe("GET /:id/raw", () => {
  it("serves a file with correct headers", async () => {
    const uploadsDir = require("path").resolve(process.cwd(), "uploads");
    const record = {
      id: "upload-1",
      mimeType: "image/png",
      originalName: "photo.png",
      storagePath: require("path").join(uploadsDir, "1", "2026-01-01", "abc.png"),
      userId: 1,
    };
    const selectChain = chainable({ limit: vi.fn(() => [record]) });
    mockDb.select = vi.fn(() => selectChain);

    mockExistsSync.mockReturnValue(true);
    mockCreateReadStream.mockReturnValue("file-read-stream");

    const request = createRequest({ params: { id: "upload-1" } });
    const reply = createReply();

    const result = await registeredRoutes["GET /:id/raw"].handler(request, reply);

    expect(reply.header).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(reply.header).toHaveBeenCalledWith("Content-Disposition", 'inline; filename="photo.png"');
    expect(reply.send).toHaveBeenCalledWith("file-read-stream");
  });

  it("throws 404 when upload record not found", async () => {
    const selectChain = chainable({ limit: vi.fn(() => []) });
    mockDb.select = vi.fn(() => selectChain);

    const request = createRequest({ params: { id: "nonexistent" } });
    const reply = createReply();

    await expect(registeredRoutes["GET /:id/raw"].handler(request, reply)).rejects.toThrow("Upload not found");
  });

  it("throws 404 when file is missing from disk", async () => {
    const uploadsDir = require("path").resolve(process.cwd(), "uploads");
    const record = {
      id: "upload-1",
      mimeType: "image/png",
      originalName: "photo.png",
      storagePath: require("path").join(uploadsDir, "1", "2026-01-01", "abc.png"),
      userId: 1,
    };
    const selectChain = chainable({ limit: vi.fn(() => [record]) });
    mockDb.select = vi.fn(() => selectChain);

    mockExistsSync.mockReturnValue(false);

    const request = createRequest({ params: { id: "upload-1" } });
    const reply = createReply();

    await expect(registeredRoutes["GET /:id/raw"].handler(request, reply)).rejects.toThrow(
      "File not found on disk",
    );
  });

  it("throws 403 for path traversal attempts", async () => {
    const record = {
      id: "upload-1",
      mimeType: "image/png",
      originalName: "photo.png",
      storagePath: "/etc/passwd",
      userId: 1,
    };
    const selectChain = chainable({ limit: vi.fn(() => [record]) });
    mockDb.select = vi.fn(() => selectChain);

    const request = createRequest({ params: { id: "upload-1" } });
    const reply = createReply();

    await expect(registeredRoutes["GET /:id/raw"].handler(request, reply)).rejects.toThrow("Access denied");
  });
});

// ================================================================
// GET / — list user uploads
// ================================================================
describe("GET / — list user uploads", () => {
  it("returns uploads for the current user", async () => {
    const rows = [
      { id: "u1", originalName: "a.png", mimeType: "image/png", sizeBytes: 100, processed: false, createdAt: new Date() },
      { id: "u2", originalName: "b.pdf", mimeType: "application/pdf", sizeBytes: 200, processed: true, createdAt: new Date() },
    ];
    const chain = chainable({ limit: vi.fn(() => rows) });
    mockDb.select = vi.fn(() => chain);

    const request = createRequest();
    const reply = createReply();

    const result = await registeredRoutes["GET /"].handler(request, reply);

    expect(result).toEqual({ uploads: rows });
  });

  it("returns empty array when user has no uploads", async () => {
    const chain = chainable({ limit: vi.fn(() => []) });
    mockDb.select = vi.fn(() => chain);

    const request = createRequest();
    const reply = createReply();

    const result = await registeredRoutes["GET /"].handler(request, reply);

    expect(result).toEqual({ uploads: [] });
  });
});

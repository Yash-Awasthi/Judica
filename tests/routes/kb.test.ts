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
  knowledgeBases: {
    id: "kb.id",
    userId: "kb.userId",
    name: "kb.name",
    description: "kb.description",
    createdAt: "kb.createdAt",
    updatedAt: "kb.updatedAt",
  },
  kbDocuments: {
    id: "kbDoc.id",
    kbId: "kbDoc.kbId",
    uploadId: "kbDoc.uploadId",
    filename: "kbDoc.filename",
    chunkCount: "kbDoc.chunkCount",
    indexed: "kbDoc.indexed",
    indexedAt: "kbDoc.indexedAt",
    createdAt: "kbDoc.createdAt",
  },
  uploads: {
    id: "uploads.id",
    userId: "uploads.userId",
    processed: "uploads.processed",
    extractedText: "uploads.extractedText",
    originalName: "uploads.originalName",
  },
}));

vi.mock("../../src/db/schema/memory.js", () => ({
  memories: { kbId: "memories.kbId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  count: vi.fn(() => "count"),
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

const mockIngestDocument = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/services/ingestion.service.js", () => ({
  ingestDocument: mockIngestDocument,
}));

const mockDeleteKBChunks = vi.fn().mockResolvedValue(undefined);
const mockDeleteDocChunks = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/services/vectorStore.service.js", () => ({
  deleteKBChunks: mockDeleteKBChunks,
  deleteDocChunks: mockDeleteDocChunks,
}));

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  let callCount = 0;
  return {
    ...actual,
    randomUUID: vi.fn(() => `test-uuid-${++callCount}`),
  };
});

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
  };
}

function createRequest(overrides: Partial<{ userId: string; body: any; params: any }> = {}): any {
  return {
    userId: overrides.userId ?? "user-1",
    body: overrides.body ?? {},
    params: overrides.params ?? {},
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let kbPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/kb.js");
  kbPlugin = mod.default;
  const fastify = createFastifyInstance();
  await kbPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["GET /:id"]).toBeDefined();
    expect(registeredRoutes["DELETE /:id"]).toBeDefined();
    expect(registeredRoutes["POST /:id/documents"]).toBeDefined();
    expect(registeredRoutes["GET /:id/documents"]).toBeDefined();
    expect(registeredRoutes["DELETE /:kbId/documents/:docId"]).toBeDefined();
  });

  it("all routes have a preHandler for auth", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ================================================================
// GET / — list knowledge bases
// ================================================================
describe("GET /", () => {
  it("returns knowledge bases with doc and chunk counts", async () => {
    const now = new Date();
    const mockKbs = [
      { id: "kb-1", name: "KB One", description: "First", createdAt: now, updatedAt: now },
    ];

    // First select: list KBs; subsequent selects: count queries (doc count, chunk count)
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  orderBy: vi.fn().mockResolvedValue(mockKbs),
                })
              ),
            })
          ),
        });
      }
      // For the single KB: call 2 = doc count (5), call 3 = chunk count (42)
      const val = selectCallIndex === 2 ? 5 : 42;
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([{ value: val }]),
          })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result.knowledge_bases).toHaveLength(1);
    expect(result.knowledge_bases[0]).toEqual({
      id: "kb-1",
      name: "KB One",
      description: "First",
      document_count: 5,
      chunk_count: 42,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("returns empty array when user has no knowledge bases", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn().mockResolvedValue([]),
              })
            ),
          })
        ),
      })
    );

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());
    expect(result).toEqual({ knowledge_bases: [] });
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn().mockRejectedValue(new Error("db down")),
              })
            ),
          })
        ),
      })
    );

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("db down");
  });
});

// ================================================================
// POST / — create knowledge base
// ================================================================
describe("POST /", () => {
  it("creates a knowledge base and returns 201", async () => {
    const createdKb = { id: "test-uuid-1", name: "My KB", description: null, userId: "user-1" };
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([createdKb]),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const request = createRequest({ body: { name: "My KB" } });

    const result = await handler(request, reply);
    expect(result).toEqual(createdKb);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("trims name and description whitespace", async () => {
    const createdKb = { id: "test-uuid-1", name: "Trimmed", description: "Desc" };
    const valuesCall = vi.fn(() => chainable({ returning: vi.fn().mockResolvedValue([createdKb]) }));
    const chain = chainable({ values: valuesCall });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { name: "  Trimmed  ", description: "  Desc  " } });
    await handler(request, createReply());

    expect(valuesCall).toHaveBeenCalled();
    const valuesArg = valuesCall.mock.calls[0][0];
    expect(valuesArg.name).toBe("Trimmed");
    expect(valuesArg.description).toBe("Desc");
  });

  it("sets description to null when not provided", async () => {
    const createdKb = { id: "test-uuid-1", name: "No Desc" };
    const valuesCall = vi.fn(() => chainable({ returning: vi.fn().mockResolvedValue([createdKb]) }));
    const chain = chainable({ values: valuesCall });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { name: "No Desc" } });
    await handler(request, createReply());

    const valuesArg = valuesCall.mock.calls[0][0];
    expect(valuesArg.description).toBeNull();
  });

  it("sets description to null when description is empty string", async () => {
    const createdKb = { id: "test-uuid-1", name: "Empty Desc" };
    const valuesCall = vi.fn(() => chainable({ returning: vi.fn().mockResolvedValue([createdKb]) }));
    const chain = chainable({ values: valuesCall });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { name: "Empty Desc", description: "   " } });
    await handler(request, createReply());

    const valuesArg = valuesCall.mock.calls[0][0];
    expect(valuesArg.description).toBeNull();
  });

  it("throws AppError when name is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: {} });

    await expect(handler(request, createReply())).rejects.toThrow("Name is required");
  });

  it("throws AppError when name is empty string", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { name: "" } });

    await expect(handler(request, createReply())).rejects.toThrow("Name is required");
  });

  it("throws AppError when name is whitespace only", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { name: "   " } });

    await expect(handler(request, createReply())).rejects.toThrow("Name is required");
  });

  it("throws AppError when name is not a string", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { name: 123 } });

    await expect(handler(request, createReply())).rejects.toThrow("Name is required");
  });

  it("propagates db errors during insert", async () => {
    const chain = chainable({
      returning: vi.fn().mockRejectedValue(new Error("insert failed")),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { name: "test" } });
    await expect(handler(request, createReply())).rejects.toThrow("insert failed");
  });
});

// ================================================================
// GET /:id — get knowledge base detail
// ================================================================
describe("GET /:id", () => {
  it("returns knowledge base with documents and chunk count", async () => {
    const now = new Date();
    const mockKb = { id: "kb-1", name: "My KB", description: "desc", userId: "user-1", createdAt: now, updatedAt: now };
    const mockDocs = [
      { id: "doc-1", filename: "file.pdf", chunkCount: 10, indexed: true, indexedAt: now, createdAt: now },
    ];

    let selectCallIndex = 0;
    mockDb.select = vi.fn((...args: any[]) => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        // KB lookup
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  limit: vi.fn().mockResolvedValue([mockKb]),
                })
              ),
            })
          ),
        });
      }
      if (selectCallIndex === 2) {
        // Docs query
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  orderBy: vi.fn().mockResolvedValue(mockDocs),
                })
              ),
            })
          ),
        });
      }
      // Chunk count query
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([{ value: 42 }]),
          })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "kb-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({
      ...mockKb,
      documents: mockDocs,
      chunk_count: 42,
    });
  });

  it("throws 404 when knowledge base not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                limit: vi.fn().mockResolvedValue([]),
              })
            ),
          })
        ),
      })
    );

    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "nonexistent" } });

    await expect(handler(request, createReply())).rejects.toThrow("Knowledge base not found");
  });

  it("returns empty documents array when KB has no docs", async () => {
    const mockKb = { id: "kb-1", name: "Empty KB" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn((...args: any[]) => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  limit: vi.fn().mockResolvedValue([mockKb]),
                })
              ),
            })
          ),
        });
      }
      if (selectCallIndex === 2) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  orderBy: vi.fn().mockResolvedValue([]),
                })
              ),
            })
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([{ value: 0 }]),
          })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "kb-1" } });
    const result = await handler(request, createReply());

    expect(result.documents).toEqual([]);
    expect(result.chunk_count).toBe(0);
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                limit: vi.fn().mockRejectedValue(new Error("db error")),
              })
            ),
          })
        ),
      })
    );

    const { handler } = registeredRoutes["GET /:id"];
    await expect(handler(createRequest({ params: { id: "kb-1" } }), createReply())).rejects.toThrow("db error");
  });
});

// ================================================================
// DELETE /:id — delete knowledge base
// ================================================================
describe("DELETE /:id", () => {
  it("deletes knowledge base and its chunks successfully", async () => {
    const mockKb = { id: "kb-1", name: "My KB", userId: "user-1" };

    // Select KB
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                limit: vi.fn().mockResolvedValue([mockKb]),
              })
            ),
          })
        ),
      })
    );

    // Delete KB record
    mockDb.delete = vi.fn(() =>
      chainable({
        where: vi.fn().mockResolvedValue(undefined),
      })
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "kb-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ success: true });
    expect(mockDeleteKBChunks).toHaveBeenCalledWith("kb-1");
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("throws 404 when knowledge base not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                limit: vi.fn().mockResolvedValue([]),
              })
            ),
          })
        ),
      })
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "nonexistent" } });

    await expect(handler(request, createReply())).rejects.toThrow("Knowledge base not found");
  });

  it("does not delete from DB if deleteKBChunks fails", async () => {
    const mockKb = { id: "kb-1", name: "My KB", userId: "user-1" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                limit: vi.fn().mockResolvedValue([mockKb]),
              })
            ),
          })
        ),
      })
    );

    mockDeleteKBChunks.mockRejectedValueOnce(new Error("vector store error"));

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "kb-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("vector store error");
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("propagates db errors during delete", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                limit: vi.fn().mockResolvedValue([mockKb]),
              })
            ),
          })
        ),
      })
    );

    mockDb.delete = vi.fn(() =>
      chainable({
        where: vi.fn().mockRejectedValue(new Error("delete failed")),
      })
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "kb-1" } });
    await expect(handler(request, createReply())).rejects.toThrow("delete failed");
  });
});

// ================================================================
// POST /:id/documents — add document to KB
// ================================================================
describe("POST /:id/documents", () => {
  function setupKbAndUploadMocks(
    kb: any | null,
    upload: any | null,
  ) {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        // KB lookup
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  limit: vi.fn().mockResolvedValue(kb ? [kb] : []),
                })
              ),
            })
          ),
        });
      }
      // Upload lookup
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                limit: vi.fn().mockResolvedValue(upload ? [upload] : []),
              })
            ),
          })
        ),
      });
    });
  }

  it("adds document and starts ingestion, returns 201", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    const mockUpload = {
      id: "upload-1",
      userId: "user-1",
      originalName: "doc.pdf",
      processed: true,
      extractedText: "Hello world",
    };
    const mockDoc = { id: "doc-1", kbId: "kb-1", uploadId: "upload-1", filename: "doc.pdf" };

    setupKbAndUploadMocks(mockKb, mockUpload);

    mockDb.insert = vi.fn(() =>
      chainable({
        returning: vi.fn().mockResolvedValue([mockDoc]),
      })
    );

    const { handler } = registeredRoutes["POST /:id/documents"];
    const reply = createReply();
    const request = createRequest({
      params: { id: "kb-1" },
      body: { upload_id: "upload-1" },
    });

    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(result).toEqual({ document: mockDoc, message: "Indexing started in background" });
    expect(mockIngestDocument).toHaveBeenCalledWith(
      "user-1",
      "kb-1",
      "doc-1",
      "doc.pdf",
      "Hello world",
    );
  });

  it("throws 400 when upload_id is missing", async () => {
    const { handler } = registeredRoutes["POST /:id/documents"];
    const request = createRequest({ params: { id: "kb-1" }, body: {} });

    await expect(handler(request, createReply())).rejects.toThrow("upload_id is required");
  });

  it("throws 404 when knowledge base not found", async () => {
    setupKbAndUploadMocks(null, null);

    const { handler } = registeredRoutes["POST /:id/documents"];
    const request = createRequest({
      params: { id: "nonexistent" },
      body: { upload_id: "upload-1" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Knowledge base not found");
  });

  it("throws 404 when upload not found", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    setupKbAndUploadMocks(mockKb, null);

    const { handler } = registeredRoutes["POST /:id/documents"];
    const request = createRequest({
      params: { id: "kb-1" },
      body: { upload_id: "nonexistent" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Upload not found");
  });

  it("throws 400 when upload is not processed", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    const mockUpload = {
      id: "upload-1",
      userId: "user-1",
      originalName: "doc.pdf",
      processed: false,
      extractedText: null,
    };
    setupKbAndUploadMocks(mockKb, mockUpload);

    const { handler } = registeredRoutes["POST /:id/documents"];
    const request = createRequest({
      params: { id: "kb-1" },
      body: { upload_id: "upload-1" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Upload must be processed first");
  });

  it("throws 400 when upload has no extractedText", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    const mockUpload = {
      id: "upload-1",
      userId: "user-1",
      originalName: "doc.pdf",
      processed: true,
      extractedText: null,
    };
    setupKbAndUploadMocks(mockKb, mockUpload);

    const { handler } = registeredRoutes["POST /:id/documents"];
    const request = createRequest({
      params: { id: "kb-1" },
      body: { upload_id: "upload-1" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Upload must be processed first");
  });

  it("does not block response when background ingestion fails", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    const mockUpload = {
      id: "upload-1",
      userId: "user-1",
      originalName: "doc.pdf",
      processed: true,
      extractedText: "text",
    };
    const mockDoc = { id: "doc-1", kbId: "kb-1", uploadId: "upload-1", filename: "doc.pdf" };

    setupKbAndUploadMocks(mockKb, mockUpload);
    mockDb.insert = vi.fn(() =>
      chainable({
        returning: vi.fn().mockResolvedValue([mockDoc]),
      })
    );

    // Make ingestion fail
    mockIngestDocument.mockReturnValueOnce(Promise.reject(new Error("ingestion boom")));

    const { handler } = registeredRoutes["POST /:id/documents"];
    const reply = createReply();
    const request = createRequest({
      params: { id: "kb-1" },
      body: { upload_id: "upload-1" },
    });

    // Should not throw even though ingestion fails
    const result = await handler(request, reply);
    expect(result.document).toEqual(mockDoc);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("propagates db errors during document insert", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    const mockUpload = {
      id: "upload-1",
      userId: "user-1",
      originalName: "doc.pdf",
      processed: true,
      extractedText: "text",
    };
    setupKbAndUploadMocks(mockKb, mockUpload);

    mockDb.insert = vi.fn(() =>
      chainable({
        returning: vi.fn().mockRejectedValue(new Error("insert failed")),
      })
    );

    const { handler } = registeredRoutes["POST /:id/documents"];
    const request = createRequest({
      params: { id: "kb-1" },
      body: { upload_id: "upload-1" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("insert failed");
  });
});

// ================================================================
// GET /:id/documents — list documents in KB
// ================================================================
describe("GET /:id/documents", () => {
  it("returns documents for the knowledge base", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    const mockDocs = [
      { id: "doc-1", kbId: "kb-1", filename: "a.pdf", createdAt: new Date() },
      { id: "doc-2", kbId: "kb-1", filename: "b.pdf", createdAt: new Date() },
    ];

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  limit: vi.fn().mockResolvedValue([mockKb]),
                })
              ),
            })
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn().mockResolvedValue(mockDocs),
              })
            ),
          })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id/documents"];
    const request = createRequest({ params: { id: "kb-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ documents: mockDocs });
  });

  it("throws 404 when knowledge base not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                limit: vi.fn().mockResolvedValue([]),
              })
            ),
          })
        ),
      })
    );

    const { handler } = registeredRoutes["GET /:id/documents"];
    const request = createRequest({ params: { id: "nonexistent" } });

    await expect(handler(request, createReply())).rejects.toThrow("Knowledge base not found");
  });

  it("returns empty documents array when KB has no docs", async () => {
    const mockKb = { id: "kb-1", name: "Empty KB" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  limit: vi.fn().mockResolvedValue([mockKb]),
                })
              ),
            })
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn().mockResolvedValue([]),
              })
            ),
          })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id/documents"];
    const request = createRequest({ params: { id: "kb-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ documents: [] });
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                limit: vi.fn().mockRejectedValue(new Error("db error")),
              })
            ),
          })
        ),
      })
    );

    const { handler } = registeredRoutes["GET /:id/documents"];
    await expect(handler(createRequest({ params: { id: "kb-1" } }), createReply())).rejects.toThrow("db error");
  });
});

// ================================================================
// DELETE /:kbId/documents/:docId — remove document from KB
// ================================================================
describe("DELETE /:kbId/documents/:docId", () => {
  function setupKbAndDocMocks(kb: any | null, doc: any | null) {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  limit: vi.fn().mockResolvedValue(kb ? [kb] : []),
                })
              ),
            })
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                limit: vi.fn().mockResolvedValue(doc ? [doc] : []),
              })
            ),
          })
        ),
      });
    });
  }

  it("deletes document and its chunks successfully", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    const mockDoc = { id: "doc-1", kbId: "kb-1", filename: "file.pdf" };

    setupKbAndDocMocks(mockKb, mockDoc);
    mockDb.delete = vi.fn(() =>
      chainable({
        where: vi.fn().mockResolvedValue(undefined),
      })
    );

    const { handler } = registeredRoutes["DELETE /:kbId/documents/:docId"];
    const request = createRequest({ params: { kbId: "kb-1", docId: "doc-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ success: true });
    expect(mockDeleteDocChunks).toHaveBeenCalledWith("kb-1", "file.pdf");
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("throws 404 when knowledge base not found", async () => {
    setupKbAndDocMocks(null, null);

    const { handler } = registeredRoutes["DELETE /:kbId/documents/:docId"];
    const request = createRequest({ params: { kbId: "nonexistent", docId: "doc-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("Knowledge base not found");
  });

  it("throws 404 when document not found", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    setupKbAndDocMocks(mockKb, null);

    const { handler } = registeredRoutes["DELETE /:kbId/documents/:docId"];
    const request = createRequest({ params: { kbId: "kb-1", docId: "nonexistent" } });

    await expect(handler(request, createReply())).rejects.toThrow("Document not found");
  });

  it("does not delete from DB if deleteDocChunks fails", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    const mockDoc = { id: "doc-1", kbId: "kb-1", filename: "file.pdf" };

    setupKbAndDocMocks(mockKb, mockDoc);
    mockDeleteDocChunks.mockRejectedValueOnce(new Error("vector delete error"));

    const { handler } = registeredRoutes["DELETE /:kbId/documents/:docId"];
    const request = createRequest({ params: { kbId: "kb-1", docId: "doc-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("vector delete error");
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("propagates db errors during document delete", async () => {
    const mockKb = { id: "kb-1", name: "My KB" };
    const mockDoc = { id: "doc-1", kbId: "kb-1", filename: "file.pdf" };

    setupKbAndDocMocks(mockKb, mockDoc);
    mockDb.delete = vi.fn(() =>
      chainable({
        where: vi.fn().mockRejectedValue(new Error("delete failed")),
      })
    );

    const { handler } = registeredRoutes["DELETE /:kbId/documents/:docId"];
    const request = createRequest({ params: { kbId: "kb-1", docId: "doc-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("delete failed");
  });
});

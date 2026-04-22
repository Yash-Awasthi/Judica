import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    "offset",
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

vi.mock("../../src/db/schema/workflows.js", () => ({
  workflows: {
    id: "workflows.id",
    userId: "workflows.userId",
    name: "workflows.name",
    description: "workflows.description",
    definition: "workflows.definition",
    version: "workflows.version",
    published: "workflows.published",
    createdAt: "workflows.createdAt",
    updatedAt: "workflows.updatedAt",
  },
  workflowRuns: {
    id: "workflowRuns.id",
    workflowId: "workflowRuns.workflowId",
    userId: "workflowRuns.userId",
    status: "workflowRuns.status",
    inputs: "workflowRuns.inputs",
    outputs: "workflowRuns.outputs",
    error: "workflowRuns.error",
    startedAt: "workflowRuns.startedAt",
    endedAt: "workflowRuns.endedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  count: vi.fn(() => "count"),
  sql: vi.fn(),
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

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockResumeGate = vi.fn();
const mockRunGenerator = vi.fn();

vi.mock("../../src/workflow/executor.js", () => ({
  WorkflowExecutor: class MockWorkflowExecutor {
    constructor(..._args: any[]) {}
    run(...args: any[]) { return mockRunGenerator(...args); }
    resumeGate(...args: any[]) { return mockResumeGate(...args); }
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

function createRequest(
  overrides: Partial<{
    userId: number;
    body: any;
    params: any;
    query: any;
    headers: Record<string, string>;
    raw: any;
  }> = {},
): any {
  return {
    userId: overrides.userId ?? 1,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: overrides.headers ?? { authorization: "Bearer token" },
    raw: overrides.raw ?? { on: vi.fn() },
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
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    },
  };
  return reply;
}

// ---- import and register the plugin ----

let workflowsPlugin: any;
let activeRuns: Map<string, any>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockRunGenerator.mockReturnValue({
    [Symbol.asyncIterator]() {
      return { next: vi.fn().mockResolvedValue({ done: true }) };
    },
  });
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }
  const mod = await import("../../src/routes/workflows.js");
  workflowsPlugin = mod.default;
  activeRuns = mod.activeRuns;
  activeRuns.clear();
  const fastify = createFastifyInstance();
  await workflowsPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["GET /:id"]).toBeDefined();
    expect(registeredRoutes["PUT /:id"]).toBeDefined();
    expect(registeredRoutes["DELETE /:id"]).toBeDefined();
    expect(registeredRoutes["POST /:id/publish"]).toBeDefined();
    expect(registeredRoutes["POST /:id/run"]).toBeDefined();
    expect(registeredRoutes["GET /:id/runs"]).toBeDefined();
    expect(registeredRoutes["GET /runs/:runId"]).toBeDefined();
    expect(registeredRoutes["GET /runs/:runId/stream"]).toBeDefined();
    expect(registeredRoutes["POST /runs/:runId/gate"]).toBeDefined();
  });

  it("all routes have preHandler for auth", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ================================================================
// GET / — list workflows
// ================================================================
describe("GET / (list workflows)", () => {
  it("returns paginated workflows with total count", async () => {
    const mockWorkflows = [
      { id: "wf-1", name: "Workflow 1" },
      { id: "wf-2", name: "Workflow 2" },
    ];

    let selectCall = 0;
    mockDb.select = vi.fn(() => {
      selectCall++;
      if (selectCall === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  orderBy: vi.fn(() =>
                    chainable({
                      limit: vi.fn(() =>
                        chainable({
                          offset: vi.fn().mockResolvedValue(mockWorkflows),
                        })
                      ),
                    })
                  ),
                })
              ),
            })
          ),
        });
      }
      // count query
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([{ value: 5 }]),
          })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /"];
    const request = createRequest({ query: { limit: "10", offset: "0" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ workflows: mockWorkflows, total: 5 });
  });

  it("clamps limit to 1-100 range (defaults to 20)", async () => {
    let selectCall = 0;
    const limitFn = vi.fn(() => chainable({ offset: vi.fn().mockResolvedValue([]) }));
    mockDb.select = vi.fn(() => {
      selectCall++;
      if (selectCall === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  orderBy: vi.fn(() =>
                    chainable({ limit: limitFn })
                  ),
                })
              ),
            })
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({ where: vi.fn().mockResolvedValue([{ value: 0 }]) })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /"];
    // No limit in query should default to 20
    await handler(createRequest({ query: {} }), createReply());
    expect(limitFn).toHaveBeenCalledWith(20);
  });

  it("clamps limit over 100 to 100", async () => {
    let selectCall = 0;
    const limitFn = vi.fn(() => chainable({ offset: vi.fn().mockResolvedValue([]) }));
    mockDb.select = vi.fn(() => {
      selectCall++;
      if (selectCall === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  orderBy: vi.fn(() =>
                    chainable({ limit: limitFn })
                  ),
                })
              ),
            })
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({ where: vi.fn().mockResolvedValue([{ value: 0 }]) })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /"];
    await handler(createRequest({ query: { limit: "999" } }), createReply());
    expect(limitFn).toHaveBeenCalledWith(100);
  });

  it("clamps negative offset to 0", async () => {
    let selectCall = 0;
    const offsetFn = vi.fn().mockResolvedValue([]);
    mockDb.select = vi.fn(() => {
      selectCall++;
      if (selectCall === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  orderBy: vi.fn(() =>
                    chainable({ limit: vi.fn(() => chainable({ offset: offsetFn })) })
                  ),
                })
              ),
            })
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({ where: vi.fn().mockResolvedValue([{ value: 0 }]) })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /"];
    await handler(createRequest({ query: { offset: "-5" } }), createReply());
    expect(offsetFn).toHaveBeenCalledWith(0);
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn(() =>
                  chainable({
                    limit: vi.fn(() =>
                      chainable({
                        offset: vi.fn().mockRejectedValue(new Error("db down")),
                      })
                    ),
                  })
                ),
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
// POST / — create workflow
// ================================================================
describe("POST / (create workflow)", () => {
  const validDefinition = {
    nodes: [{ id: "n1", type: "input" }],
    edges: [],
  };

  it("creates workflow and returns 201", async () => {
    const created = { id: "wf-new", name: "My Flow", definition: validDefinition };
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([created]),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const request = createRequest({
      body: { name: "My Flow", definition: validDefinition },
    });

    const result = await handler(request, reply);
    expect(result).toEqual(created);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("trims name and description", async () => {
    const created = { id: "wf-new", name: "Trimmed" };
    const valuesFn = vi.fn(() => chainable({ returning: vi.fn().mockResolvedValue([created]) }));
    mockDb.insert = vi.fn(() => chainable({ values: valuesFn }));

    const { handler } = registeredRoutes["POST /"];
    await handler(
      createRequest({ body: { name: "  Trimmed  ", description: "  desc  ", definition: validDefinition } }),
      createReply(),
    );

    const insertedValues = valuesFn.mock.calls[0][0];
    expect(insertedValues.name).toBe("Trimmed");
    expect(insertedValues.description).toBe("desc");
  });

  it("sets description to null when not provided", async () => {
    const valuesFn = vi.fn(() => chainable({ returning: vi.fn().mockResolvedValue([{}]) }));
    mockDb.insert = vi.fn(() => chainable({ values: valuesFn }));

    const { handler } = registeredRoutes["POST /"];
    await handler(
      createRequest({ body: { name: "Test", definition: validDefinition } }),
      createReply(),
    );

    const insertedValues = valuesFn.mock.calls[0][0];
    expect(insertedValues.description).toBeNull();
  });

  it("throws when name is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { definition: validDefinition } }), createReply()),
    ).rejects.toThrow("Name is required");
  });

  it("throws when name is empty string", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "", definition: validDefinition } }), createReply()),
    ).rejects.toThrow("Name is required");
  });

  it("throws when name is whitespace only", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "   ", definition: validDefinition } }), createReply()),
    ).rejects.toThrow("Name is required");
  });

  it("throws when name is not a string", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: 123, definition: validDefinition } }), createReply()),
    ).rejects.toThrow("Name is required");
  });

  it("throws when definition is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "Test" } }), createReply()),
    ).rejects.toThrow("Definition must include nodes and edges arrays");
  });

  it("throws when definition.nodes is not an array", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({ body: { name: "Test", definition: { nodes: "bad", edges: [] } } }),
        createReply(),
      ),
    ).rejects.toThrow("Definition must include nodes and edges arrays");
  });

  it("throws when definition.edges is not an array", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({ body: { name: "Test", definition: { nodes: [], edges: "bad" } } }),
        createReply(),
      ),
    ).rejects.toThrow("Definition must include nodes and edges arrays");
  });

  it("throws when nodes array is empty", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({ body: { name: "Test", definition: { nodes: [], edges: [] } } }),
        createReply(),
      ),
    ).rejects.toThrow("Workflow must contain at least one node");
  });

  it("throws when a node is not a valid object", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({ body: { name: "Test", definition: { nodes: [null], edges: [] } } }),
        createReply(),
      ),
    ).rejects.toThrow("Node at index 0 is not a valid object");
  });

  it("throws when a node is missing id", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({ body: { name: "Test", definition: { nodes: [{ type: "input" }], edges: [] } } }),
        createReply(),
      ),
    ).rejects.toThrow('Node at index 0 is missing a valid "id" string');
  });

  it("throws when a node id is not a string", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({ body: { name: "Test", definition: { nodes: [{ id: 123, type: "input" }], edges: [] } } }),
        createReply(),
      ),
    ).rejects.toThrow('Node at index 0 is missing a valid "id" string');
  });

  it("throws when a node is missing type", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({ body: { name: "Test", definition: { nodes: [{ id: "n1" }], edges: [] } } }),
        createReply(),
      ),
    ).rejects.toThrow('Node "n1" is missing a valid "type" string');
  });

  it("throws on duplicate node ids", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({
          body: {
            name: "Test",
            definition: {
              nodes: [
                { id: "n1", type: "input" },
                { id: "n1", type: "output" },
              ],
              edges: [],
            },
          },
        }),
        createReply(),
      ),
    ).rejects.toThrow('Duplicate node id "n1"');
  });

  it("throws when edge is not a valid object", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({
          body: {
            name: "Test",
            definition: { nodes: [{ id: "n1", type: "input" }], edges: [null] },
          },
        }),
        createReply(),
      ),
    ).rejects.toThrow("Edge at index 0 is not a valid object");
  });

  it("throws when edge is missing source", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({
          body: {
            name: "Test",
            definition: {
              nodes: [{ id: "n1", type: "input" }],
              edges: [{ target: "n1" }],
            },
          },
        }),
        createReply(),
      ),
    ).rejects.toThrow('Edge at index 0 is missing a valid "source" string');
  });

  it("throws when edge is missing target", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({
          body: {
            name: "Test",
            definition: {
              nodes: [{ id: "n1", type: "input" }],
              edges: [{ source: "n1" }],
            },
          },
        }),
        createReply(),
      ),
    ).rejects.toThrow('Edge at index 0 is missing a valid "target" string');
  });

  it("throws when edge references unknown source node", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({
          body: {
            name: "Test",
            definition: {
              nodes: [{ id: "n1", type: "input" }],
              edges: [{ source: "unknown", target: "n1" }],
            },
          },
        }),
        createReply(),
      ),
    ).rejects.toThrow('Edge at index 0 references unknown source node "unknown"');
  });

  it("throws when edge references unknown target node", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(
        createRequest({
          body: {
            name: "Test",
            definition: {
              nodes: [{ id: "n1", type: "input" }],
              edges: [{ source: "n1", target: "unknown" }],
            },
          },
        }),
        createReply(),
      ),
    ).rejects.toThrow('Edge at index 0 references unknown target node "unknown"');
  });

  it("accepts valid definition with nodes and edges", async () => {
    const definition = {
      nodes: [
        { id: "n1", type: "input" },
        { id: "n2", type: "output" },
      ],
      edges: [{ source: "n1", target: "n2" }],
    };
    const chain = chainable({ returning: vi.fn().mockResolvedValue([{ id: "wf-ok" }]) });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const result = await handler(
      createRequest({ body: { name: "Valid", definition } }),
      createReply(),
    );
    expect(result).toEqual({ id: "wf-ok" });
  });

  it("propagates db errors on insert", async () => {
    const chain = chainable({ returning: vi.fn().mockRejectedValue(new Error("insert failed")) });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "Test", definition: validDefinition } }), createReply()),
    ).rejects.toThrow("insert failed");
  });
});

// ================================================================
// GET /:id — get workflow by ID
// ================================================================
describe("GET /:id (get workflow)", () => {
  it("returns workflow when found", async () => {
    const workflow = { id: "wf-1", name: "My Flow", userId: 1 };
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([workflow]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /:id"];
    const result = await handler(
      createRequest({ params: { id: "wf-1" } }),
      createReply(),
    );
    expect(result).toEqual(workflow);
  });

  it("throws 404 when workflow not found", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /:id"];
    await expect(
      handler(createRequest({ params: { id: "missing" } }), createReply()),
    ).rejects.toThrow("Workflow not found");
  });

  it("propagates db errors", async () => {
    const chain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("db error")),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /:id"];
    await expect(
      handler(createRequest({ params: { id: "wf-1" } }), createReply()),
    ).rejects.toThrow("db error");
  });
});

// ================================================================
// PUT /:id — update workflow
// ================================================================
describe("PUT /:id (update workflow)", () => {
  function setupSelectThenUpdate(
    selectResult: any[],
    updateResult: any[] = [{ id: "wf-1", name: "Updated" }],
  ) {
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue(selectResult) });
    mockDb.select = vi.fn(() => selectChain);
    const updateChain = chainable({ returning: vi.fn().mockResolvedValue(updateResult) });
    mockDb.update = vi.fn(() => updateChain);
  }

  it("updates name and returns updated workflow", async () => {
    const existing = { id: "wf-1", name: "Old", version: 1 };
    const updated = { id: "wf-1", name: "New" };
    setupSelectThenUpdate([existing], [updated]);

    const { handler } = registeredRoutes["PUT /:id"];
    const result = await handler(
      createRequest({ params: { id: "wf-1" }, body: { name: "New" } }),
      createReply(),
    );
    expect(result).toEqual(updated);
  });

  it("updates description to null when empty string provided", async () => {
    const existing = { id: "wf-1", name: "Test", version: 1 };
    setupSelectThenUpdate([existing]);
    const setFn = vi.fn(() => chainable({ returning: vi.fn().mockResolvedValue([existing]) }));
    mockDb.update = vi.fn(() => chainable({ set: setFn }));

    const { handler } = registeredRoutes["PUT /:id"];
    await handler(
      createRequest({ params: { id: "wf-1" }, body: { description: "" } }),
      createReply(),
    );

    const setData = setFn.mock.calls[0][0];
    expect(setData.description).toBeNull();
  });

  it("increments version when definition is updated", async () => {
    const existing = { id: "wf-1", name: "Test", version: 3 };
    const setFn = vi.fn(() => chainable({ returning: vi.fn().mockResolvedValue([{ ...existing, version: 4 }]) }));
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    mockDb.update = vi.fn(() => chainable({ set: setFn }));

    const newDef = {
      nodes: [{ id: "n1", type: "input" }],
      edges: [],
    };

    const { handler } = registeredRoutes["PUT /:id"];
    const result = await handler(
      createRequest({ params: { id: "wf-1" }, body: { definition: newDef } }),
      createReply(),
    );
    const setData = setFn.mock.calls[0][0];
    expect(setData.version).toBe(4);
    expect(setData.definition).toEqual(newDef);
  });

  it("throws 404 when workflow not found", async () => {
    const chain = chainable({ limit: vi.fn().mockResolvedValue([]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["PUT /:id"];
    await expect(
      handler(createRequest({ params: { id: "missing" }, body: { name: "x" } }), createReply()),
    ).rejects.toThrow("Workflow not found");
  });

  it("throws when definition nodes is not an array", async () => {
    const existing = { id: "wf-1", version: 1 };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["PUT /:id"];
    await expect(
      handler(
        createRequest({
          params: { id: "wf-1" },
          body: { definition: { nodes: "bad", edges: [] } },
        }),
        createReply(),
      ),
    ).rejects.toThrow("Definition must include nodes and edges arrays");
  });

  it("throws when definition edges is not an array", async () => {
    const existing = { id: "wf-1", version: 1 };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["PUT /:id"];
    await expect(
      handler(
        createRequest({
          params: { id: "wf-1" },
          body: { definition: { nodes: [], edges: {} } },
        }),
        createReply(),
      ),
    ).rejects.toThrow("Definition must include nodes and edges arrays");
  });

  it("validates definition when provided on update", async () => {
    const existing = { id: "wf-1", version: 1 };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["PUT /:id"];
    await expect(
      handler(
        createRequest({
          params: { id: "wf-1" },
          body: { definition: { nodes: [], edges: [] } },
        }),
        createReply(),
      ),
    ).rejects.toThrow("Workflow must contain at least one node");
  });

  it("does not update definition or version when definition is not in body", async () => {
    const existing = { id: "wf-1", name: "Old", version: 5 };
    const setFn = vi.fn(() => chainable({ returning: vi.fn().mockResolvedValue([existing]) }));
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    mockDb.update = vi.fn(() => chainable({ set: setFn }));

    const { handler } = registeredRoutes["PUT /:id"];
    await handler(
      createRequest({ params: { id: "wf-1" }, body: { name: "New Name" } }),
      createReply(),
    );

    const setData = setFn.mock.calls[0][0];
    expect(setData.definition).toBeUndefined();
    expect(setData.version).toBeUndefined();
  });

  it("propagates db errors on update", async () => {
    const existing = { id: "wf-1", version: 1 };
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    mockDb.update = vi.fn(() =>
      chainable({ returning: vi.fn().mockRejectedValue(new Error("update failed")) }),
    );

    const { handler } = registeredRoutes["PUT /:id"];
    await expect(
      handler(createRequest({ params: { id: "wf-1" }, body: { name: "x" } }), createReply()),
    ).rejects.toThrow("update failed");
  });
});

// ================================================================
// DELETE /:id — delete workflow
// ================================================================
describe("DELETE /:id (delete workflow)", () => {
  it("deletes workflow and returns success", async () => {
    const existing = { id: "wf-1" };
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    const deleteChain = chainable({ where: vi.fn().mockResolvedValue(undefined) });
    mockDb.delete = vi.fn(() => deleteChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const result = await handler(
      createRequest({ params: { id: "wf-1" } }),
      createReply(),
    );
    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("throws 404 when workflow not found", async () => {
    const chain = chainable({ limit: vi.fn().mockResolvedValue([]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["DELETE /:id"];
    await expect(
      handler(createRequest({ params: { id: "missing" } }), createReply()),
    ).rejects.toThrow("Workflow not found");
  });

  it("propagates db errors on delete", async () => {
    const existing = { id: "wf-1" };
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    mockDb.delete = vi.fn(() =>
      chainable({ where: vi.fn().mockRejectedValue(new Error("delete failed")) }),
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    await expect(
      handler(createRequest({ params: { id: "wf-1" } }), createReply()),
    ).rejects.toThrow("delete failed");
  });
});

// ================================================================
// POST /:id/publish — publish workflow
// ================================================================
describe("POST /:id/publish (publish workflow)", () => {
  it("publishes workflow and returns updated record", async () => {
    const existing = { id: "wf-1", published: false };
    const updated = { id: "wf-1", published: true };
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    const updateChain = chainable({ returning: vi.fn().mockResolvedValue([updated]) });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["POST /:id/publish"];
    const result = await handler(
      createRequest({ params: { id: "wf-1" } }),
      createReply(),
    );
    expect(result).toEqual(updated);
  });

  it("throws 404 when workflow not found", async () => {
    const chain = chainable({ limit: vi.fn().mockResolvedValue([]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /:id/publish"];
    await expect(
      handler(createRequest({ params: { id: "missing" } }), createReply()),
    ).rejects.toThrow("Workflow not found");
  });

  it("propagates db errors on update", async () => {
    const existing = { id: "wf-1" };
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    mockDb.update = vi.fn(() =>
      chainable({ returning: vi.fn().mockRejectedValue(new Error("publish failed")) }),
    );

    const { handler } = registeredRoutes["POST /:id/publish"];
    await expect(
      handler(createRequest({ params: { id: "wf-1" } }), createReply()),
    ).rejects.toThrow("publish failed");
  });
});

// ================================================================
// POST /:id/run — execute workflow
// ================================================================
describe("POST /:id/run (execute workflow)", () => {
  it("creates a run and returns 201 with run_id", async () => {
    const existing = { id: "wf-1", definition: { nodes: [], edges: [] } };
    const run = { id: "run-1", workflowId: "wf-1", status: "running" };
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    const insertChain = chainable({ returning: vi.fn().mockResolvedValue([run]) });
    mockDb.insert = vi.fn(() => insertChain);

    const { handler } = registeredRoutes["POST /:id/run"];
    const reply = createReply();
    const result = await handler(
      createRequest({ params: { id: "wf-1" }, body: { inputs: { key: "val" } } }),
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(result).toEqual({ run_id: "run-1" });
  });

  it("stores run in activeRuns map", async () => {
    const existing = { id: "wf-1", definition: { nodes: [], edges: [] } };
    const run = { id: "run-abc", workflowId: "wf-1", status: "running" };
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    const insertChain = chainable({ returning: vi.fn().mockResolvedValue([run]) });
    mockDb.insert = vi.fn(() => insertChain);

    const { handler } = registeredRoutes["POST /:id/run"];
    await handler(
      createRequest({ params: { id: "wf-1" }, body: {} }),
      createReply(),
    );

    expect(activeRuns.has("run-abc")).toBe(true);
    const entry = activeRuns.get("run-abc");
    expect(entry.events).toEqual([]);
    expect(entry.executor).toBeDefined();
  });

  it("defaults inputs to empty object when not provided", async () => {
    const existing = { id: "wf-1", definition: {} };
    const run = { id: "run-2", workflowId: "wf-1" };
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    const valuesFn = vi.fn(() => chainable({ returning: vi.fn().mockResolvedValue([run]) }));
    mockDb.insert = vi.fn(() => chainable({ values: valuesFn }));

    const { handler } = registeredRoutes["POST /:id/run"];
    await handler(
      createRequest({ params: { id: "wf-1" }, body: {} }),
      createReply(),
    );

    const insertedValues = valuesFn.mock.calls[0][0];
    expect(insertedValues.inputs).toEqual({});
  });

  it("throws 404 when workflow not found", async () => {
    const chain = chainable({ limit: vi.fn().mockResolvedValue([]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /:id/run"];
    await expect(
      handler(createRequest({ params: { id: "missing" } }), createReply()),
    ).rejects.toThrow("Workflow not found");
  });

  it("evicts oldest entry when activeRuns at max capacity", async () => {
    // Pre-fill activeRuns to capacity (500)
    for (let i = 0; i < 500; i++) {
      activeRuns.set(`old-run-${i}`, { executor: {}, events: [], createdAt: Date.now() - 10000 });
    }
    expect(activeRuns.size).toBe(500);

    const existing = { id: "wf-1", definition: {} };
    const run = { id: "new-run", workflowId: "wf-1" };
    const selectChain = chainable({ limit: vi.fn().mockResolvedValue([existing]) });
    mockDb.select = vi.fn(() => selectChain);
    const insertChain = chainable({ returning: vi.fn().mockResolvedValue([run]) });
    mockDb.insert = vi.fn(() => insertChain);

    const { handler } = registeredRoutes["POST /:id/run"];
    await handler(
      createRequest({ params: { id: "wf-1" }, body: {} }),
      createReply(),
    );

    // The oldest entry (old-run-0) should have been evicted
    expect(activeRuns.has("old-run-0")).toBe(false);
    expect(activeRuns.has("new-run")).toBe(true);
    // Size should still be 500 (evicted 1, added 1)
    expect(activeRuns.size).toBe(500);
  });
});

// ================================================================
// GET /:id/runs — list runs for workflow
// ================================================================
describe("GET /:id/runs (list runs)", () => {
  it("returns runs for workflow", async () => {
    const workflow = { id: "wf-1" };
    const runs = [
      { id: "run-1", status: "done" },
      { id: "run-2", status: "running" },
    ];

    let selectCall = 0;
    mockDb.select = vi.fn(() => {
      selectCall++;
      if (selectCall === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([workflow]) });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn().mockResolvedValue(runs),
              })
            ),
          })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id/runs"];
    const result = await handler(
      createRequest({ params: { id: "wf-1" } }),
      createReply(),
    );
    expect(result).toEqual({ runs });
  });

  it("returns empty runs array", async () => {
    const workflow = { id: "wf-1" };
    let selectCall = 0;
    mockDb.select = vi.fn(() => {
      selectCall++;
      if (selectCall === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([workflow]) });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({ orderBy: vi.fn().mockResolvedValue([]) })
            ),
          })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id/runs"];
    const result = await handler(
      createRequest({ params: { id: "wf-1" } }),
      createReply(),
    );
    expect(result).toEqual({ runs: [] });
  });

  it("throws 404 when workflow not found", async () => {
    const chain = chainable({ limit: vi.fn().mockResolvedValue([]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /:id/runs"];
    await expect(
      handler(createRequest({ params: { id: "missing" } }), createReply()),
    ).rejects.toThrow("Workflow not found");
  });
});

// ================================================================
// GET /runs/:runId — get run status
// ================================================================
describe("GET /runs/:runId (get run status)", () => {
  it("returns run when found", async () => {
    const run = { id: "run-1", status: "done", userId: 1 };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([run]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /runs/:runId"];
    const result = await handler(
      createRequest({ params: { runId: "run-1" } }),
      createReply(),
    );
    expect(result).toEqual(run);
  });

  it("throws 404 when run not found", async () => {
    const chain = chainable({ limit: vi.fn().mockResolvedValue([]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /runs/:runId"];
    await expect(
      handler(createRequest({ params: { runId: "missing" } }), createReply()),
    ).rejects.toThrow("Workflow run not found");
  });

  it("propagates db errors", async () => {
    const chain = chainable({ limit: vi.fn().mockRejectedValue(new Error("db fail")) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /runs/:runId"];
    await expect(
      handler(createRequest({ params: { runId: "run-1" } }), createReply()),
    ).rejects.toThrow("db fail");
  });
});

// ================================================================
// GET /runs/:runId/stream — SSE endpoint
// ================================================================
describe("GET /runs/:runId/stream (SSE)", () => {
  it("throws 404 when run not found", async () => {
    const chain = chainable({ limit: vi.fn().mockResolvedValue([]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /runs/:runId/stream"];
    await expect(
      handler(createRequest({ params: { runId: "missing" } }), createReply()),
    ).rejects.toThrow("Workflow run not found");
  });

  it("sends complete event and closes when run is done and not active", async () => {
    const run = { id: "run-done", status: "done", outputs: { result: 42 } };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([run]) });
    mockDb.select = vi.fn(() => chain);
    // Ensure run is NOT in activeRuns
    activeRuns.delete("run-done");

    const { handler } = registeredRoutes["GET /runs/:runId/stream"];
    const reply = createReply();
    await handler(createRequest({ params: { runId: "run-done" } }), reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ type: "workflow_complete", data: { result: 42 } })}\n\n`,
    );
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it("sends error event and closes when run is failed and not active", async () => {
    const run = { id: "run-fail", status: "failed", error: "something broke" };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([run]) });
    mockDb.select = vi.fn(() => chain);
    activeRuns.delete("run-fail");

    const { handler } = registeredRoutes["GET /runs/:runId/stream"];
    const reply = createReply();
    await handler(createRequest({ params: { runId: "run-fail" } }), reply);

    expect(reply.raw.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ type: "workflow_error", data: { message: "something broke" } })}\n\n`,
    );
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it("just closes stream when run is not active and status is neither done nor failed", async () => {
    const run = { id: "run-pending", status: "pending" };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([run]) });
    mockDb.select = vi.fn(() => chain);
    activeRuns.delete("run-pending");

    const { handler } = registeredRoutes["GET /runs/:runId/stream"];
    const reply = createReply();
    await handler(createRequest({ params: { runId: "run-pending" } }), reply);

    // Should not write any data event (only writeHead + end)
    expect(reply.raw.write).not.toHaveBeenCalled();
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it("replays existing events from active run and sets up polling", async () => {
    const run = { id: "run-active", status: "running" };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([run]) });
    mockDb.select = vi.fn(() => chain);

    const existingEvents = [
      { type: "node_start", nodeId: "n1" },
      { type: "node_complete", nodeId: "n1", output: { data: "hello" } },
    ];
    activeRuns.set("run-active", {
      executor: { run: vi.fn(), resumeGate: vi.fn() },
      events: [...existingEvents],
      createdAt: Date.now(),
    });

    const { handler } = registeredRoutes["GET /runs/:runId/stream"];
    const rawOn = vi.fn();
    const reply = createReply();
    const request = createRequest({ params: { runId: "run-active" }, raw: { on: rawOn } });
    await handler(request, reply);

    // Should have replayed 2 events
    expect(reply.raw.write).toHaveBeenCalledTimes(2);
    expect(reply.raw.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify(existingEvents[0])}\n\n`,
    );
    expect(reply.raw.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify(existingEvents[1])}\n\n`,
    );
    // Should have registered close handler
    expect(rawOn).toHaveBeenCalledWith("close", expect.any(Function));
  });
});

// ================================================================
// POST /runs/:runId/gate — resume human gate
// ================================================================
describe("POST /runs/:runId/gate (resume gate)", () => {
  it("throws 404 when run not found", async () => {
    const chain = chainable({ limit: vi.fn().mockResolvedValue([]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /runs/:runId/gate"];
    await expect(
      handler(
        createRequest({ params: { runId: "missing" }, body: { choice: "approve" } }),
        createReply(),
      ),
    ).rejects.toThrow("Workflow run not found");
  });

  it("throws when choice is missing", async () => {
    const run = { id: "run-1", status: "running" };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([run]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /runs/:runId/gate"];
    await expect(
      handler(
        createRequest({ params: { runId: "run-1" }, body: {} }),
        createReply(),
      ),
    ).rejects.toThrow("Choice is required");
  });

  it("throws when choice is empty string", async () => {
    const run = { id: "run-1", status: "running" };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([run]) });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /runs/:runId/gate"];
    await expect(
      handler(
        createRequest({ params: { runId: "run-1" }, body: { choice: "" } }),
        createReply(),
      ),
    ).rejects.toThrow("Choice is required");
  });

  it("throws when no active executor for the run", async () => {
    const run = { id: "run-1", status: "running" };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([run]) });
    mockDb.select = vi.fn(() => chain);
    activeRuns.delete("run-1");

    const { handler } = registeredRoutes["POST /runs/:runId/gate"];
    await expect(
      handler(
        createRequest({ params: { runId: "run-1" }, body: { choice: "approve", nodeId: "node-1" } }),
        createReply(),
      ),
    ).rejects.toThrow("No active executor for this run");
  });

  it("calls resumeGate on the executor and returns success", async () => {
    const run = { id: "run-gate", status: "running" };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([run]) });
    mockDb.select = vi.fn(() => chain);

    const mockExecutorResumeGate = vi.fn();
    activeRuns.set("run-gate", {
      executor: { run: vi.fn(), resumeGate: mockExecutorResumeGate },
      events: [],
      createdAt: Date.now(),
    });

    const { handler } = registeredRoutes["POST /runs/:runId/gate"];
    const result = await handler(
      createRequest({
        params: { runId: "run-gate" },
        body: { choice: "approve", nodeId: "gate-node-1" },
      }),
      createReply(),
    );

    expect(result).toEqual({ success: true });
    expect(mockExecutorResumeGate).toHaveBeenCalledWith("gate-node-1", "approve");
  });

  it("throws when nodeId is not provided", async () => {
    const run = { id: "run-gate2", status: "running" };
    const chain = chainable({ limit: vi.fn().mockResolvedValue([run]) });
    mockDb.select = vi.fn(() => chain);

    const mockExecutorResumeGate = vi.fn();
    activeRuns.set("run-gate2", {
      executor: { run: vi.fn(), resumeGate: mockExecutorResumeGate },
      events: [],
      createdAt: Date.now(),
    });

    const { handler } = registeredRoutes["POST /runs/:runId/gate"];
    await expect(
      handler(
        createRequest({
          params: { runId: "run-gate2" },
          body: { choice: "reject" },
        }),
        createReply(),
      ),
    ).rejects.toThrow("nodeId is required");
  });
});

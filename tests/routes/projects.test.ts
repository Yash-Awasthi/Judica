import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockCreateProject = vi.fn();
const mockGetProjects = vi.fn();
const mockGetProjectById = vi.fn();
const mockUpdateProject = vi.fn();
const mockDeleteProject = vi.fn();

vi.mock("../../src/services/project.service.js", () => ({
  createProject: (...args: any[]) => mockCreateProject(...args),
  getProjects: (...args: any[]) => mockGetProjects(...args),
  getProjectById: (...args: any[]) => mockGetProjectById(...args),
  updateProject: (...args: any[]) => mockUpdateProject(...args),
  deleteProject: (...args: any[]) => mockDeleteProject(...args),
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

vi.mock("@fastify/rate-limit", () => ({
  default: vi.fn(),
}));

// ---- helpers ----

const registeredRoutes: Record<string, { handler: Function; preHandler?: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      const h = handler ?? opts;
      const pre = handler ? opts?.preHandler : undefined;
      registeredRoutes[`${method.toUpperCase()} ${path}`] = { handler: h, preHandler: pre };
    });

  return {
    register: vi.fn().mockResolvedValue(undefined),
    addHook: vi.fn().mockReturnThis(),
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
}

function createRequest(overrides: any = {}): any {
  return {
    params: {},
    body: {},
    query: {},
    userId: 1,
    headers: { authorization: "Bearer token" },
    ...overrides,
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, b: any) {
      return b;
    }),
  };
  return reply;
}

// ---- import and register ----

let projectsPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  mockGetProjects.mockResolvedValue([]);
  mockGetProjectById.mockResolvedValue(null);
  mockCreateProject.mockResolvedValue({ id: "proj-1", name: "Test" });
  mockUpdateProject.mockResolvedValue(null);
  mockDeleteProject.mockResolvedValue(false);

  const mod = await import("../../src/routes/projects.js");
  projectsPlugin = mod.default;
  const fastify = createFastifyInstance();
  await projectsPlugin(fastify);
});

// ================================================================
// GET /
// ================================================================
describe("GET /", () => {
  it("returns project list", async () => {
    const projects = [
      { id: "p1", name: "Project 1", userId: 1 },
      { id: "p2", name: "Project 2", userId: 1 },
    ];
    mockGetProjects.mockResolvedValueOnce(projects);

    const { handler } = registeredRoutes["GET /"];
    const request = createRequest({ userId: 1 });
    const reply = createReply();
    const result = await handler(request, reply);
    expect(result).toEqual(projects);
    expect(mockGetProjects).toHaveBeenCalledWith(1);
  });
});

// ================================================================
// GET /:projectId
// ================================================================
describe("GET /:projectId", () => {
  it("returns 404 when not found", async () => {
    mockGetProjectById.mockResolvedValueOnce(null);

    const { handler } = registeredRoutes["GET /:projectId"];
    const request = createRequest({ params: { projectId: "missing" }, userId: 1 });
    const reply = createReply();
    await expect(handler(request, reply)).rejects.toThrow("Project not found");
  });

  it("returns project when found", async () => {
    const project = { id: "p1", name: "My Project", userId: 1 };
    mockGetProjectById.mockResolvedValueOnce(project);

    const { handler } = registeredRoutes["GET /:projectId"];
    const request = createRequest({ params: { projectId: "p1" }, userId: 1 });
    const reply = createReply();
    const result = await handler(request, reply);
    expect(result).toEqual(project);
    expect(mockGetProjectById).toHaveBeenCalledWith("p1", 1);
  });
});

// ================================================================
// POST /
// ================================================================
describe("POST /", () => {
  it("creates project with valid body", async () => {
    const created = { id: "proj-new", name: "New Project", userId: 1, createdAt: new Date() };
    mockCreateProject.mockResolvedValueOnce(created);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      userId: 1,
      body: { name: "New Project", description: "A test project" },
    });
    const reply = createReply();
    const result = await handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(mockCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, name: "New Project", description: "A test project" })
    );
  });

  it("returns 400 for missing name", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ userId: 1, body: {} });
    const reply = createReply();
    await expect(handler(request, reply)).rejects.toThrow("name is required");
  });

  it("returns 400 for empty name", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ userId: 1, body: { name: "   " } });
    const reply = createReply();
    await expect(handler(request, reply)).rejects.toThrow("name is required");
  });

  it("returns 400 for name > 200 chars", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ userId: 1, body: { name: "a".repeat(201) } });
    const reply = createReply();
    await expect(handler(request, reply)).rejects.toThrow("200");
  });
});

// ================================================================
// PUT /:projectId
// ================================================================
describe("PUT /:projectId", () => {
  it("updates project", async () => {
    const updated = { id: "p1", name: "Updated", userId: 1 };
    mockUpdateProject.mockResolvedValueOnce(updated);

    const { handler } = registeredRoutes["PUT /:projectId"];
    const request = createRequest({
      params: { projectId: "p1" },
      userId: 1,
      body: { name: "Updated" },
    });
    const reply = createReply();
    const result = await handler(request, reply);
    expect(result).toEqual(updated);
    expect(mockUpdateProject).toHaveBeenCalledWith("p1", 1, { name: "Updated" });
  });

  it("returns 404 when not found on update", async () => {
    mockUpdateProject.mockResolvedValueOnce(null);

    const { handler } = registeredRoutes["PUT /:projectId"];
    const request = createRequest({
      params: { projectId: "missing" },
      userId: 1,
      body: { name: "Updated" },
    });
    const reply = createReply();
    await expect(handler(request, reply)).rejects.toThrow("Project not found");
  });
});

// ================================================================
// DELETE /:projectId
// ================================================================
describe("DELETE /:projectId", () => {
  it("returns 404 when not found", async () => {
    mockDeleteProject.mockResolvedValueOnce(false);

    const { handler } = registeredRoutes["DELETE /:projectId"];
    const request = createRequest({ params: { projectId: "missing" }, userId: 1 });
    const reply = createReply();
    await expect(handler(request, reply)).rejects.toThrow("Project not found");
  });

  it("returns success when deleted", async () => {
    mockDeleteProject.mockResolvedValueOnce(true);

    const { handler } = registeredRoutes["DELETE /:projectId"];
    const request = createRequest({ params: { projectId: "p1" }, userId: 1 });
    const reply = createReply();
    const result = await handler(request, reply);
    expect(result).toEqual({ success: true });
    expect(mockDeleteProject).toHaveBeenCalledWith("p1", 1);
  });
});

describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["GET /:projectId"]).toBeDefined();
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["PUT /:projectId"]).toBeDefined();
    expect(registeredRoutes["DELETE /:projectId"]).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";

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

interface FakeWorkflow {
  id: string;
  userId: number;
  name: string;
  description: string | null;
  definition: { nodes: any[]; edges: any[] };
  version: number;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const fakeWorkflows: FakeWorkflow[] = [];
let workflowIdSeq = 1;

// ─── Workflow validation (mirrors actual route logic) ───────────────────────

function validateWorkflowDefinition(definition: any): { valid: boolean; error?: string; code?: string } {
  const { nodes, edges } = definition;

  if (nodes.length === 0) {
    return { valid: false, error: "Workflow must contain at least one node", code: "WORKFLOW_EMPTY" };
  }

  const nodeIds = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || typeof node !== "object") {
      return { valid: false, error: `Node at index ${i} is not a valid object`, code: "WORKFLOW_NODE_INVALID" };
    }
    if (!node.id || typeof node.id !== "string") {
      return { valid: false, error: `Node at index ${i} is missing a valid "id" string`, code: "WORKFLOW_NODE_INVALID" };
    }
    if (!node.type || typeof node.type !== "string") {
      return { valid: false, error: `Node "${node.id}" is missing a valid "type" string`, code: "WORKFLOW_NODE_INVALID" };
    }
    if (nodeIds.has(node.id)) {
      return { valid: false, error: `Duplicate node id "${node.id}"`, code: "WORKFLOW_NODE_DUPLICATE" };
    }
    nodeIds.add(node.id);
  }

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!edge || typeof edge !== "object") {
      return { valid: false, error: `Edge at index ${i} is not a valid object`, code: "WORKFLOW_EDGE_INVALID" };
    }
    if (!edge.source || typeof edge.source !== "string") {
      return { valid: false, error: `Edge at index ${i} is missing a valid "source" string`, code: "WORKFLOW_EDGE_INVALID" };
    }
    if (!edge.target || typeof edge.target !== "string") {
      return { valid: false, error: `Edge at index ${i} is missing a valid "target" string`, code: "WORKFLOW_EDGE_INVALID" };
    }
    if (!nodeIds.has(edge.source)) {
      return { valid: false, error: `Edge at index ${i} references unknown source node "${edge.source}"`, code: "WORKFLOW_EDGE_INVALID" };
    }
    if (!nodeIds.has(edge.target)) {
      return { valid: false, error: `Edge at index ${i} references unknown target node "${edge.target}"`, code: "WORKFLOW_EDGE_INVALID" };
    }
  }

  return { valid: true };
}

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

  // GET /api/workflows — list user's workflows
  app.get("/api/workflows", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const limit = Math.min(Math.max(Number((request.query as any).limit) || 20, 1), 100);
    const offset = Math.max(Number((request.query as any).offset) || 0, 0);

    const userWorkflows = fakeWorkflows.filter((w) => w.userId === request.userId);
    const total = userWorkflows.length;
    const data = userWorkflows.slice(offset, offset + limit);

    return { workflows: data, total };
  });

  // POST /api/workflows — create workflow
  app.post("/api/workflows", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { name, description, definition } = request.body as any;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      reply.code(400);
      return { error: "Name is required", code: "WORKFLOW_NAME_REQUIRED" };
    }

    if (!definition || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
      reply.code(400);
      return { error: "Definition must include nodes and edges arrays", code: "WORKFLOW_DEFINITION_INVALID" };
    }

    const validation = validateWorkflowDefinition(definition);
    if (!validation.valid) {
      reply.code(400);
      return { error: validation.error, code: validation.code };
    }

    const now = new Date();
    const workflow: FakeWorkflow = {
      id: `wf-${workflowIdSeq++}`,
      userId: request.userId,
      name: name.trim(),
      description: description?.trim() || null,
      definition,
      version: 1,
      published: false,
      createdAt: now,
      updatedAt: now,
    };
    fakeWorkflows.push(workflow);

    reply.code(201);
    return workflow;
  });

  // GET /api/workflows/:id — get workflow
  app.get("/api/workflows/:id", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { id } = request.params as { id: string };
    const workflow = fakeWorkflows.find((w) => w.id === id && w.userId === request.userId);

    if (!workflow) {
      reply.code(404);
      return { error: "Workflow not found", code: "WORKFLOW_NOT_FOUND" };
    }

    return workflow;
  });

  // PUT /api/workflows/:id — update workflow
  app.put("/api/workflows/:id", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { id } = request.params as { id: string };
    const workflow = fakeWorkflows.find((w) => w.id === id && w.userId === request.userId);

    if (!workflow) {
      reply.code(404);
      return { error: "Workflow not found", code: "WORKFLOW_NOT_FOUND" };
    }

    const { name, description, definition } = request.body as any;

    if (name !== undefined) workflow.name = name.trim();
    if (description !== undefined) workflow.description = description?.trim() || null;
    if (definition !== undefined) {
      if (!Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
        reply.code(400);
        return { error: "Definition must include nodes and edges arrays", code: "WORKFLOW_DEFINITION_INVALID" };
      }
      const validation = validateWorkflowDefinition(definition);
      if (!validation.valid) {
        reply.code(400);
        return { error: validation.error, code: validation.code };
      }
      workflow.definition = definition;
      workflow.version += 1;
    }

    workflow.updatedAt = new Date();
    return workflow;
  });

  // DELETE /api/workflows/:id — delete workflow
  app.delete("/api/workflows/:id", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { id } = request.params as { id: string };
    const idx = fakeWorkflows.findIndex((w) => w.id === id && w.userId === request.userId);

    if (idx === -1) {
      reply.code(404);
      return { error: "Workflow not found", code: "WORKFLOW_NOT_FOUND" };
    }

    fakeWorkflows.splice(idx, 1);
    return { success: true };
  });

  await app.ready();
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Workflows Routes — /api/workflows", () => {
  let app: FastifyInstance;
  const validToken = generateToken(1, "testuser");

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fakeWorkflows.length = 0;
    workflowIdSeq = 1;
  });

  // ── Valid workflow definition for reuse ──────────────────────────────────

  const validDefinition = {
    nodes: [
      { id: "node-1", type: "prompt", config: { prompt: "Hello" } },
      { id: "node-2", type: "output", config: {} },
    ],
    edges: [{ source: "node-1", target: "node-2" }],
  };

  // ── Auth enforcement ────────────────────────────────────────────────────

  describe("Authentication", () => {
    it("should require auth for listing workflows", async () => {
      const res = await app.inject({ method: "GET", url: "/api/workflows" });
      expect(res.statusCode).toBe(401);
    });

    it("should require auth for creating workflows", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workflows",
        payload: { name: "Test", definition: validDefinition },
      });
      expect(res.statusCode).toBe(401);
    });

    it("should require auth for getting a workflow", async () => {
      const res = await app.inject({ method: "GET", url: "/api/workflows/wf-1" });
      expect(res.statusCode).toBe(401);
    });

    it("should require auth for updating a workflow", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/workflows/wf-1",
        payload: { name: "Updated" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("should require auth for deleting a workflow", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/workflows/wf-1" });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── Workflow validation ─────────────────────────────────────────────────

  describe("Workflow definition validation", () => {
    it("should reject workflow with no nodes", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          name: "Empty Workflow",
          definition: { nodes: [], edges: [] },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("WORKFLOW_EMPTY");
    });

    it("should reject workflow with missing node id", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          name: "Bad Node",
          definition: {
            nodes: [{ type: "prompt" }], // missing id
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("WORKFLOW_NODE_INVALID");
    });

    it("should reject workflow with missing node type", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          name: "No Type",
          definition: {
            nodes: [{ id: "node-1" }], // missing type
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("WORKFLOW_NODE_INVALID");
    });

    it("should reject workflow with duplicate node ids", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          name: "Duplicate Nodes",
          definition: {
            nodes: [
              { id: "node-1", type: "prompt" },
              { id: "node-1", type: "output" }, // duplicate
            ],
            edges: [],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("WORKFLOW_NODE_DUPLICATE");
    });

    it("should reject workflow with edge referencing unknown source", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          name: "Bad Edge Source",
          definition: {
            nodes: [{ id: "node-1", type: "prompt" }],
            edges: [{ source: "nonexistent", target: "node-1" }],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("WORKFLOW_EDGE_INVALID");
    });

    it("should reject workflow with edge referencing unknown target", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          name: "Bad Edge Target",
          definition: {
            nodes: [{ id: "node-1", type: "prompt" }],
            edges: [{ source: "node-1", target: "nonexistent" }],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("WORKFLOW_EDGE_INVALID");
    });

    it("should reject workflow with missing name", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          name: "",
          definition: validDefinition,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("WORKFLOW_NAME_REQUIRED");
    });

    it("should reject workflow with missing definition", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { name: "No Definition" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("WORKFLOW_DEFINITION_INVALID");
    });

    it("should accept valid workflow definition", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          name: "Valid Workflow",
          description: "A test workflow",
          definition: validDefinition,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe("Valid Workflow");
      expect(body.description).toBe("A test workflow");
      expect(body.version).toBe(1);
      expect(body.published).toBe(false);
    });
  });

  // ── CRUD operations ─────────────────────────────────────────────────────

  describe("CRUD operations", () => {
    it("should list workflows for the authenticated user", async () => {
      // Create a workflow
      await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { name: "WF 1", definition: validDefinition },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.workflows).toHaveLength(1);
      expect(body.total).toBe(1);
    });

    it("should get a specific workflow by id", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { name: "Get Me", definition: validDefinition },
      });
      const { id } = createRes.json();

      const res = await app.inject({
        method: "GET",
        url: `/api/workflows/${id}`,
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe("Get Me");
    });

    it("should return 404 for non-existent workflow", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/workflows/nonexistent",
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it("should update a workflow", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { name: "Original", definition: validDefinition },
      });
      const { id } = createRes.json();

      const res = await app.inject({
        method: "PUT",
        url: `/api/workflows/${id}`,
        headers: { authorization: `Bearer ${validToken}` },
        payload: { name: "Updated Name" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe("Updated Name");
    });

    it("should increment version when definition is updated", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { name: "Versioned", definition: validDefinition },
      });
      const { id } = createRes.json();
      expect(createRes.json().version).toBe(1);

      const updatedDef = {
        nodes: [
          { id: "n1", type: "prompt" },
          { id: "n2", type: "output" },
          { id: "n3", type: "filter" },
        ],
        edges: [
          { source: "n1", target: "n2" },
          { source: "n2", target: "n3" },
        ],
      };

      const res = await app.inject({
        method: "PUT",
        url: `/api/workflows/${id}`,
        headers: { authorization: `Bearer ${validToken}` },
        payload: { definition: updatedDef },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().version).toBe(2);
    });

    it("should delete a workflow", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { name: "To Delete", definition: validDefinition },
      });
      const { id } = createRes.json();

      const res = await app.inject({
        method: "DELETE",
        url: `/api/workflows/${id}`,
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      // Verify it's gone
      const getRes = await app.inject({
        method: "GET",
        url: `/api/workflows/${id}`,
        headers: { authorization: `Bearer ${validToken}` },
      });
      expect(getRes.statusCode).toBe(404);
    });

    it("should return 404 when deleting non-existent workflow", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/workflows/nonexistent",
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it("should not allow access to another user's workflow", async () => {
      // Create workflow as user 1
      const createRes = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { name: "User 1 WF", definition: validDefinition },
      });
      const { id } = createRes.json();

      // Try to access as user 2
      const user2Token = generateToken(2, "otheruser");
      const res = await app.inject({
        method: "GET",
        url: `/api/workflows/${id}`,
        headers: { authorization: `Bearer ${user2Token}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── Edge cases for update validation ────────────────────────────────────

  describe("Update validation", () => {
    it("should reject invalid definition on update", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/workflows",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { name: "Update Test", definition: validDefinition },
      });
      const { id } = createRes.json();

      const res = await app.inject({
        method: "PUT",
        url: `/api/workflows/${id}`,
        headers: { authorization: `Bearer ${validToken}` },
        payload: {
          definition: { nodes: [], edges: [] },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("WORKFLOW_EMPTY");
    });
  });
});

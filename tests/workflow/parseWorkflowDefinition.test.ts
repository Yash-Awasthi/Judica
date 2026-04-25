import { describe, it, expect } from "vitest";
import { parseWorkflowDefinition } from "../../src/workflow/types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function node(id: string) {
  return {
    id,
    type: "llm",
    label: `Node ${id}`,
    position: { x: 0, y: 0 },
    data: { type: "llm" },
  };
}

function edge(source: string, target: string) {
  return { id: `${source}->${target}`, source, target };
}

function minimal(nodeIds: string[], edges = [] as ReturnType<typeof edge>[]) {
  return {
    nodes: nodeIds.map(node),
    edges,
    inputs: [],
    outputs: [],
  };
}

// ── parseWorkflowDefinition ───────────────────────────────────────────────────

describe("parseWorkflowDefinition", () => {
  // ── valid inputs ────────────────────────────────────────────────────────────

  it("accepts a single-node workflow with no edges", () => {
    const result = parseWorkflowDefinition(minimal(["n1"]));
    expect(result.nodes[0].id).toBe("n1");
  });

  it("accepts a valid linear chain A→B→C", () => {
    expect(() =>
      parseWorkflowDefinition(minimal(["A", "B", "C"], [edge("A", "B"), edge("B", "C")]))
    ).not.toThrow();
  });

  it("accepts a DAG with diamond shape A→B, A→C, B→D, C→D", () => {
    const def = minimal(
      ["A", "B", "C", "D"],
      [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")]
    );
    expect(() => parseWorkflowDefinition(def)).not.toThrow();
  });

  it("accepts a workflow with isolated nodes (no edges)", () => {
    expect(() => parseWorkflowDefinition(minimal(["X", "Y", "Z"]))).not.toThrow();
  });

  it("returns the parsed WorkflowDefinition object", () => {
    const raw = minimal(["n1", "n2"], [edge("n1", "n2")]);
    const result = parseWorkflowDefinition(raw);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it("accepts optional version field", () => {
    const raw = { ...minimal(["n1"]), version: 1 };
    const result = parseWorkflowDefinition(raw);
    expect(result.version).toBe(1);
  });

  // ── Zod validation errors ───────────────────────────────────────────────────

  it("throws for null input", () => {
    expect(() => parseWorkflowDefinition(null)).toThrow("Invalid workflow definition");
  });

  it("throws for non-object input", () => {
    expect(() => parseWorkflowDefinition("string")).toThrow("Invalid workflow definition");
    expect(() => parseWorkflowDefinition(42)).toThrow("Invalid workflow definition");
  });

  it("throws for missing nodes field", () => {
    expect(() => parseWorkflowDefinition({ edges: [] })).toThrow("Invalid workflow definition");
  });

  it("throws when nodes array is empty", () => {
    expect(() => parseWorkflowDefinition({ nodes: [], edges: [] })).toThrow(
      "Invalid workflow definition"
    );
  });

  it("throws when nodes exceeds 500 limit", () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => node(`n${i}`));
    expect(() =>
      parseWorkflowDefinition({ nodes: tooMany, edges: [], inputs: [], outputs: [] })
    ).toThrow("Invalid workflow definition");
  });

  it("throws when edges exceed 2000 limit", () => {
    const manyEdges = Array.from({ length: 2001 }, (_, i) => ({
      id: `e${i}`,
      source: "n1",
      target: "n1",
    }));
    expect(() =>
      parseWorkflowDefinition({ nodes: [node("n1")], edges: manyEdges, inputs: [], outputs: [] })
    ).toThrow("Invalid workflow definition");
  });

  // ── cycle detection ─────────────────────────────────────────────────────────

  it("throws for a direct self-loop A→A", () => {
    const raw = minimal(["A"], [edge("A", "A")]);
    expect(() => parseWorkflowDefinition(raw)).toThrow("cycle detected");
  });

  it("throws for a two-node cycle A→B→A", () => {
    const raw = minimal(["A", "B"], [edge("A", "B"), edge("B", "A")]);
    expect(() => parseWorkflowDefinition(raw)).toThrow("cycle detected");
  });

  it("throws for a longer cycle A→B→C→A", () => {
    const raw = minimal(
      ["A", "B", "C"],
      [edge("A", "B"), edge("B", "C"), edge("C", "A")]
    );
    expect(() => parseWorkflowDefinition(raw)).toThrow("cycle detected");
  });

  it("throws for a cycle in a larger graph with a valid sub-DAG", () => {
    // X→Y is fine, but A→B→C→A is a cycle
    const raw = {
      nodes: ["A", "B", "C", "X", "Y"].map(node),
      edges: [
        edge("A", "B"),
        edge("B", "C"),
        edge("C", "A"),
        edge("X", "Y"),
      ],
      inputs: [],
      outputs: [],
    };
    expect(() => parseWorkflowDefinition(raw)).toThrow("cycle detected");
  });

  it("detects an indirect cycle with cross-edges", () => {
    // A→B, A→C, B→D, C→D, D→A  — D points back to A
    const raw = minimal(
      ["A", "B", "C", "D"],
      [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D"), edge("D", "A")]
    );
    expect(() => parseWorkflowDefinition(raw)).toThrow("cycle detected");
  });

  it("does NOT throw for a diamond + extra branch (still a DAG)", () => {
    // A→B, A→C, B→D, C→D, D→E — all DAG
    const raw = minimal(
      ["A", "B", "C", "D", "E"],
      [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D"), edge("D", "E")]
    );
    expect(() => parseWorkflowDefinition(raw)).not.toThrow();
  });
});

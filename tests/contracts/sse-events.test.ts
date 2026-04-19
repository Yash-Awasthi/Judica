import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * SSE Contract Tests
 *
 * Validates the shape of every SSE event emitted during deliberation.
 * These schemas are the "contract" — if the backend changes an event shape
 * without updating these schemas, these tests will fail.
 */

// ── Deliberation SSE Event Schemas ──

const StatusEvent = z.object({
  type: z.literal("status"),
  round: z.number().int().positive(),
  message: z.string().min(1),
});

const MemberChunkEvent = z.object({
  type: z.literal("member_chunk"),
  name: z.string().min(1),
  chunk: z.string(),
});

const OpinionEvent = z.object({
  type: z.literal("opinion"),
  name: z.string().min(1),
  text: z.string().min(1),
  round: z.number().int().positive(),
});

const PeerReviewItem = z.object({
  reviewer: z.string(),
  target: z.string(),
  score: z.number().min(0).max(10),
  feedback: z.string(),
});

const PeerReviewEvent = z.object({
  type: z.literal("peer_review"),
  round: z.number().int().positive(),
  reviews: z.array(PeerReviewItem),
});

const ScoredOpinionItem = z.object({
  name: z.string(),
  score: z.number(),
  opinion: z.string(),
});

const ScoredEvent = z.object({
  type: z.literal("scored"),
  round: z.number().int().positive(),
  scored: z.array(ScoredOpinionItem),
});

const ValidatorResultEvent = z.object({
  type: z.literal("validator_result"),
  result: z.object({
    valid: z.boolean(),
    issues: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  }),
});

const MetricsEvent = z.object({
  type: z.literal("metrics"),
  metrics: z.object({
    totalTokens: z.number().int().nonnegative(),
    totalCost: z.number().nonnegative(),
    hallucinationCount: z.number().int().nonnegative(),
    consensusScore: z.number().min(0).max(1),
  }),
});

const DoneEvent = z.object({
  type: z.literal("done"),
  verdict: z.string().min(1),
  opinions: z.array(z.object({
    name: z.string().min(1),
    opinion: z.string().min(1),
  })),
  metrics: z.object({
    totalTokens: z.number().int().nonnegative(),
    totalCost: z.number().nonnegative(),
    hallucinationCount: z.number().int().nonnegative(),
  }).optional(),
});

const ErrorEvent = z.object({
  type: z.literal("error"),
  message: z.string().min(1),
});

const DeliberationEvent = z.union([
  StatusEvent,
  MemberChunkEvent,
  OpinionEvent,
  PeerReviewEvent,
  ScoredEvent,
  ValidatorResultEvent,
  MetricsEvent,
  DoneEvent,
  ErrorEvent,
]);

// ── Workflow SSE Event Schemas ──

const WorkflowNodeStart = z.object({
  type: z.literal("node_start"),
  nodeId: z.string(),
  nodeName: z.string(),
});

const WorkflowNodeComplete = z.object({
  type: z.literal("node_complete"),
  nodeId: z.string(),
  output: z.any(),
});

const WorkflowNodeError = z.object({
  type: z.literal("node_error"),
  nodeId: z.string(),
  error: z.string(),
});

const WorkflowComplete = z.object({
  type: z.literal("workflow_complete"),
  outputs: z.record(z.string(), z.any()),
});

const WorkflowError = z.object({
  type: z.literal("workflow_error"),
  error: z.string(),
});

const WorkflowEvent = z.union([
  WorkflowNodeStart,
  WorkflowNodeComplete,
  WorkflowNodeError,
  WorkflowComplete,
  WorkflowError,
]);

// ── SSE Wire Format Parser ──

function parseSSELines(raw: string): unknown[] {
  return raw
    .split("\n\n")
    .filter(Boolean)
    .map(block => {
      const dataLine = block.split("\n").find(l => l.startsWith("data: "));
      if (!dataLine) return null;
      return JSON.parse(dataLine.slice(6));
    })
    .filter(Boolean);
}

// ── Tests ──

describe("SSE Contract: Deliberation Events", () => {
  it("validates a status event", () => {
    const event = { type: "status", round: 1, message: "R1 - Initial Responses: Gathering agent responses..." };
    expect(StatusEvent.parse(event)).toEqual(event);
  });

  it("validates a member_chunk event", () => {
    const event = { type: "member_chunk", name: "analyst", chunk: "The key finding is" };
    expect(MemberChunkEvent.parse(event)).toEqual(event);
  });

  it("validates an opinion event", () => {
    const event = { type: "opinion", name: "analyst", text: '{"analysis": "..."}', round: 1 };
    expect(OpinionEvent.parse(event)).toEqual(event);
  });

  it("validates a peer_review event", () => {
    const event = {
      type: "peer_review",
      round: 1,
      reviews: [
        { reviewer: "critic", target: "analyst", score: 7.5, feedback: "Solid analysis but missing edge cases" },
        { reviewer: "analyst", target: "critic", score: 8, feedback: "Good counterpoints" },
      ],
    };
    expect(PeerReviewEvent.parse(event)).toEqual(event);
  });

  it("validates a scored event", () => {
    const event = {
      type: "scored",
      round: 1,
      scored: [
        { name: "analyst", score: 8.2, opinion: "The data suggests..." },
        { name: "critic", score: 7.1, opinion: "While valid, we should consider..." },
      ],
    };
    expect(ScoredEvent.parse(event)).toEqual(event);
  });

  it("validates a validator_result event", () => {
    const event = {
      type: "validator_result",
      result: { valid: true, issues: [], confidence: 0.92 },
    };
    expect(ValidatorResultEvent.parse(event)).toEqual(event);
  });

  it("validates a metrics event", () => {
    const event = {
      type: "metrics",
      metrics: { totalTokens: 5234, totalCost: 0.12, hallucinationCount: 0, consensusScore: 0.87 },
    };
    expect(MetricsEvent.parse(event)).toEqual(event);
  });

  it("validates a done event with metrics", () => {
    const event = {
      type: "done",
      verdict: "Based on the analysis, the recommended approach is...",
      opinions: [
        { name: "analyst", opinion: "The data supports..." },
        { name: "critic", opinion: "After considering alternatives..." },
      ],
      metrics: { totalTokens: 10234, totalCost: 0.24, hallucinationCount: 1 },
    };
    expect(DoneEvent.parse(event)).toEqual(event);
  });

  it("validates a done event without metrics", () => {
    const event = {
      type: "done",
      verdict: "Consensus reached.",
      opinions: [{ name: "analyst", opinion: "Agreed." }],
    };
    expect(DoneEvent.parse(event)).toEqual(event);
  });

  it("validates an error event", () => {
    const event = { type: "error", message: "Provider timeout after 30s" };
    expect(ErrorEvent.parse(event)).toEqual(event);
  });

  it("rejects events with missing required fields", () => {
    expect(() => StatusEvent.parse({ type: "status", round: 1 })).toThrow();
    expect(() => OpinionEvent.parse({ type: "opinion", name: "a" })).toThrow();
    expect(() => DoneEvent.parse({ type: "done" })).toThrow();
  });

  it("rejects events with wrong types", () => {
    expect(() => StatusEvent.parse({ type: "status", round: "one", message: "hi" })).toThrow();
    expect(() => MetricsEvent.parse({ type: "metrics", metrics: { totalTokens: "many" } })).toThrow();
  });

  it("validates a complete deliberation sequence via discriminated union", () => {
    const sequence = [
      { type: "status", round: 1, message: "R1 - Initial Responses" },
      { type: "member_chunk", name: "analyst", chunk: "Looking at" },
      { type: "member_chunk", name: "analyst", chunk: " the data..." },
      { type: "opinion", name: "analyst", text: "Full opinion text", round: 1 },
      { type: "peer_review", round: 1, reviews: [{ reviewer: "critic", target: "analyst", score: 8, feedback: "Good" }] },
      { type: "scored", round: 1, scored: [{ name: "analyst", score: 8.5, opinion: "..." }] },
      { type: "validator_result", result: { valid: true, issues: [], confidence: 0.9 } },
      { type: "metrics", metrics: { totalTokens: 3000, totalCost: 0.05, hallucinationCount: 0, consensusScore: 0.91 } },
      { type: "done", verdict: "Final answer", opinions: [{ name: "analyst", opinion: "..." }] },
    ];

    for (const event of sequence) {
      expect(() => DeliberationEvent.parse(event)).not.toThrow();
    }
  });
});

describe("SSE Contract: Workflow Events", () => {
  it("validates node_start", () => {
    expect(WorkflowNodeStart.parse({ type: "node_start", nodeId: "n1", nodeName: "LLM Call" })).toBeTruthy();
  });

  it("validates node_complete", () => {
    expect(WorkflowNodeComplete.parse({ type: "node_complete", nodeId: "n1", output: { text: "result" } })).toBeTruthy();
  });

  it("validates node_error", () => {
    expect(WorkflowNodeError.parse({ type: "node_error", nodeId: "n1", error: "timeout" })).toBeTruthy();
  });

  it("validates workflow_complete", () => {
    expect(WorkflowComplete.parse({ type: "workflow_complete", outputs: { final: "done" } })).toBeTruthy();
  });

  it("validates workflow_error", () => {
    expect(WorkflowError.parse({ type: "workflow_error", error: "Node n3 failed" })).toBeTruthy();
  });

  it("validates a workflow event sequence via discriminated union", () => {
    const sequence = [
      { type: "node_start", nodeId: "n1", nodeName: "Extract" },
      { type: "node_complete", nodeId: "n1", output: { text: "extracted" } },
      { type: "node_start", nodeId: "n2", nodeName: "Analyze" },
      { type: "node_complete", nodeId: "n2", output: { score: 0.8 } },
      { type: "workflow_complete", outputs: { n1: { text: "extracted" }, n2: { score: 0.8 } } },
    ];

    for (const event of sequence) {
      expect(() => WorkflowEvent.parse(event)).not.toThrow();
    }
  });
});

describe("SSE Wire Format", () => {
  it("parses SSE data lines correctly", () => {
    const raw = [
      'data: {"type":"status","round":1,"message":"Starting"}',
      "",
      'data: {"type":"member_chunk","name":"analyst","chunk":"hello"}',
      "",
      'data: {"type":"done","verdict":"result","opinions":[{"name":"analyst","opinion":"yes"}]}',
      "",
    ].join("\n");

    const events = parseSSELines(raw);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "status", round: 1, message: "Starting" });
    expect(events[2]).toEqual({ type: "done", verdict: "result", opinions: [{ name: "analyst", opinion: "yes" }] });

    // All should validate
    for (const event of events) {
      expect(() => DeliberationEvent.parse(event)).not.toThrow();
    }
  });

  it("ignores non-data lines (comments, event names)", () => {
    const raw = [
      ": keep-alive",
      "",
      "event: deliberation",
      'data: {"type":"status","round":1,"message":"hi"}',
      "",
    ].join("\n");

    const events = parseSSELines(raw);
    expect(events).toHaveLength(1);
  });
});

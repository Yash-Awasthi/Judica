import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import {
  createStream,
  emitArtifact,
  completeStream,
  subscribe,
  waitForCompletion,
  getArtifacts,
  getStream,
  listStreams,
  formatAsSSE,
  cleanupStreams,
} from "../../src/services/artifactStreaming.service.js";

describe("artifactStreaming.service", () => {
  it("creates a stream and emits artifacts", async () => {
    const streamId = createStream(1, "Test Stream");
    expect(streamId).toMatch(/^stream_/);

    const a1 = await emitArtifact(streamId, "text", "Step 1 result", "Hello world");
    expect(a1).not.toBeNull();
    expect(a1!.sequence).toBe(0);
    expect(a1!.type).toBe("text");

    const a2 = await emitArtifact(streamId, "code", "Generated code", "console.log('hi')");
    expect(a2!.sequence).toBe(1);

    const artifacts = getArtifacts(streamId);
    expect(artifacts).toHaveLength(2);
  });

  it("completes a stream and prevents further artifacts", async () => {
    const streamId = createStream(1, "Complete Test");
    await emitArtifact(streamId, "text", "Result", "data");

    const completed = await completeStream(streamId, "All done");
    expect(completed).toBe(true);

    const stream = getStream(streamId);
    expect(stream?.isComplete).toBe(true);

    // Cannot emit after completion
    const blocked = await emitArtifact(streamId, "text", "Late", "should fail");
    expect(blocked).toBeNull();
  });

  it("subscribers receive artifacts in real-time", async () => {
    const streamId = createStream(1, "Sub Test");
    const received: string[] = [];

    subscribe(streamId, (a) => received.push(a.label));

    await emitArtifact(streamId, "text", "First", "data");
    await emitArtifact(streamId, "code", "Second", "data");

    expect(received).toEqual(["First", "Second"]);
    await completeStream(streamId);
  });

  it("replay sends existing artifacts to new subscribers", async () => {
    const streamId = createStream(1, "Replay Test");
    await emitArtifact(streamId, "text", "Before", "data");
    await emitArtifact(streamId, "code", "Also Before", "data");

    const received: string[] = [];
    subscribe(streamId, (a) => received.push(a.label), { replay: true });

    expect(received).toContain("Before");
    expect(received).toContain("Also Before");
    await completeStream(streamId);
  });

  it("unsubscribe stops receiving artifacts", async () => {
    const streamId = createStream(1, "Unsub Test");
    const received: string[] = [];

    const sub = subscribe(streamId, (a) => received.push(a.label));
    await emitArtifact(streamId, "text", "Got this", "data");

    sub!.unsubscribe();
    await emitArtifact(streamId, "text", "Not this", "data");

    expect(received).toEqual(["Got this"]);
    await completeStream(streamId);
  });

  it("waitForCompletion resolves when stream completes", async () => {
    const streamId = createStream(1, "Wait Test");

    setTimeout(() => completeStream(streamId), 50);

    const completed = await waitForCompletion(streamId, 5_000);
    expect(completed).toBe(true);
  });

  it("waitForCompletion resolves immediately for completed streams", async () => {
    const streamId = createStream(1, "Already Done");
    await completeStream(streamId);

    const completed = await waitForCompletion(streamId);
    expect(completed).toBe(true);
  });

  it("lists streams for a user", async () => {
    const id1 = createStream(42, "Stream A");
    const id2 = createStream(42, "Stream B");
    createStream(43, "Other user");

    const list = listStreams(42);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((s) => s.userId === 42)).toBe(true);

    await completeStream(id1);
    await completeStream(id2);
  });

  it("formats artifact as SSE event string", async () => {
    const streamId = createStream(1, "SSE Test");
    const artifact = (await emitArtifact(streamId, "json", "API response", { status: "ok" }))!;

    const sse = formatAsSSE(artifact);
    expect(sse).toContain("event: artifact");
    expect(sse).toContain('"type":"json"');
    expect(sse).toContain('"label":"API response"');
    expect(sse).toContain("\n\n");

    await completeStream(streamId);
  });

  it("supports metadata on artifacts", async () => {
    const streamId = createStream(1, "Meta Test");
    const artifact = await emitArtifact(
      streamId, "chart", "Sales Chart",
      { type: "bar", data: [1, 2, 3] },
      { format: "vega-lite", width: 800 },
    );

    expect(artifact!.metadata).toEqual({ format: "vega-lite", width: 800 });
    await completeStream(streamId);
  });

  it("returns null for nonexistent stream operations", async () => {
    expect(await emitArtifact("fake", "text", "x", "y")).toBeNull();
    expect(subscribe("fake", () => {})).toBeNull();
    expect(getStream("fake")).toBeUndefined();
    expect(getArtifacts("fake")).toEqual([]);
  });

  it("cleans up old streams", () => {
    const removed = cleanupStreams(0);
    expect(typeof removed).toBe("number");
  });
});

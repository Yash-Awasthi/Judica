import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentMessageBus } from "../../src/agents/messageBus.js";

describe("Agent Message Bus", () => {
  let bus: AgentMessageBus;

  beforeEach(() => {
    bus = new AgentMessageBus();
  });

  it("should register and deregister agents", () => {
    bus.registerAgent("a1", "Agent 1");
    expect(bus.getAgents()).toHaveLength(1);
    expect(bus.getAgents()[0].name).toBe("Agent 1");

    bus.unregisterAgent("a1");
    expect(bus.getAgents()).toHaveLength(0);
  });

  it("should set agent status", () => {
    bus.registerAgent("a1", "Agent 1");
    bus.setAgentStatus("a1", "thinking");
    expect(bus.getAgents()[0].status).toBe("thinking");
    
    // Non-existent agent
    bus.setAgentStatus("missing", "responding"); // should not crash
  });

  it("should handle direct messages and subscriptions", () => {
    bus.registerAgent("a1", "Agent 1");
    bus.registerAgent("a2", "Agent 2");
    
    const handler = vi.fn();
    bus.subscribe("a2", handler);

    const msg = bus.sendMessage("a1", "a2", "Hello", "question");
    
    expect(msg.from).toBe("a1");
    expect(msg.to).toBe("a2");
    expect(msg.content).toBe("Hello");
    expect(bus.getInbox("a2")).toHaveLength(1);
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it("should handle broadcast messages", () => {
    bus.registerAgent("a1", "Agent 1");
    bus.registerAgent("a2", "Agent 2");
    bus.registerAgent("a3", "Agent 3");

    const messages = bus.broadcastMessage("a1", "Everyone listen", "fact");
    
    expect(messages).toHaveLength(2);
    expect(bus.getInbox("a2")).toHaveLength(1);
    expect(bus.getInbox("a3")).toHaveLength(1);
    expect(bus.getInbox("a1")).toHaveLength(0); // Sender should not get own message
  });

  it("should get all messages and clear inbox", () => {
    bus.registerAgent("a1", "Agent 1");
    bus.sendMessage("a1", "a1", "self talk", "fact");
    
    expect(bus.getAllMessages()).toHaveLength(1);
    bus.clearInbox("a1");
    expect(bus.getInbox("a1")).toHaveLength(0);
    expect(bus.getAllMessages()).toHaveLength(1); // All messages still there
  });

  it("should reset entire state", () => {
    bus.registerAgent("a1", "Agent 1");
    bus.sendMessage("a1", "a1", "msg", "fact");
    bus.reset();
    
    expect(bus.getAgents()).toHaveLength(0);
    expect(bus.getAllMessages()).toHaveLength(0);
    expect(bus.getInbox("a1")).toHaveLength(0);
  });
});

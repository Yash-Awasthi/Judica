import { randomUUID } from "crypto";
import logger from "../lib/logger.js";

// P8-26: Maximum messages to retain per deliberation session
const MAX_MESSAGES = 500;

export interface Message {
  id: string;
  from: string;
  to: string; // agentId or 'all'
  content: string;
  type: "critique" | "question" | "answer" | "fact" | "rebuttal" | "concession";
  timestamp: Date;
}

export interface AgentState {
  id: string;
  name: string;
  status: "idle" | "thinking" | "responding" | "debating";
}

export class AgentMessageBus {
  private agents = new Map<string, AgentState>();
  private inboxes = new Map<string, Message[]>();
  private subscribers = new Map<string, ((msg: Message) => void)[]>();
  private allMessages: Message[] = [];

  registerAgent(id: string, name: string): void {
    this.agents.set(id, { id, name, status: "idle" });
    this.inboxes.set(id, []);
  }

  unregisterAgent(id: string): void {
    this.agents.delete(id);
    this.inboxes.delete(id);
    this.subscribers.delete(id);
  }

  setAgentStatus(id: string, status: AgentState["status"]): void {
    const agent = this.agents.get(id);
    if (agent) agent.status = status;
  }

  sendMessage(from: string, to: string, content: string, type: Message["type"]): Message {
    const msg: Message = {
      id: randomUUID(),
      from,
      to,
      content,
      type,
      timestamp: new Date(),
    };

    // P8-28: Warn on messages to unknown agents
    if (to !== "all" && !this.agents.has(to)) {
      logger.warn({ from, to, type }, "Message sent to unknown agent — dropped");
      return msg;
    }

    // Deliver to inbox
    const inbox = this.inboxes.get(to);
    if (inbox) inbox.push(msg);

    // P8-27: Snapshot subscriber list before iterating to prevent iterator invalidation
    const subs = [...(this.subscribers.get(to) || [])];
    for (const handler of subs) handler(msg);

    // P8-26: Cap allMessages to prevent unbounded memory growth
    if (this.allMessages.length >= MAX_MESSAGES) {
      this.allMessages.shift(); // drop oldest
    }
    this.allMessages.push(msg);
    return msg;
  }

  broadcastMessage(from: string, content: string, type: Message["type"]): Message[] {
    const messages: Message[] = [];
    for (const agentId of this.agents.keys()) {
      if (agentId !== from) {
        messages.push(this.sendMessage(from, agentId, content, type));
      }
    }
    return messages;
  }

  subscribe(agentId: string, handler: (msg: Message) => void): void {
    const subs = this.subscribers.get(agentId) || [];
    subs.push(handler);
    this.subscribers.set(agentId, subs);
  }

  getInbox(agentId: string): Message[] {
    return this.inboxes.get(agentId) || [];
  }

  clearInbox(agentId: string): void {
    this.inboxes.set(agentId, []);
  }

  getAllMessages(): Message[] {
    return this.allMessages;
  }

  getAgents(): AgentState[] {
    return Array.from(this.agents.values());
  }

  reset(): void {
    this.agents.clear();
    this.inboxes.clear();
    this.subscribers.clear();
    this.allMessages = [];
  }
}

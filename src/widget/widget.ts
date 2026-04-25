/**
 * AibyaiWidget — Shadow-DOM-isolated embeddable chat web component.
 *
 * Modeled after Onyx's widget/ Lit web component with SSE streaming,
 * session persistence, and floating/inline display modes.
 */

import type {
  WidgetConfig,
  WidgetMessage,
  WidgetSource,
  StreamPacket,
  WidgetTheme,
} from "./models.js";
import { DEFAULT_WIDGET_CONFIG, DEFAULT_THEME } from "./models.js";
import { generateWidgetStyles } from "./styles.js";

const SESSION_STORAGE_KEY = "aibyai-widget-session";

export class AibyaiWidget extends HTMLElement {
  private shadow: ShadowRoot;
  private config: WidgetConfig;
  private theme: WidgetTheme;
  private messages: WidgetMessage[] = [];
  private isOpen = false;
  private isStreaming = false;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;

  // DOM refs
  private container: HTMLElement | null = null;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private launcher: HTMLButtonElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    this.config = { ...DEFAULT_WIDGET_CONFIG };
    this.theme = { ...DEFAULT_THEME };
  }

  static get observedAttributes(): string[] {
    return [
      "api-base-url",
      "api-key",
      "mode",
      "title",
      "placeholder",
      "primary-color",
      "position",
      "greeting",
      "show-sources",
      "persist-session",
      "default-kb-id",
    ];
  }

  connectedCallback(): void {
    this.parseAttributes();
    this.theme = { ...DEFAULT_THEME, primaryColor: this.config.primaryColor };
    this.render();
    this.bindEvents();

    if (this.config.persistSession) {
      this.restoreSession();
    }

    if (this.config.greeting && this.messages.length === 0) {
      this.addMessage({
        id: this.generateId(),
        role: "assistant",
        content: this.config.greeting,
        timestamp: Date.now(),
      });
    }

    if (this.config.mode === "inline") {
      this.isOpen = true;
      this.updateVisibility();
    }
  }

  disconnectedCallback(): void {
    this.abortController?.abort();
  }

  attributeChangedCallback(name: string, _oldVal: string | null, newVal: string | null): void {
    if (!newVal) return;
    this.setConfigFromAttribute(name, newVal);
  }

  // ─── Configuration ───────────────────────────────────────────────

  private parseAttributes(): void {
    for (const attr of AibyaiWidget.observedAttributes) {
      const val = this.getAttribute(attr);
      if (val) this.setConfigFromAttribute(attr, val);
    }
  }

  private setConfigFromAttribute(name: string, value: string): void {
    switch (name) {
      case "api-base-url":
        this.config.apiBaseUrl = value;
        break;
      case "api-key":
        this.config.apiKey = value;
        break;
      case "mode":
        this.config.mode = value as "floating" | "inline";
        break;
      case "title":
        this.config.title = value;
        break;
      case "placeholder":
        this.config.placeholder = value;
        break;
      case "primary-color":
        this.config.primaryColor = value;
        break;
      case "position":
        this.config.position = value as "bottom-right" | "bottom-left";
        break;
      case "greeting":
        this.config.greeting = value;
        break;
      case "show-sources":
        this.config.showSources = value !== "false";
        break;
      case "persist-session":
        this.config.persistSession = value !== "false";
        break;
      case "default-kb-id":
        this.config.defaultKbId = value;
        break;
    }
  }

  /** Programmatic configuration */
  configure(config: Partial<WidgetConfig>, theme?: Partial<WidgetTheme>): void {
    Object.assign(this.config, config);
    if (theme) Object.assign(this.theme, theme);
    this.render();
    this.bindEvents();
  }

  // ─── Rendering ───────────────────────────────────────────────────

  private render(): void {
    const isFloating = this.config.mode === "floating";
    const pos = this.config.position;

    this.shadow.innerHTML = `
      <style>${generateWidgetStyles(this.theme)}</style>

      ${isFloating ? `<button class="aibyai-launcher ${pos}" aria-label="Open chat">💬</button>` : ""}

      <div class="aibyai-widget-container ${isFloating ? `floating ${pos}` : "inline"} ${isFloating && !this.isOpen ? "hidden" : ""}">
        <div class="aibyai-header">
          <span>${this.escapeHtml(this.config.title)}</span>
          ${isFloating ? '<button class="aibyai-header-close" aria-label="Close">✕</button>' : ""}
        </div>
        <div class="aibyai-messages"></div>
        <div class="aibyai-input-area">
          <textarea class="aibyai-input" placeholder="${this.escapeHtml(this.config.placeholder)}" rows="1"></textarea>
          <button class="aibyai-send" aria-label="Send" disabled>▶</button>
        </div>
      </div>
    `;

    // Cache DOM refs
    this.container = this.shadow.querySelector(".aibyai-widget-container");
    this.messagesEl = this.shadow.querySelector(".aibyai-messages");
    this.inputEl = this.shadow.querySelector(".aibyai-input");
    this.sendBtn = this.shadow.querySelector(".aibyai-send");
    this.launcher = this.shadow.querySelector(".aibyai-launcher");

    // Re-render existing messages
    this.renderMessages();
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;
    this.messagesEl.innerHTML = "";

    for (const msg of this.messages) {
      if (msg.role === "system") continue;
      this.messagesEl.appendChild(this.createMessageElement(msg));
    }

    this.scrollToBottom();
  }

  private createMessageElement(msg: WidgetMessage): HTMLElement {
    const el = document.createElement("div");
    el.className = `aibyai-message ${msg.role}`;
    el.setAttribute("data-id", msg.id);

    let html = this.escapeHtml(msg.content);
    // Simple markdown-like bold
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    if (msg.isStreaming) {
      html += '<span class="aibyai-typing"><span class="aibyai-typing-dot"></span><span class="aibyai-typing-dot"></span><span class="aibyai-typing-dot"></span></span>';
    }

    el.innerHTML = html;

    if (msg.sources && msg.sources.length > 0 && this.config.showSources) {
      const sourcesEl = document.createElement("div");
      sourcesEl.className = "aibyai-sources";
      sourcesEl.innerHTML = msg.sources
        .map((s: WidgetSource, i: number) => {
          if (s.url) {
            return `<a class="aibyai-source-link" href="${this.escapeHtml(s.url)}" target="_blank" rel="noopener">[${i + 1}] ${this.escapeHtml(s.title)}</a>`;
          }
          return `<span>[${i + 1}] ${this.escapeHtml(s.title)}</span>`;
        })
        .join(" · ");
      el.appendChild(sourcesEl);
    }

    return el;
  }

  private scrollToBottom(): void {
    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  private updateVisibility(): void {
    if (this.config.mode !== "floating") return;
    this.container?.classList.toggle("hidden", !this.isOpen);
    this.launcher?.classList.toggle("hidden", this.isOpen);
  }

  // ─── Events ──────────────────────────────────────────────────────

  private bindEvents(): void {
    this.launcher?.addEventListener("click", () => {
      this.isOpen = true;
      this.updateVisibility();
      this.inputEl?.focus();
    });

    this.shadow.querySelector(".aibyai-header-close")?.addEventListener("click", () => {
      this.isOpen = false;
      this.updateVisibility();
    });

    this.inputEl?.addEventListener("input", () => {
      if (this.sendBtn) {
        this.sendBtn.disabled = !this.inputEl?.value.trim() || this.isStreaming;
      }
      // Auto-resize
      if (this.inputEl) {
        this.inputEl.style.height = "auto";
        this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + "px";
      }
    });

    this.inputEl?.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.sendBtn?.addEventListener("click", () => this.handleSend());
  }

  // ─── Chat Logic ──────────────────────────────────────────────────

  private async handleSend(): Promise<void> {
    const text = this.inputEl?.value.trim();
    if (!text || this.isStreaming) return;

    // Add user message
    const userMsg: WidgetMessage = {
      id: this.generateId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    this.addMessage(userMsg);

    // Clear input
    if (this.inputEl) {
      this.inputEl.value = "";
      this.inputEl.style.height = "auto";
    }
    if (this.sendBtn) this.sendBtn.disabled = true;

    // Create assistant placeholder
    const assistantMsg: WidgetMessage = {
      id: this.generateId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
      sources: [],
    };
    this.addMessage(assistantMsg);
    this.isStreaming = true;

    try {
      await this.streamResponse(text, assistantMsg);
    } catch (err) {
      assistantMsg.content = assistantMsg.content || "Sorry, something went wrong. Please try again.";
      assistantMsg.isStreaming = false;
      this.updateMessageElement(assistantMsg);
    } finally {
      this.isStreaming = false;
      if (this.sendBtn && this.inputEl) {
        this.sendBtn.disabled = !this.inputEl.value.trim();
      }
    }
  }

  private async streamResponse(query: string, msg: WidgetMessage): Promise<void> {
    if (!this.config.apiBaseUrl) {
      msg.content = "Widget is not configured. Please set the api-base-url attribute.";
      msg.isStreaming = false;
      this.updateMessageElement(msg);
      return;
    }

    this.abortController = new AbortController();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const body: Record<string, unknown> = {
      query,
      stream: true,
    };
    if (this.config.defaultKbId) {
      body.knowledgeBaseId = this.config.defaultKbId;
    }
    if (this.sessionId) {
      body.sessionId = this.sessionId;
    }

    const res = await fetch(`${this.config.apiBaseUrl}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const packet = JSON.parse(data) as StreamPacket;
          this.handleStreamPacket(packet, msg);
        } catch {
          // Skip malformed packets
        }
      }
    }

    msg.isStreaming = false;
    this.updateMessageElement(msg);
    this.saveSession();
  }

  private handleStreamPacket(packet: StreamPacket, msg: WidgetMessage): void {
    switch (packet.type) {
      case "message_delta":
        msg.content += packet.content;
        this.updateMessageElement(msg);
        break;
      case "citation":
        if (!msg.sources) msg.sources = [];
        msg.sources.push(packet.source);
        this.updateMessageElement(msg);
        break;
      case "done":
        msg.isStreaming = false;
        this.updateMessageElement(msg);
        break;
      case "error":
        msg.content += `\n\n[Error: ${packet.message}]`;
        msg.isStreaming = false;
        this.updateMessageElement(msg);
        break;
    }
  }

  // ─── Message Management ──────────────────────────────────────────

  private addMessage(msg: WidgetMessage): void {
    this.messages.push(msg);
    if (this.messagesEl) {
      this.messagesEl.appendChild(this.createMessageElement(msg));
      this.scrollToBottom();
    }
  }

  private updateMessageElement(msg: WidgetMessage): void {
    const el = this.messagesEl?.querySelector(`[data-id="${msg.id}"]`);
    if (!el) return;

    const newEl = this.createMessageElement(msg);
    el.replaceWith(newEl);
    this.scrollToBottom();
  }

  // ─── Session Persistence ─────────────────────────────────────────

  private saveSession(): void {
    if (!this.config.persistSession) return;
    try {
      const data = {
        sessionId: this.sessionId,
        messages: this.messages.filter((m) => !m.isStreaming),
      };
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // localStorage may be unavailable
    }
  }

  private restoreSession(): void {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { sessionId?: string; messages?: WidgetMessage[] };
      if (data.sessionId) this.sessionId = data.sessionId;
      if (Array.isArray(data.messages)) {
        this.messages = data.messages;
        this.renderMessages();
      }
    } catch {
      // Ignore corrupted session data
    }
  }

  /** Clear chat history */
  clearSession(): void {
    this.messages = [];
    this.sessionId = null;
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore
    }
    this.renderMessages();
  }

  // ─── Utilities ───────────────────────────────────────────────────

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

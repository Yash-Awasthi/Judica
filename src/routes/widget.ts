/**
 * Widget Routes — serve the embeddable chat widget bundle + config.
 *
 * GET  /embed.js         — self-contained widget JS (IIFE bundle)
 * GET  /config            — public widget configuration for a tenant
 * GET  /snippet           — ready-to-paste HTML embed snippet
 * PUT  /config            — admin: update widget configuration
 */

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AibyaiWidget } from "../widget/widget.js";
import { DEFAULT_WIDGET_CONFIG, DEFAULT_THEME } from "../widget/models.js";
import { generateWidgetStyles } from "../widget/styles.js";

// In-memory widget config store (per-tenant in production, use DB)
const widgetConfigs = new Map<string, Record<string, unknown>>();

export default async function widgetPlugin(fastify: FastifyInstance): Promise<void> {

  /**
   * GET /embed.js — Serve the self-contained widget as an IIFE script.
   * This is the script users include via <script src="...">.
   * We inline the widget class + styles into a single JS payload.
   */
  fastify.get("/embed.js", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    schema: {
      description: "Self-contained embeddable chat widget JavaScript bundle",
      tags: ["Widget"],
      response: {
        200: { type: "string" },
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    // Build the IIFE inline — no external build step required.
    // This bundles the web component class, styles, and auto-registration.
    const js = buildWidgetBundle();
    reply
      .type("application/javascript")
      .header("Cache-Control", "public, max-age=3600")
      .header("Access-Control-Allow-Origin", "*")
      .send(js);
  });

  /**
   * GET /config — Public widget configuration (no auth).
   * Used by the widget script to auto-configure itself.
   */
  fastify.get("/config", {
    schema: {
      description: "Get public widget configuration",
      tags: ["Widget"],
      querystring: {
        type: "object",
        properties: {
          tenant: { type: "string" },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenant } = request.query as { tenant?: string };
    const key = tenant || "default";
    const config = widgetConfigs.get(key) || {
      title: DEFAULT_WIDGET_CONFIG.title,
      primaryColor: DEFAULT_WIDGET_CONFIG.primaryColor,
      position: DEFAULT_WIDGET_CONFIG.position,
      placeholder: DEFAULT_WIDGET_CONFIG.placeholder,
      greeting: "Hi! How can I help you today?",
      showSources: DEFAULT_WIDGET_CONFIG.showSources,
      mode: DEFAULT_WIDGET_CONFIG.mode,
      theme: DEFAULT_THEME,
    };
    reply.send(config);
  });

  /**
   * GET /snippet — Ready-to-paste HTML embed snippet.
   */
  fastify.get("/snippet", {
    schema: {
      description: "Get HTML embed snippet for copy-paste integration",
      tags: ["Widget"],
      querystring: {
        type: "object",
        properties: {
          baseUrl: { type: "string", description: "Your aibyai server URL" },
          apiKey: { type: "string", description: "API key for widget auth" },
          mode: { type: "string", enum: ["floating", "inline"] },
          kbId: { type: "string", description: "Default knowledge base ID" },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as { baseUrl?: string; apiKey?: string; mode?: string; kbId?: string };
    const baseUrl = q.baseUrl || "{YOUR_SERVER_URL}";
    const apiKey = q.apiKey || "{YOUR_API_KEY}";
    const mode = q.mode || "floating";
    const kbId = q.kbId ? `\n  data-kb-id="${q.kbId}"` : "";

    const snippet = `<!-- AIBYAI Chat Widget -->
<script src="${baseUrl}/api/widget/embed.js" defer></script>
<aibyai-widget
  data-api-base-url="${baseUrl}"
  data-api-key="${apiKey}"
  data-mode="${mode}"${kbId}
></aibyai-widget>`;

    reply.send({ snippet, usage: "Paste this HTML before </body> on any page." });
  });

  /**
   * PUT /config — Admin: update widget configuration.
   */
  fastify.put("/config", {
    preHandler: [fastifyRequireAuth],
    schema: {
      description: "Update widget configuration (admin only)",
      tags: ["Widget"],
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          primaryColor: { type: "string" },
          position: { type: "string", enum: ["bottom-right", "bottom-left"] },
          placeholder: { type: "string" },
          greeting: { type: "string" },
          showSources: { type: "boolean" },
          mode: { type: "string", enum: ["floating", "inline"] },
          theme: {
            type: "object",
            properties: {
              primaryColor: { type: "string" },
              backgroundColor: { type: "string" },
              textColor: { type: "string" },
              borderColor: { type: "string" },
              inputBackground: { type: "string" },
              userBubbleColor: { type: "string" },
              assistantBubbleColor: { type: "string" },
              fontFamily: { type: "string" },
              fontSize: { type: "string" },
              borderRadius: { type: "string" },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    const key = "default"; // TODO: derive from tenant context
    const existing = widgetConfigs.get(key) || {};
    widgetConfigs.set(key, { ...existing, ...body });
    reply.send({ ok: true, config: widgetConfigs.get(key) });
  });
}

/**
 * Build a self-contained IIFE bundle for the widget.
 * This is a lightweight inline bundler — no esbuild/vite required at runtime.
 */
function buildWidgetBundle(): string {
  // We reconstruct the widget as a standalone IIFE with all deps inlined.
  return `(function(){
"use strict";

/* === Widget Styles === */
var DEFAULT_THEME = ${JSON.stringify(DEFAULT_THEME)};
var DEFAULT_CONFIG = ${JSON.stringify(DEFAULT_WIDGET_CONFIG)};

function generateStyles(theme) {
  var t = Object.assign({}, DEFAULT_THEME, theme || {});
  return \`
    :host { all: initial; display: block; font-family: \${t.fontFamily}; font-size: \${t.fontSize}; color: \${t.textColor}; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .widget-container { position: fixed; z-index: 999999; }
    .widget-container.bottom-right { bottom: 20px; right: 20px; }
    .widget-container.bottom-left { bottom: 20px; left: 20px; }
    .widget-container.inline { position: relative; width: 100%; height: 100%; }
    .widget-toggle { width: 56px; height: 56px; border-radius: 50%; background: \${t.primaryColor}; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: transform 0.2s; }
    .widget-toggle:hover { transform: scale(1.05); }
    .widget-toggle svg { width: 24px; height: 24px; fill: currentColor; }
    .chat-window { width: 380px; height: 560px; background: \${t.backgroundColor}; border: 1px solid \${t.borderColor}; border-radius: \${t.borderRadius}; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.12); }
    .chat-window.inline-mode { width: 100%; height: 100%; border-radius: 0; }
    .chat-header { padding: 16px; background: \${t.primaryColor}; color: #fff; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
    .chat-header button { background: none; border: none; color: #fff; cursor: pointer; font-size: 18px; }
    .chat-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .msg { max-width: 85%; padding: 10px 14px; border-radius: 16px; line-height: 1.4; word-wrap: break-word; }
    .msg.user { align-self: flex-end; background: \${t.userBubbleColor}; color: #fff; border-bottom-right-radius: 4px; }
    .msg.assistant { align-self: flex-start; background: \${t.assistantBubbleColor}; color: \${t.textColor}; border-bottom-left-radius: 4px; }
    .msg.system { align-self: center; color: #9ca3af; font-size: 12px; }
    .sources { margin-top: 6px; font-size: 11px; color: #6b7280; }
    .sources a { color: \${t.primaryColor}; text-decoration: none; }
    .chat-input-area { display: flex; gap: 8px; padding: 12px; border-top: 1px solid \${t.borderColor}; background: \${t.inputBackground}; }
    .chat-input-area input { flex: 1; padding: 10px 14px; border: 1px solid \${t.borderColor}; border-radius: 24px; outline: none; font-size: \${t.fontSize}; font-family: \${t.fontFamily}; background: \${t.backgroundColor}; color: \${t.textColor}; }
    .chat-input-area input:focus { border-color: \${t.primaryColor}; }
    .chat-input-area button { width: 40px; height: 40px; border-radius: 50%; background: \${t.primaryColor}; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .chat-input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
    .typing-dot { display: inline-block; width: 6px; height: 6px; background: #9ca3af; border-radius: 50%; margin: 0 2px; animation: blink 1.4s infinite both; }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes blink { 0%, 80%, 100% { opacity: 0; } 40% { opacity: 1; } }
    .hidden { display: none !important; }
  \`;
}

/* === Widget Class === */
class AibyaiWidget extends HTMLElement {
  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    this.messages = [];
    this.isOpen = false;
    this.isStreaming = false;
    this.sessionId = null;
    this.abortController = null;
  }

  static get observedAttributes() {
    return ["data-api-base-url", "data-api-key", "data-mode", "data-title",
            "data-primary-color", "data-position", "data-kb-id", "data-greeting",
            "data-show-sources", "data-placeholder"];
  }

  connectedCallback() {
    this.config = Object.assign({}, DEFAULT_CONFIG, {
      apiBaseUrl: this.getAttribute("data-api-base-url") || "",
      apiKey: this.getAttribute("data-api-key") || "",
      mode: this.getAttribute("data-mode") || "floating",
      title: this.getAttribute("data-title") || DEFAULT_CONFIG.title,
      primaryColor: this.getAttribute("data-primary-color") || DEFAULT_CONFIG.primaryColor,
      position: this.getAttribute("data-position") || DEFAULT_CONFIG.position,
      defaultKbId: this.getAttribute("data-kb-id") || undefined,
      greeting: this.getAttribute("data-greeting") || undefined,
      showSources: this.getAttribute("data-show-sources") !== "false",
      placeholder: this.getAttribute("data-placeholder") || DEFAULT_CONFIG.placeholder,
    });
    this.theme = Object.assign({}, DEFAULT_THEME, { primaryColor: this.config.primaryColor });
    this._restoreSession();
    this._render();
    if (this.config.greeting && this.messages.length === 0) {
      this.messages.push({ id: "greeting", role: "assistant", content: this.config.greeting, timestamp: Date.now() });
      this._renderMessages();
    }
    if (this.config.mode === "inline") { this.isOpen = true; this._render(); }
  }

  disconnectedCallback() {
    if (this.abortController) this.abortController.abort();
  }

  _restoreSession() {
    try {
      var data = localStorage.getItem("aibyai-widget-session");
      if (data) { var parsed = JSON.parse(data); this.sessionId = parsed.sessionId; this.messages = parsed.messages || []; }
    } catch {}
  }
  _saveSession() {
    try { localStorage.setItem("aibyai-widget-session", JSON.stringify({ sessionId: this.sessionId, messages: this.messages })); } catch {}
  }

  _render() {
    var isFloating = this.config.mode === "floating";
    this.shadow.innerHTML = "<style>" + generateStyles(this.theme) + "</style>" +
      '<div class="widget-container ' + (isFloating ? this.config.position : "inline") + '">' +
      (isFloating && !this.isOpen ?
        '<button class="widget-toggle" aria-label="Open chat"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></button>' :
        '<div class="chat-window' + (isFloating ? "" : " inline-mode") + '">' +
          '<div class="chat-header"><span>' + this._esc(this.config.title) + '</span>' +
          (isFloating ? '<button class="close-btn" aria-label="Close">&times;</button>' : "") +
          '</div><div class="chat-messages"></div>' +
          '<div class="chat-input-area"><input type="text" placeholder="' + this._esc(this.config.placeholder) + '" />' +
          '<button aria-label="Send"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div></div>'
      ) + '</div>';

    var toggle = this.shadow.querySelector(".widget-toggle");
    if (toggle) toggle.addEventListener("click", function() { this.isOpen = true; this._render(); this._renderMessages(); }.bind(this));

    var closeBtn = this.shadow.querySelector(".close-btn");
    if (closeBtn) closeBtn.addEventListener("click", function() { this.isOpen = false; this._render(); }.bind(this));

    var input = this.shadow.querySelector("input");
    var sendBtn = this.shadow.querySelector(".chat-input-area button");
    if (input) {
      input.addEventListener("keydown", function(e) { if (e.key === "Enter" && !this.isStreaming) this._send(); }.bind(this));
    }
    if (sendBtn) sendBtn.addEventListener("click", function() { if (!this.isStreaming) this._send(); }.bind(this));
    this._renderMessages();
  }

  _renderMessages() {
    var container = this.shadow.querySelector(".chat-messages");
    if (!container) return;
    container.innerHTML = this.messages.map(function(m) {
      var src = "";
      if (m.sources && m.sources.length) {
        src = '<div class="sources">' + m.sources.map(function(s) {
          return s.url ? '<a href="' + s.url + '" target="_blank">' + this._esc(s.title) + '</a>' : this._esc(s.title);
        }.bind(this)).join(" &middot; ") + '</div>';
      }
      return '<div class="msg ' + m.role + '">' + this._esc(m.content) + src + '</div>';
    }.bind(this)).join("");
    container.scrollTop = container.scrollHeight;
  }

  async _send() {
    var input = this.shadow.querySelector("input");
    if (!input) return;
    var query = input.value.trim();
    if (!query) return;
    input.value = "";
    this.messages.push({ id: "u-" + Date.now(), role: "user", content: query, timestamp: Date.now() });
    var assistantMsg = { id: "a-" + Date.now(), role: "assistant", content: "", sources: [], timestamp: Date.now(), isStreaming: true };
    this.messages.push(assistantMsg);
    this._renderMessages();
    this.isStreaming = true;
    var sendBtn = this.shadow.querySelector(".chat-input-area button");
    if (sendBtn) sendBtn.disabled = true;

    try {
      this.abortController = new AbortController();
      var headers = { "Content-Type": "application/json" };
      if (this.config.apiKey) headers["Authorization"] = "Bearer " + this.config.apiKey;
      var body = { query: query, stream: true };
      if (this.config.defaultKbId) body.knowledgeBaseId = this.config.defaultKbId;
      if (this.sessionId) body.sessionId = this.sessionId;

      var resp = await fetch(this.config.apiBaseUrl + "/api/ask/stream", {
        method: "POST", headers: headers, body: JSON.stringify(body),
        signal: this.abortController.signal,
      });
      if (!resp.ok) throw new Error("API error: " + resp.status);
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      while (true) {
        var result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split("\\n");
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith("data: ")) continue;
          var payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            var packet = JSON.parse(payload);
            if (packet.type === "message_delta") { assistantMsg.content += packet.content; this._renderMessages(); }
            else if (packet.type === "citation") { assistantMsg.sources.push(packet.source); }
            else if (packet.type === "done" && packet.sessionId) { this.sessionId = packet.sessionId; }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        assistantMsg.content = assistantMsg.content || "Sorry, something went wrong. Please try again.";
      }
    }
    assistantMsg.isStreaming = false;
    this.isStreaming = false;
    if (sendBtn) sendBtn.disabled = false;
    this._renderMessages();
    this._saveSession();
  }

  _esc(s) { var d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
}

if (!customElements.get("aibyai-widget")) {
  customElements.define("aibyai-widget", AibyaiWidget);
}
})();`;
}

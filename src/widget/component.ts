/**
 * AiByAiChatWidget — full Shadow DOM web component for drop-in chat embedding.
 *
 * This file contains the component as a TypeScript class (for type checking),
 * but the canonical runtime artifact is the IIFE string produced by
 * `buildAiByAiChatComponentJS()` in widget.ts, which is what gets served
 * at GET /api/widget/embed.js.
 *
 * Attributes:
 *   api-key          — Bearer token sent to the API
 *   bot-name         — Header title (default: "AI Assistant")
 *   primary-color    — Hex/CSS color for the bubble and header (default: "#6366f1")
 *   position         — "bottom-right" | "bottom-left" (default: "bottom-right")
 *   placeholder      — Input placeholder text
 *   width            — Chat panel width (default: "380px")
 *   height           — Chat panel height (default: "560px")
 *   api-base-url     — Base URL for API calls (default: window.location.origin)
 *   kb-id            — Optional default knowledge base ID
 *   greeting         — Initial assistant message
 *   show-sources     — Whether to render source citations (default: "true")
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ title: string; url?: string }>;
  timestamp: number;
  isStreaming?: boolean;
}

export const SESSION_KEY = "aibyai-chat-session-v2";

/** Minimal markdown renderer: bold, italic, inline-code, line breaks, links. */
export function renderMarkdown(text: string): string {
  return text
    // Escape HTML first
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Code blocks (```...```)
    .replace(/```[\w]*\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // Links [text](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // Line breaks
    .replace(/\n/g, "<br>");
}

/** Build the full IIFE JavaScript string for the widget — no build step needed. */
export function buildAiByAiChatComponentJS(): string {
  return `(function(){
"use strict";

/* ─── Markdown renderer ─────────────────────────────────────────────────── */
function renderMd(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\`\`\`[\\w]*\\n?([\\s\\S]*?)\`\`\`/g, "<pre><code>$1</code></pre>")
    .replace(/\`([^\`]+)\`/g, "<code>$1</code>")
    .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
    .replace(/\\*([^*]+)\\*/g, "<em>$1</em>")
    .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\\n/g, "<br>");
}

/* ─── CSS ────────────────────────────────────────────────────────────────── */
function buildCSS(cfg) {
  var pc = cfg.primaryColor || "#6366f1";
  var w  = cfg.width        || "380px";
  var h  = cfg.height       || "560px";
  var pos = cfg.position    || "bottom-right";
  var posCSS = pos === "bottom-left"
    ? "bottom:20px;left:20px;"
    : "bottom:20px;right:20px;";

  return \`
    :host { all: initial; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:14px; }
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }

    /* Bubble */
    .bubble {
      position:fixed; \${posCSS} width:56px; height:56px; border-radius:50%;
      background:\${pc}; color:#fff; border:none; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 4px 16px rgba(0,0,0,.18); z-index:2147483646;
      transition:transform .2s, box-shadow .2s;
    }
    .bubble:hover { transform:scale(1.07); box-shadow:0 6px 22px rgba(0,0,0,.22); }
    .bubble svg { width:26px; height:26px; fill:#fff; pointer-events:none; }
    .bubble .badge {
      position:absolute; top:-2px; right:-2px; min-width:18px; height:18px;
      background:#ef4444; border-radius:9px; font-size:11px; font-weight:700;
      color:#fff; display:none; align-items:center; justify-content:center; padding:0 4px;
    }
    .bubble .badge.visible { display:flex; }

    /* Panel */
    .panel {
      position:fixed; \${posCSS} width:\${w}; height:\${h};
      background:#fff; border-radius:16px; overflow:hidden;
      box-shadow:0 12px 48px rgba(0,0,0,.16); display:flex; flex-direction:column;
      z-index:2147483647; transform:scale(.9) translateY(12px); opacity:0;
      transition:transform .25s cubic-bezier(.34,1.56,.64,1), opacity .2s;
      pointer-events:none;
    }
    .panel.open { transform:scale(1) translateY(0); opacity:1; pointer-events:all; }

    /* Header */
    .header {
      background:\${pc}; color:#fff; padding:14px 16px;
      display:flex; align-items:center; justify-content:space-between;
      flex-shrink:0;
    }
    .header-title { font-weight:600; font-size:15px; display:flex; align-items:center; gap:8px; }
    .header-avatar {
      width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,.25);
      display:flex; align-items:center; justify-content:center; flex-shrink:0;
    }
    .header-avatar svg { width:16px; height:16px; fill:#fff; }
    .header-actions { display:flex; gap:6px; }
    .header-btn {
      background:rgba(255,255,255,.2); border:none; color:#fff; cursor:pointer;
      width:28px; height:28px; border-radius:8px; display:flex; align-items:center;
      justify-content:center; transition:background .15s;
    }
    .header-btn:hover { background:rgba(255,255,255,.35); }
    .header-btn svg { width:14px; height:14px; fill:#fff; }

    /* Messages */
    .messages {
      flex:1; overflow-y:auto; padding:16px 12px; display:flex;
      flex-direction:column; gap:10px; scroll-behavior:smooth;
    }
    .messages::-webkit-scrollbar { width:4px; }
    .messages::-webkit-scrollbar-track { background:transparent; }
    .messages::-webkit-scrollbar-thumb { background:#d1d5db; border-radius:2px; }

    /* Message bubbles */
    .msg { max-width:82%; display:flex; flex-direction:column; gap:4px; }
    .msg.user { align-self:flex-end; }
    .msg.assistant { align-self:flex-start; }
    .msg-body {
      padding:10px 14px; border-radius:16px; line-height:1.5;
      word-wrap:break-word; word-break:break-word;
    }
    .msg.user .msg-body {
      background:\${pc}; color:#fff; border-bottom-right-radius:4px;
    }
    .msg.assistant .msg-body {
      background:#f3f4f6; color:#1f2937; border-bottom-left-radius:4px;
    }
    .msg-body a { color:\${pc}; }
    .msg-body pre { background:#1e293b; color:#e2e8f0; padding:10px; border-radius:8px; overflow-x:auto; margin:6px 0; font-size:12px; }
    .msg-body code { font-family:monospace; font-size:12px; }
    .msg-body pre code { background:none; padding:0; color:inherit; }
    .msg-body code:not(pre code) { background:rgba(0,0,0,.08); padding:1px 5px; border-radius:4px; }

    /* Sources */
    .sources { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
    .source-chip {
      font-size:11px; padding:2px 8px; border-radius:10px;
      background:#e5e7eb; color:#6b7280; text-decoration:none;
      border:1px solid #d1d5db; transition:background .15s;
    }
    .source-chip:hover { background:#d1d5db; color:#374151; }

    /* Typing indicator */
    .typing { display:flex; align-items:center; gap:4px; padding:10px 14px; background:#f3f4f6; border-radius:16px; border-bottom-left-radius:4px; align-self:flex-start; }
    .dot { width:6px; height:6px; background:#9ca3af; border-radius:50%; animation:blink 1.4s infinite both; }
    .dot:nth-child(2) { animation-delay:.2s; }
    .dot:nth-child(3) { animation-delay:.4s; }
    @keyframes blink { 0%,80%,100%{opacity:0;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }

    /* Input area */
    .input-area {
      display:flex; align-items:flex-end; gap:8px; padding:12px;
      border-top:1px solid #e5e7eb; background:#f9fafb; flex-shrink:0;
    }
    .input-wrap { flex:1; position:relative; }
    .chat-input {
      width:100%; padding:10px 14px; border:1.5px solid #e5e7eb; border-radius:22px;
      outline:none; font-size:14px; font-family:inherit; resize:none;
      background:#fff; color:#1f2937; max-height:120px; overflow-y:auto;
      line-height:1.4; transition:border-color .15s;
    }
    .chat-input:focus { border-color:\${pc}; }
    .send-btn {
      width:40px; height:40px; border-radius:50%; background:\${pc};
      color:#fff; border:none; cursor:pointer; flex-shrink:0;
      display:flex; align-items:center; justify-content:center;
      transition:background .15s, transform .1s; align-self:flex-end;
    }
    .send-btn:hover:not(:disabled) { filter:brightness(1.1); transform:scale(1.05); }
    .send-btn:disabled { opacity:.45; cursor:not-allowed; transform:none; }
    .send-btn svg { width:18px; height:18px; fill:#fff; }

    /* Error */
    .msg.error .msg-body { background:#fee2e2; color:#991b1b; border-radius:12px; }

    /* Empty state */
    .empty {
      flex:1; display:flex; flex-direction:column; align-items:center;
      justify-content:center; gap:12px; color:#9ca3af; padding:24px; text-align:center;
    }
    .empty svg { width:48px; height:48px; fill:#d1d5db; }
    .empty p { font-size:13px; line-height:1.5; }

    /* Mobile */
    @media (max-width:480px) {
      .panel { width:100vw !important; height:100dvh !important; bottom:0 !important; right:0 !important; left:0 !important; border-radius:0 !important; }
    }
  \`;
}

/* ─── Icons ─────────────────────────────────────────────────────────────── */
var ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
var ICON_CLOSE = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
var ICON_SEND  = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
var ICON_BOT   = '<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.38-1 1.72V7h1a7 7 0 017 7H3a7 7 0 017-7h1V5.72A2 2 0 0110 4a2 2 0 012-2zM7 14v2h2v-2H7zm8 0v2h2v-2h-2z"/></svg>';
var ICON_CLEAR = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

/* ─── Web Component ─────────────────────────────────────────────────────── */
class AiByAiChat extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: 'closed' });
    this._messages = [];
    this._open = false;
    this._streaming = false;
    this._sessionId = null;
    this._abortCtrl = null;
    this._unreadCount = 0;
  }

  static get observedAttributes() {
    return ['api-key','bot-name','primary-color','position','placeholder','width','height','api-base-url','kb-id','greeting','show-sources'];
  }

  _cfg() {
    return {
      apiKey:       this.getAttribute('api-key')       || '',
      botName:      this.getAttribute('bot-name')      || 'AI Assistant',
      primaryColor: this.getAttribute('primary-color') || '#6366f1',
      position:     this.getAttribute('position')      || 'bottom-right',
      placeholder:  this.getAttribute('placeholder')   || 'Ask anything...',
      width:        this.getAttribute('width')         || '380px',
      height:       this.getAttribute('height')        || '560px',
      apiBaseUrl:   this.getAttribute('api-base-url')  || (typeof window !== 'undefined' ? window.location.origin : ''),
      kbId:         this.getAttribute('kb-id')         || null,
      greeting:     this.getAttribute('greeting')      || null,
      showSources:  this.getAttribute('show-sources')  !== 'false',
    };
  }

  connectedCallback() {
    this._restoreSession();
    this._mount();
    var cfg = this._cfg();
    if (cfg.greeting && this._messages.length === 0) {
      this._messages.push({ id: 'g-0', role: 'assistant', content: cfg.greeting, timestamp: Date.now() });
    }
    this._renderMessages();
  }

  disconnectedCallback() {
    if (this._abortCtrl) this._abortCtrl.abort();
  }

  attributeChangedCallback() {
    if (this._shadow.innerHTML) this._remount();
  }

  _mount() {
    var cfg = this._cfg();
    var pos = cfg.position === 'bottom-left' ? 'bottom:20px;left:20px' : 'bottom:20px;right:20px';
    this._shadow.innerHTML =
      '<style>' + buildCSS(cfg) + '</style>' +
      '<button class="bubble" aria-label="Open chat" style="' + pos + '">' +
        ICON_CHAT +
        '<span class="badge"></span>' +
      '</button>' +
      '<div class="panel" role="dialog" aria-label="' + this._esc(cfg.botName) + ' chat">' +
        '<div class="header">' +
          '<div class="header-title">' +
            '<div class="header-avatar">' + ICON_BOT + '</div>' +
            '<span>' + this._esc(cfg.botName) + '</span>' +
          '</div>' +
          '<div class="header-actions">' +
            '<button class="header-btn clear-btn" aria-label="Clear chat">' + ICON_CLEAR + '</button>' +
            '<button class="header-btn close-btn" aria-label="Close chat">' + ICON_CLOSE + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="messages" id="msgs"></div>' +
        '<div class="input-area">' +
          '<div class="input-wrap">' +
            '<textarea class="chat-input" placeholder="' + this._esc(cfg.placeholder) + '" rows="1" aria-label="Message input"></textarea>' +
          '</div>' +
          '<button class="send-btn" disabled aria-label="Send message">' + ICON_SEND + '</button>' +
        '</div>' +
      '</div>';

    this._bindEvents();
  }

  _remount() {
    var msgs = this._messages.slice();
    var open = this._open;
    this._mount();
    this._messages = msgs;
    this._open = open;
    this._renderMessages();
    if (open) this._shadow.querySelector('.panel').classList.add('open');
  }

  _bindEvents() {
    var self = this;
    var shadow = this._shadow;

    shadow.querySelector('.bubble').addEventListener('click', function() {
      self._open = true;
      shadow.querySelector('.panel').classList.add('open');
      shadow.querySelector('.badge').classList.remove('visible');
      self._unreadCount = 0;
      setTimeout(function() { shadow.querySelector('.chat-input').focus(); }, 200);
    });

    shadow.querySelector('.close-btn').addEventListener('click', function() {
      self._open = false;
      shadow.querySelector('.panel').classList.remove('open');
    });

    shadow.querySelector('.clear-btn').addEventListener('click', function() {
      self._messages = [];
      self._sessionId = null;
      try { sessionStorage.removeItem('aibyai-chat-session-v2'); } catch(e) {}
      self._renderMessages();
    });

    var input = shadow.querySelector('.chat-input');
    var sendBtn = shadow.querySelector('.send-btn');

    input.addEventListener('input', function() {
      sendBtn.disabled = !input.value.trim() || self._streaming;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!self._streaming && input.value.trim()) self._send();
      }
    });

    sendBtn.addEventListener('click', function() {
      if (!self._streaming) self._send();
    });
  }

  _renderMessages() {
    var container = this._shadow.querySelector('#msgs');
    if (!container) return;
    var cfg = this._cfg();

    if (this._messages.length === 0) {
      container.innerHTML =
        '<div class="empty">' +
          ICON_BOT +
          "<p>Ask me anything! I'm here to help.</p>" +
        '</div>';
      return;
    }

    container.innerHTML = this._messages.map(function(m) {
      var bodyContent = m.isStreaming && !m.content
        ? '<div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>'
        : '<div class="msg-body">' + (m.role === 'assistant' ? renderMd(m.content) : this._esc(m.content)) +
          (m.isStreaming ? '<span style="opacity:.5"> ▌</span>' : '') +
          '</div>';

      var sourcesHTML = '';
      if (!m.isStreaming && m.sources && m.sources.length && cfg.showSources) {
        sourcesHTML = '<div class="sources">' +
          m.sources.map(function(s) {
            return s.url
              ? '<a class="source-chip" href="' + this._esc(s.url) + '" target="_blank" rel="noopener">' + this._esc(s.title) + '</a>'
              : '<span class="source-chip">' + this._esc(s.title) + '</span>';
          }.bind(this)).join('') +
          '</div>';
      }

      return '<div class="msg ' + m.role + '" data-id="' + m.id + '">' + bodyContent + sourcesHTML + '</div>';
    }.bind(this)).join('');

    container.scrollTop = container.scrollHeight;
  }

  async _send() {
    var input = this._shadow.querySelector('.chat-input');
    var sendBtn = this._shadow.querySelector('.send-btn');
    var text = input.value.trim();
    if (!text || this._streaming) return;

    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;

    var userMsg = { id: 'u-' + Date.now(), role: 'user', content: text, timestamp: Date.now() };
    this._messages.push(userMsg);

    var assistantMsg = { id: 'a-' + Date.now(), role: 'assistant', content: '', sources: [], timestamp: Date.now(), isStreaming: true };
    this._messages.push(assistantMsg);
    this._renderMessages();
    this._streaming = true;

    var cfg = this._cfg();

    try {
      this._abortCtrl = new AbortController();
      var headers = { 'Content-Type': 'application/json' };
      if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;

      var body = { query: text, stream: true };
      if (cfg.kbId) body.knowledgeBaseId = cfg.kbId;
      if (this._sessionId) body.sessionId = this._sessionId;

      var resp = await fetch(cfg.apiBaseUrl + '/api/ask/stream', {
        method: 'POST', headers: headers, body: JSON.stringify(body),
        signal: this._abortCtrl.signal,
      });

      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      if (!resp.body) throw new Error('No response body');

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split('\\n');
        buf = lines.pop() || '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith('data: ')) continue;
          var payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            var pkt = JSON.parse(payload);
            if (pkt.type === 'message_delta') {
              assistantMsg.content += pkt.content;
              this._renderMessages();
            } else if (pkt.type === 'citation' && pkt.source) {
              assistantMsg.sources.push(pkt.source);
            } else if (pkt.type === 'done') {
              if (pkt.sessionId) this._sessionId = pkt.sessionId;
              if (pkt.messageId) assistantMsg.id = pkt.messageId;
            } else if (pkt.type === 'error') {
              assistantMsg.content += (assistantMsg.content ? '\\n\\n' : '') + '[Error: ' + pkt.message + ']';
            }
          } catch(e) {}
        }
      }
    } catch(err) {
      if (err && err.name !== 'AbortError') {
        assistantMsg.content = assistantMsg.content ||
          'Sorry, I encountered an error. Please check your connection and try again.';
      }
    }

    assistantMsg.isStreaming = false;
    this._streaming = false;
    sendBtn.disabled = !input.value.trim();
    this._renderMessages();
    this._saveSession();

    if (!this._open) {
      this._unreadCount++;
      var badge = this._shadow.querySelector('.badge');
      if (badge) { badge.textContent = String(this._unreadCount); badge.classList.add('visible'); }
    }
  }

  _saveSession() {
    try {
      sessionStorage.setItem('aibyai-chat-session-v2', JSON.stringify({
        sessionId: this._sessionId,
        messages: this._messages.filter(function(m) { return !m.isStreaming; }),
      }));
    } catch(e) {}
  }

  _restoreSession() {
    try {
      var raw = sessionStorage.getItem('aibyai-chat-session-v2');
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data.sessionId) this._sessionId = data.sessionId;
      if (Array.isArray(data.messages)) this._messages = data.messages;
    } catch(e) {}
  }

  _esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

/* ─── Auto-register ─────────────────────────────────────────────────────── */
if (typeof customElements !== 'undefined' && !customElements.get('aibyai-chat')) {
  customElements.define('aibyai-chat', AiByAiChat);
}

})();`;
}

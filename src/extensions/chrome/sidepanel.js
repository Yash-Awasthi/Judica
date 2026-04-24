/**
 * AIBYAI Chrome Extension — Side Panel
 *
 * Handles chat UI, API communication, SSE streaming, session management,
 * and actions dispatched from the service worker (search, summarize, deliberate).
 *
 * Modeled after onyx-chrome-extension sidepanel.
 */

/* global chrome */

// ─── State ─────────────────────────────────────────────────────────

let apiUrl = "";
let apiKey = "";
let kbId = "";
let sessionId = null;
let messages = [];
let isStreaming = false;
let abortController = null;

// ─── DOM ───────────────────────────────────────────────────────────

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const apiUrlInput = document.getElementById("api-url");
const apiKeyInput = document.getElementById("api-key");
const kbIdInput = document.getElementById("kb-id");
const saveSettingsBtn = document.getElementById("save-settings");
const cancelSettingsBtn = document.getElementById("cancel-settings");

// ─── Init ──────────────────────────────────────────────────────────

async function init() {
  // Load saved settings
  const stored = await chrome.storage.sync.get(["apiUrl", "apiKey", "kbId"]);
  apiUrl = stored.apiUrl || "";
  apiKey = stored.apiKey || "";
  kbId = stored.kbId || "";

  // Load session
  const session = await chrome.storage.local.get(["sessionId", "messages"]);
  sessionId = session.sessionId || null;
  messages = session.messages || [];

  renderMessages();

  if (!apiUrl) {
    showSettings();
  }

  // Check for pending action from service worker
  const { pendingAction } = await chrome.storage.session.get("pendingAction");
  if (pendingAction) {
    await chrome.storage.session.remove("pendingAction");
    handleAction(pendingAction);
  }
}

// ─── Settings ──────────────────────────────────────────────────────

function showSettings() {
  apiUrlInput.value = apiUrl;
  apiKeyInput.value = apiKey;
  kbIdInput.value = kbId;
  settingsPanel.classList.remove("hidden");
}

function hideSettings() {
  settingsPanel.classList.add("hidden");
}

settingsBtn.addEventListener("click", showSettings);
cancelSettingsBtn.addEventListener("click", hideSettings);

saveSettingsBtn.addEventListener("click", async () => {
  apiUrl = apiUrlInput.value.trim().replace(/\/$/, "");
  apiKey = apiKeyInput.value.trim();
  kbId = kbIdInput.value.trim();
  await chrome.storage.sync.set({ apiUrl, apiKey, kbId });
  hideSettings();
});

// ─── Messages ──────────────────────────────────────────────────────

function renderMessages() {
  messagesEl.innerHTML = "";
  for (const msg of messages) {
    if (msg.role === "system") continue;
    appendMessageEl(msg);
  }
  scrollToBottom();
}

function appendMessageEl(msg) {
  const el = document.createElement("div");
  el.className = `message ${msg.role}`;
  el.dataset.id = msg.id;

  let html = escapeHtml(msg.content);
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\n/g, "<br>");

  if (msg.isStreaming) {
    html += '<span class="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
  }

  el.innerHTML = html;

  if (msg.sources && msg.sources.length > 0) {
    const sourcesEl = document.createElement("div");
    sourcesEl.className = "sources";
    sourcesEl.innerHTML = msg.sources
      .map((s, i) =>
        s.url
          ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">[${i + 1}] ${escapeHtml(s.title)}</a>`
          : `<span>[${i + 1}] ${escapeHtml(s.title)}</span>`
      )
      .join(" · ");
    el.appendChild(sourcesEl);
  }

  messagesEl.appendChild(el);
}

function updateMessageEl(msg) {
  const el = messagesEl.querySelector(`[data-id="${msg.id}"]`);
  if (!el) return;

  let html = escapeHtml(msg.content);
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\n/g, "<br>");

  if (msg.isStreaming) {
    html += '<span class="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
  }

  el.innerHTML = html;
  scrollToBottom();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function generateId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Chat ──────────────────────────────────────────────────────────

async function sendMessage(text) {
  if (!text.trim() || isStreaming) return;
  if (!apiUrl) {
    showSettings();
    return;
  }

  // User message
  const userMsg = {
    id: generateId(),
    role: "user",
    content: text.trim(),
    timestamp: Date.now(),
  };
  messages.push(userMsg);
  appendMessageEl(userMsg);
  scrollToBottom();

  // Clear input
  inputEl.value = "";
  inputEl.style.height = "auto";
  sendBtn.disabled = true;

  // Assistant placeholder
  const assistantMsg = {
    id: generateId(),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    isStreaming: true,
    sources: [],
  };
  messages.push(assistantMsg);
  appendMessageEl(assistantMsg);
  isStreaming = true;

  try {
    await streamResponse(text.trim(), assistantMsg);
  } catch (err) {
    assistantMsg.content = assistantMsg.content || `Error: ${err.message || "Something went wrong"}`;
    assistantMsg.isStreaming = false;
    updateMessageEl(assistantMsg);
  } finally {
    isStreaming = false;
    sendBtn.disabled = !inputEl.value.trim();
    saveSession();
  }
}

async function streamResponse(query, msg) {
  abortController = new AbortController();

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const body = { query, stream: true };
  if (kbId) body.knowledgeBaseId = kbId;
  if (sessionId) body.sessionId = sessionId;

  const res = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: abortController.signal,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error("No response body");

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
        const packet = JSON.parse(data);
        handlePacket(packet, msg);
      } catch {
        // Skip malformed
      }
    }
  }

  msg.isStreaming = false;
  updateMessageEl(msg);
}

function handlePacket(packet, msg) {
  switch (packet.type) {
    case "message_delta":
      msg.content += packet.content;
      updateMessageEl(msg);
      break;
    case "citation":
      if (!msg.sources) msg.sources = [];
      msg.sources.push(packet.source);
      break;
    case "done":
      msg.isStreaming = false;
      updateMessageEl(msg);
      break;
    case "error":
      msg.content += `\n[Error: ${packet.message}]`;
      msg.isStreaming = false;
      updateMessageEl(msg);
      break;
  }
}

// ─── Actions from Service Worker ───────────────────────────────────

function handleAction(action) {
  switch (action.type) {
    case "aibyai-search":
      sendMessage(action.text);
      break;
    case "aibyai-summarize": {
      const prompt = action.text
        ? `Summarize the following text:\n\n${action.text}`
        : `Summarize the page at: ${action.pageUrl} (${action.pageTitle})`;
      sendMessage(prompt);
      break;
    }
    case "aibyai-deliberate":
      sendMessage(`Start a deliberation on the following topic:\n\n${action.text}`);
      break;
  }
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type && message.type.startsWith("aibyai-")) {
    handleAction(message);
  }
});

// ─── Session Persistence ───────────────────────────────────────────

function saveSession() {
  chrome.storage.local.set({
    sessionId,
    messages: messages.filter((m) => !m.isStreaming).slice(-50), // Keep last 50
  });
}

// ─── Events ────────────────────────────────────────────────────────

inputEl.addEventListener("input", () => {
  sendBtn.disabled = !inputEl.value.trim() || isStreaming;
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(inputEl.value);
  }
});

sendBtn.addEventListener("click", () => sendMessage(inputEl.value));

// ─── Utilities ─────────────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ─── Boot ──────────────────────────────────────────────────────────

init();

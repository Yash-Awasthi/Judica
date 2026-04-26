/**
 * Side Panel — Full council sidebar for the Chrome extension.
 *
 * Provides a persistent chat interface with the council, including
 * conversation history, page context injection, and streaming responses.
 */

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface SidePanelState {
  messages: Message[];
  input: string;
  loading: boolean;
  error: string | null;
  pageContext: string | null;
}

const state: SidePanelState = {
  messages: [],
  input: "",
  loading: false,
  error: null,
  pageContext: null,
};

// ─── Settings ────────────────────────────────────────────────────────────────

async function getSettings(): Promise<{ apiUrl: string; token: string }> {
  const result = await chrome.storage.sync.get(["apiUrl", "surfaceToken"]);
  return {
    apiUrl: result.apiUrl || "http://localhost:3000",
    token: result.surfaceToken || "",
  };
}

// ─── Render ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render(): void {
  const root = document.getElementById("sidepanel-root");
  if (!root) return;

  const messagesHtml = state.messages
    .map(
      (msg) => `
      <div class="message message-${msg.role}">
        <div class="message-role">${msg.role === "user" ? "You" : "Council"}</div>
        <div class="message-content">${escapeHtml(msg.content)}</div>
      </div>
    `,
    )
    .join("");

  root.innerHTML = `
    <div class="sidepanel-container">
      <div class="sidepanel-header">
        <h1 class="sidepanel-title">AI Council</h1>
        <div class="sidepanel-actions">
          <button id="btn-context" class="btn-icon" title="Grab page context">
            &#128196;
          </button>
          <button id="btn-clear" class="btn-icon" title="Clear conversation">
            &#128465;
          </button>
        </div>
      </div>

      ${state.pageContext ? `<div class="context-badge">Page context attached</div>` : ""}

      <div class="messages-container" id="messages-container">
        ${
          messagesHtml ||
          '<div class="empty-state">Ask the council anything. Use the page icon to include context from the current page.</div>'
        }
        ${state.loading ? '<div class="message message-assistant loading-indicator">Thinking...</div>' : ""}
      </div>

      ${state.error ? `<div class="error-msg">${escapeHtml(state.error)}</div>` : ""}

      <form id="chat-form" class="chat-form">
        <textarea
          id="chat-input"
          class="chat-input"
          placeholder="Message the council..."
          rows="2"
        >${state.input}</textarea>
        <button type="submit" class="btn-primary" ${state.loading ? "disabled" : ""}>
          Send
        </button>
      </form>
    </div>
  `;

  // Auto-scroll to bottom
  const container = document.getElementById("messages-container");
  if (container) container.scrollTop = container.scrollHeight;

  // Wire events
  document.getElementById("btn-context")?.addEventListener("click", grabPageContext);
  document.getElementById("btn-clear")?.addEventListener("click", clearConversation);

  const form = document.getElementById("chat-form") as HTMLFormElement | null;
  form?.addEventListener("submit", handleSend);

  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  input?.addEventListener("input", (e) => {
    state.input = (e.target as HTMLTextAreaElement).value;
  });
  // Enter to send (shift+enter for newline)
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form?.dispatchEvent(new Event("submit"));
    }
  });
}

// ─── Page context ────────────────────────────────────────────────────────────

async function grabPageContext(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection()?.toString();
        if (selection) return selection;
        // Fallback to page title + meta description
        const meta = document.querySelector('meta[name="description"]');
        return `${document.title}\n${(meta as HTMLMetaElement)?.content ?? ""}`.trim();
      },
    });

    if (results?.[0]?.result) {
      state.pageContext = results[0].result as string;
      render();
    }
  } catch {
    state.error = "Could not grab page context. Try refreshing the page.";
    render();
  }
}

function clearConversation(): void {
  state.messages = [];
  state.pageContext = null;
  state.error = null;
  render();
}

// ─── Send message ────────────────────────────────────────────────────────────

async function handleSend(e: Event): Promise<void> {
  e.preventDefault();
  if (!state.input.trim() || state.loading) return;

  const userMessage = state.input.trim();
  state.messages.push({ role: "user", content: userMessage, timestamp: Date.now() });
  state.input = "";
  state.loading = true;
  state.error = null;
  render();

  try {
    const { apiUrl, token } = await getSettings();

    if (!token) {
      state.error = "No access token. Open extension settings to configure.";
      state.loading = false;
      render();
      return;
    }

    const payload: Record<string, unknown> = { message: userMessage };
    if (state.pageContext) {
      payload.context = state.pageContext;
      state.pageContext = null; // Consume context once
    }

    const res = await fetch(`${apiUrl}/api/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const content = data.response ?? data.answer ?? JSON.stringify(data);
    state.messages.push({ role: "assistant", content, timestamp: Date.now() });
  } catch (err: unknown) {
    state.error = err instanceof Error ? err.message : "Unknown error";
  } finally {
    state.loading = false;
    render();
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", render);

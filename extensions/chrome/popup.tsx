/**
 * Popup — Quick ask panel for the Chrome extension.
 *
 * Renders a compact chat input that sends questions to the council
 * and displays the response inline. For full sidebar experience, the
 * user clicks "Open Sidebar".
 */

interface PopupState {
  loading: boolean;
  question: string;
  response: string | null;
  error: string | null;
}

const state: PopupState = {
  loading: false,
  question: "",
  response: null,
  error: null,
};

// ─── Settings helpers ────────────────────────────────────────────────────────

async function getSettings(): Promise<{ apiUrl: string; token: string }> {
  const result = await chrome.storage.sync.get(["apiUrl", "surfaceToken"]);
  return {
    apiUrl: result.apiUrl || "http://localhost:3000",
    token: result.surfaceToken || "",
  };
}

// ─── Render ──────────────────────────────────────────────────────────────────

function render(): void {
  const root = document.getElementById("popup-root");
  if (!root) return;

  root.innerHTML = `
    <div class="popup-container">
      <div class="popup-header">
        <h1 class="popup-title">AI by AI</h1>
        <button id="btn-sidebar" class="btn-link" title="Open full sidebar">
          &#x2197;
        </button>
      </div>

      <form id="ask-form" class="ask-form">
        <textarea
          id="question-input"
          class="ask-input"
          placeholder="Ask the council anything..."
          rows="3"
        >${state.question}</textarea>
        <button type="submit" class="btn-primary" ${state.loading ? "disabled" : ""}>
          ${state.loading ? "Thinking..." : "Ask"}
        </button>
      </form>

      ${state.error ? `<div class="error-msg">${state.error}</div>` : ""}
      ${state.response ? `<div class="response-box">${state.response}</div>` : ""}

      <div class="popup-footer">
        <a href="options.html" target="_blank" class="btn-link">Settings</a>
        <span class="shortcut-hint">Ctrl+Shift+A for sidebar</span>
      </div>
    </div>
  `;

  // Wire events
  document.getElementById("btn-sidebar")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "open-side-panel" });
  });

  const form = document.getElementById("ask-form") as HTMLFormElement | null;
  form?.addEventListener("submit", handleSubmit);

  const input = document.getElementById("question-input") as HTMLTextAreaElement | null;
  input?.addEventListener("input", (e) => {
    state.question = (e.target as HTMLTextAreaElement).value;
  });
}

// ─── Submit ──────────────────────────────────────────────────────────────────

async function handleSubmit(e: Event): Promise<void> {
  e.preventDefault();
  if (!state.question.trim() || state.loading) return;

  state.loading = true;
  state.error = null;
  state.response = null;
  render();

  try {
    const { apiUrl, token } = await getSettings();

    if (!token) {
      state.error = "No access token configured. Open Settings to add one.";
      state.loading = false;
      render();
      return;
    }

    const res = await fetch(`${apiUrl}/api/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: state.question.trim() }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    state.response = data.response ?? data.answer ?? JSON.stringify(data);
  } catch (err: unknown) {
    state.error = err instanceof Error ? err.message : "Unknown error";
  } finally {
    state.loading = false;
    render();
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", render);

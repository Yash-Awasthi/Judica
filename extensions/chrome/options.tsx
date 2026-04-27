/**
 * Options Page — settings for the Chrome extension (API URL, token).
 */

interface OptionsState {
  apiUrl: string;
  surfaceToken: string;
  saved: boolean;
  error: string | null;
}

const state: OptionsState = {
  apiUrl: "",
  surfaceToken: "",
  saved: false,
  error: null,
};

// ─── Render ──────────────────────────────────────────────────────────────────

function render(): void {
  const root = document.getElementById("options-root");
  if (!root) return;

  root.innerHTML = `
    <div class="options-container">
      <h1 class="options-title">AI by AI — Extension Settings</h1>
      <p class="options-desc">
        Configure the connection to your AI by AI instance.
        Generate a surface token from the dashboard under
        <strong>Settings &rarr; Surface Access &rarr; Chrome Extension</strong>.
      </p>

      <form id="options-form" class="options-form">
        <div class="form-group">
          <label for="api-url">API URL</label>
          <input
            type="url"
            id="api-url"
            class="form-input"
            placeholder="https://your-instance.judica.com"
            value="${state.apiUrl}"
          />
          <small class="form-hint">The base URL of your AI by AI backend.</small>
        </div>

        <div class="form-group">
          <label for="surface-token">Surface Access Token</label>
          <input
            type="password"
            id="surface-token"
            class="form-input"
            placeholder="srf_..."
            value="${state.surfaceToken}"
          />
          <small class="form-hint">
            Token starts with <code>srf_</code>. Generated from the dashboard.
          </small>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn-primary">Save Settings</button>
          <button type="button" id="btn-test" class="btn-secondary">Test Connection</button>
        </div>

        ${state.saved ? '<div class="success-msg">Settings saved.</div>' : ""}
        ${state.error ? `<div class="error-msg">${state.error}</div>` : ""}
      </form>

      <div class="options-section">
        <h2>Keyboard Shortcut</h2>
        <p>
          Press <kbd>Ctrl+Shift+A</kbd> (or <kbd>Cmd+Shift+A</kbd> on Mac)
          to open the council sidebar on any page.
        </p>
        <p>
          You can customise this shortcut in
          <code>chrome://extensions/shortcuts</code>.
        </p>
      </div>
    </div>
  `;

  // Wire events
  const form = document.getElementById("options-form") as HTMLFormElement | null;
  form?.addEventListener("submit", handleSave);

  document.getElementById("btn-test")?.addEventListener("click", handleTest);

  document.getElementById("api-url")?.addEventListener("input", (e) => {
    state.apiUrl = (e.target as HTMLInputElement).value;
    state.saved = false;
  });

  document.getElementById("surface-token")?.addEventListener("input", (e) => {
    state.surfaceToken = (e.target as HTMLInputElement).value;
    state.saved = false;
  });
}

// ─── Save ────────────────────────────────────────────────────────────────────

async function handleSave(e: Event): Promise<void> {
  e.preventDefault();
  state.error = null;

  try {
    await chrome.storage.sync.set({
      apiUrl: state.apiUrl.replace(/\/+$/, ""), // Strip trailing slashes
      surfaceToken: state.surfaceToken,
    });
    state.saved = true;
  } catch {
    state.error = "Failed to save settings.";
  }

  render();
}

// ─── Test connection ─────────────────────────────────────────────────────────

async function handleTest(): Promise<void> {
  state.error = null;
  state.saved = false;
  render();

  if (!state.apiUrl) {
    state.error = "Enter an API URL first.";
    render();
    return;
  }

  try {
    const res = await fetch(`${state.apiUrl}/api/system/health`, {
      method: "GET",
      headers: state.surfaceToken
        ? { Authorization: `Bearer ${state.surfaceToken}` }
        : {},
    });

    if (res.ok) {
      state.saved = true;
      state.error = null;
    } else {
      state.error = `Connection failed: HTTP ${res.status}`;
    }
  } catch (err: unknown) {
    state.error = `Connection failed: ${err instanceof Error ? err.message : "Network error"}`;
  }

  render();
}

// ─── Init — load saved settings ──────────────────────────────────────────────

async function init(): Promise<void> {
  const stored = await chrome.storage.sync.get(["apiUrl", "surfaceToken"]);
  state.apiUrl = stored.apiUrl ?? "";
  state.surfaceToken = stored.surfaceToken ?? "";
  render();
}

document.addEventListener("DOMContentLoaded", init);

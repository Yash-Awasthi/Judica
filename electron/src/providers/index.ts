/**
 * Injected into each AI provider's BrowserView.
 * Handles: sending a message, watching for response completion, extracting text.
 *
 * Each provider exports: { send, getLastResponse, isReady }
 * Called via webContents.executeJavaScript()
 */

// ── Shared utilities ──────────────────────────────────────────────────────────

export const PROVIDERS = ["chatgpt", "gemini", "claude"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_URLS: Record<Provider, string> = {
  chatgpt: "https://chat.openai.com",
  gemini: "https://gemini.google.com/app",
  claude: "https://claude.ai/new",
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
};

// ── Inject scripts (run inside BrowserView via executeJavaScript) ─────────────

/**
 * Returns JS string to inject into a provider page.
 * Sets window.__molecule = { send, getLastResponse, isReady }
 */
export function getInjectionScript(provider: Provider): string {
  return `
(function() {
  if (window.__molecule) return; // already injected

  const provider = "${provider}";

  // ── Selectors ────────────────────────────────────────────────────────────────
  const SELECTORS = {
    chatgpt: {
      input: '#prompt-textarea',
      sendBtn: '[data-testid="send-button"]',
      stopBtn: '[data-testid="stop-button"]',
      response: '[data-message-author-role="assistant"] .markdown',
      streamingIndicator: '[data-testid="stop-button"]',
    },
    gemini: {
      input: '.ql-editor[contenteditable="true"], rich-textarea .ql-editor, div[contenteditable="true"][data-placeholder]',
      sendBtn: 'button.send-button, button[aria-label="Send message"], button[jsname="Qx7uuf"]',
      stopBtn: 'button[aria-label="Stop response"], button[aria-label="Stop generating"]',
      response: 'message-content .markdown, model-response .markdown, .response-content',
      streamingIndicator: 'button[aria-label="Stop response"]',
    },
    claude: {
      input: '[contenteditable="true"].ProseMirror, div[contenteditable="true"][data-placeholder]',
      sendBtn: 'button[aria-label="Send Message"], button[aria-label="Send message"], button[data-value="send"]',
      stopBtn: 'button[aria-label="Stop Response"], button[aria-label="Stop"]',
      response: '.font-claude-message, [data-is-streaming] .font-claude-message',
      streamingIndicator: 'button[aria-label="Stop Response"], button[aria-label="Stop"]',
    },
  };

  const sel = SELECTORS[provider];

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function getInput() {
    // Try each comma-separated selector
    for (const s of sel.input.split(',').map(x => x.trim())) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function getSendBtn() {
    for (const s of sel.sendBtn.split(',').map(x => x.trim())) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function setInputValue(text) {
    const input = getInput();
    if (!input) return false;
    input.focus();

    if (input.tagName === 'TEXTAREA') {
      // ChatGPT: native React setter then dispatch input event
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      nativeSetter.set.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Contenteditable (Claude, Gemini)
      // Clear first
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      // Insert via execCommand — still works in Electron/Chromium 2025
      const inserted = document.execCommand('insertText', false, text);
      if (!inserted || !input.textContent.trim()) {
        // Fallback: direct innerText + synthetic InputEvent
        input.innerText = text;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }
    return true;
  }

  function clickSend() {
    return new Promise((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        const btn = getSendBtn();
        if (btn && !btn.disabled && !btn.hasAttribute('disabled')) {
          clearInterval(interval);
          btn.click();
          resolve(true);
        }
        if (++attempts > 40) { clearInterval(interval); resolve(false); }
      }, 200);
    });
  }

  function isStreaming() {
    for (const s of sel.stopBtn.split(',').map(x => x.trim())) {
      if (document.querySelector(s)) return true;
    }
    return false;
  }

  function extractLastResponse() {
    for (const s of sel.response.split(',').map(x => x.trim())) {
      const nodes = document.querySelectorAll(s);
      if (nodes.length) return nodes[nodes.length - 1].innerText.trim();
    }
    return null;
  }

  function summarize(text, maxSentences = 3) {
    if (!text) return '';
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    return sentences.slice(0, maxSentences).join(' ').trim();
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  window.__molecule = {
    isReady() {
      return !!getInput();
    },

    async send(message) {
      if (!setInputValue(message)) return { ok: false, error: 'Input not found' };
      await new Promise(r => setTimeout(r, 400));
      const sent = await clickSend();
      if (!sent) return { ok: false, error: 'Send button not found or never enabled' };
      return { ok: true };
    },

    async waitForResponse(timeoutMs = 90000) {
      const start = Date.now();

      // Wait for streaming to begin (up to 8s)
      await new Promise(r => setTimeout(r, 1500));
      let streamingStarted = false;
      for (let i = 0; i < 16; i++) {
        if (isStreaming()) { streamingStarted = true; break; }
        await new Promise(r => setTimeout(r, 500));
      }

      // Now poll for stable response
      return new Promise((resolve) => {
        let lastText = '';
        let stableCount = 0;

        const check = setInterval(() => {
          const elapsed = Date.now() - start;
          const streaming = isStreaming();
          const current = extractLastResponse();

          if (current && current !== lastText) {
            stableCount = 0;
            lastText = current;
          } else if (current && !streaming) {
            stableCount++;
            if (stableCount >= 3) {
              clearInterval(check);
              resolve({ ok: true, text: current, summary: summarize(current) });
              return;
            }
          }

          if (elapsed > timeoutMs) {
            clearInterval(check);
            resolve({ ok: !!lastText, text: lastText, summary: summarize(lastText) });
          }
        }, 500);
      });
    },

    getLastResponse() {
      const text = extractLastResponse();
      return { text, summary: summarize(text) };
    },
  };

  console.log('[Molecule] injected into', provider);
})();
`;
}

/**
 * Build the context block injected before a follow-up message.
 * Uses summaries, not full text.
 */
export function buildFollowUpMessage(
  verdictSummary: string,
  followUp: string
): string {
  return `Final verdict: "${verdictSummary}"\nFollow up: "${followUp}"`;
}

/**
 * Build the context prefix for round 2+.
 * Injected at the start of each AI's message to give cross-council context.
 */
export function buildContextBlock(
  round: number,
  opinions: Array<{ member: string; summary: string }>,
  verdictSummary: string,
  compactionSummary?: string
): string {
  const lines: string[] = [];

  if (compactionSummary) {
    lines.push(`[Earlier context]\n${compactionSummary}\n`);
  }

  lines.push(`[Round ${round} council summary]`);
  for (const op of opinions) {
    lines.push(`- ${op.member}: ${op.summary}`);
  }
  lines.push(`Verdict: ${verdictSummary}`);

  return lines.join("\n");
}

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
      input: '.ql-editor[contenteditable="true"]',
      sendBtn: '.send-button button, button[aria-label="Send message"]',
      stopBtn: 'button[aria-label="Stop response"]',
      response: 'message-content .markdown',
      streamingIndicator: 'button[aria-label="Stop response"]',
    },
    claude: {
      input: '[contenteditable="true"].ProseMirror',
      sendBtn: 'button[aria-label="Send Message"]',
      stopBtn: 'button[aria-label="Stop Response"]',
      response: '[data-is-streaming="false"] .font-claude-message',
      streamingIndicator: 'button[aria-label="Stop Response"]',
    },
  };

  const sel = SELECTORS[provider];

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function getInput() {
    return document.querySelector(sel.input);
  }

  function setInputValue(text) {
    const input = getInput();
    if (!input) return false;

    if (input.getAttribute('contenteditable')) {
      // contenteditable (Gemini, Claude)
      input.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } else {
      // textarea (ChatGPT)
      const nativeInput = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      );
      nativeInput.set.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }

  function clickSend() {
    // Wait for send button to become enabled
    return new Promise((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        const btn = document.querySelector(sel.sendBtn);
        if (btn && !btn.disabled) {
          clearInterval(interval);
          btn.click();
          resolve(true);
        }
        if (++attempts > 30) { clearInterval(interval); resolve(false); }
      }, 200);
    });
  }

  function isStreaming() {
    return !!document.querySelector(sel.stopBtn);
  }

  function extractLastResponse() {
    const responses = document.querySelectorAll(sel.response);
    if (!responses.length) return null;
    const last = responses[responses.length - 1];
    return last ? last.innerText.trim() : null;
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
      await new Promise(r => setTimeout(r, 300));
      const sent = await clickSend();
      if (!sent) return { ok: false, error: 'Send button not found' };
      return { ok: true };
    },

    async waitForResponse(timeoutMs = 60000) {
      const start = Date.now();

      // Wait for streaming to begin
      await new Promise(r => setTimeout(r, 2000));

      // Wait for streaming to finish
      return new Promise((resolve) => {
        let lastText = '';
        let stableCount = 0;

        const check = setInterval(() => {
          const elapsed = Date.now() - start;
          const streaming = isStreaming();
          const current = extractLastResponse();

          if (!streaming && current && current === lastText) {
            stableCount++;
            if (stableCount >= 3) { // stable for ~1.5s
              clearInterval(check);
              resolve({ ok: true, text: current, summary: summarize(current) });
            }
          } else {
            stableCount = 0;
            lastText = current || '';
          }

          if (elapsed > timeoutMs) {
            clearInterval(check);
            resolve({ ok: true, text: lastText, summary: summarize(lastText) });
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

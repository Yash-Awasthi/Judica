/**
 * Content Script — injected into every page to extract context for the council.
 *
 * Listens for messages from the popup/sidepanel to:
 *   1. Get the current page text content (or selection).
 *   2. Get page metadata (title, URL, meta tags).
 *   3. Highlight elements the council references.
 */

// ─── Message types ───────────────────────────────────────────────────────────

interface GetContextRequest {
  type: "get-page-context";
}

interface GetContextResponse {
  type: "page-context";
  data: {
    url: string;
    title: string;
    selection: string;
    metaDescription: string;
    textContent: string;
  };
}

type ContentMessage = GetContextRequest;

// ─── Listener ────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: ContentMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: GetContextResponse) => void,
  ) => {
    if (message.type === "get-page-context") {
      const selection = window.getSelection()?.toString() ?? "";
      const meta = document.querySelector('meta[name="description"]');
      const metaDescription = (meta as HTMLMetaElement)?.content ?? "";

      // Truncate body text to avoid blowing up memory
      const MAX_TEXT_LENGTH = 8000;
      const bodyText = document.body?.innerText?.slice(0, MAX_TEXT_LENGTH) ?? "";

      sendResponse({
        type: "page-context",
        data: {
          url: window.location.href,
          title: document.title,
          selection,
          metaDescription,
          textContent: bodyText,
        },
      });

      return true; // Indicates async response
    }

    return false;
  },
);

// ─── Keyboard shortcut passthrough ───────────────────────────────────────────

// Listen for the global shortcut that the background script handles.
// No additional logic needed here; the background service worker manages
// the side panel toggle via chrome.sidePanel.open().

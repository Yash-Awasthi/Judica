/**
 * AIBYAI Chrome Extension — Service Worker (Manifest V3)
 *
 * Handles side panel toggle, omnibox search, context menu actions,
 * and text selection relay to the side panel.
 *
 * Modeled after onyx-chrome-extension service worker.
 */

/* global chrome */

// ─── Side Panel Toggle ─────────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-side-panel") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  }
});

// ─── Context Menu ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "aibyai-search",
    title: "Search AIBYAI for \"%s\"",
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "aibyai-summarize",
    title: "Summarize with AIBYAI",
    contexts: ["page", "selection"],
  });

  chrome.contextMenus.create({
    id: "aibyai-deliberate",
    title: "Start deliberation on \"%s\"",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  // Open side panel first
  await chrome.sidePanel.open({ tabId: tab.id });

  // Small delay to ensure panel is ready
  setTimeout(() => {
    const message = {
      type: info.menuItemId,
      text: info.selectionText || "",
      pageUrl: info.pageUrl || tab.url || "",
      pageTitle: tab.title || "",
    };
    chrome.runtime.sendMessage(message).catch(() => {
      // Panel may not be ready yet — store for later
      chrome.storage.session.set({ pendingAction: message });
    });
  }, 500);
});

// ─── Omnibox Search ────────────────────────────────────────────────

chrome.omnibox.onInputEntered.addListener(async (text) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await chrome.sidePanel.open({ tabId: tab.id });

    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: "aibyai-search",
        text,
      }).catch(() => {
        chrome.storage.session.set({
          pendingAction: { type: "aibyai-search", text },
        });
      });
    }, 500);
  }
});

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  if (text.length > 2) {
    suggest([
      { content: text, description: `Search AIBYAI for "${text}"` },
      { content: `summarize: ${text}`, description: `Summarize: "${text}"` },
    ]);
  }
});

// ─── Message Relay (from content scripts or popup) ─────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "get-selected-text") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ text: "" });
        return;
      }
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => window.getSelection()?.toString() || "",
        });
        sendResponse({ text: result?.result || "" });
      } catch {
        sendResponse({ text: "" });
      }
    });
    return true; // async response
  }
});

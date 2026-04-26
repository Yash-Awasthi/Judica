/**
 * Background Service Worker — handles keyboard shortcuts, context menus,
 * and side panel management for the Chrome extension.
 */

// ─── Keyboard shortcut: Ctrl+Shift+A → open side panel ──────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-council") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  }
});

// ─── Message handler for popup → background communication ────────────────────

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === "open-side-panel") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.sidePanel.open({ tabId: tab.id });
      }
    });
  }
  return false;
});

// ─── Context menu: "Ask AI Council" on text selection ────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ask-council",
    title: 'Ask AI Council: "%s"',
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "ask-council" && info.selectionText && tab?.id) {
    // Store the selected text so the side panel can pick it up
    await chrome.storage.session.set({
      pendingQuestion: info.selectionText,
      pendingTimestamp: Date.now(),
    });
    // Open the side panel
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ─── Side panel behaviour ────────────────────────────────────────────────────

// Enable the side panel for all tabs
chrome.sidePanel.setOptions({
  enabled: true,
});

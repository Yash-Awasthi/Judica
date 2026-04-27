/**
 * Embeddable Widget Loader — lightweight (~5KB) script that creates an iframe
 * pointing to the widget frame hosted on the AI by AI backend.
 *
 * Usage:
 *   <script src="https://your-instance.judica.com/api/surfaces/embed.js"
 *           data-api-key="wgt_..."
 *           data-theme="dark"
 *           data-position="bottom-right"></script>
 *
 * The script reads configuration from data attributes and injects a floating
 * iframe that communicates with the host via postMessage.
 */

(function () {
  "use strict";

  // ─── Configuration ─────────────────────────────────────────────────────────

  const SCRIPT_TAG =
    document.currentScript as HTMLScriptElement | null ??
    document.querySelector<HTMLScriptElement>("script[data-api-key]");

  if (!SCRIPT_TAG) {
    console.error("[judica-widget] Script tag not found. Ensure data-api-key is set.");
    return;
  }

  const API_KEY = SCRIPT_TAG.getAttribute("data-api-key") ?? "";
  const THEME = SCRIPT_TAG.getAttribute("data-theme") ?? "auto";
  const POSITION = SCRIPT_TAG.getAttribute("data-position") ?? "bottom-right";
  const RAW_API_URL = SCRIPT_TAG.getAttribute("data-api-url") ?? SCRIPT_TAG.src.replace(/\/api\/surfaces\/embed\.js.*$/, "");

  // Validate API_URL is a safe https:// or http:// URL to prevent XSS via javascript: URLs
  let API_URL: string;
  try {
    const parsed = new URL(RAW_API_URL);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      console.error("[judica-widget] Invalid data-api-url protocol.");
      return;
    }
    API_URL = parsed.origin;
  } catch {
    console.error("[judica-widget] Invalid data-api-url.");
    return;
  }

  if (!API_KEY) {
    console.error("[judica-widget] data-api-key is required.");
    return;
  }

  // ─── Styles ────────────────────────────────────────────────────────────────

  const isRight = POSITION === "bottom-right";

  const LAUNCHER_SIZE = 56;
  const WIDGET_WIDTH = 380;
  const WIDGET_HEIGHT = 520;
  const MARGIN = 16;

  const style = document.createElement("style");
  style.textContent = `
    #judica-widget-launcher {
      position: fixed;
      bottom: ${MARGIN}px;
      ${isRight ? "right" : "left"}: ${MARGIN}px;
      width: ${LAUNCHER_SIZE}px;
      height: ${LAUNCHER_SIZE}px;
      border-radius: 50%;
      background: #6366f1;
      color: white;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      transition: transform 0.15s, background 0.15s;
    }
    #judica-widget-launcher:hover {
      transform: scale(1.08);
      background: #818cf8;
    }
    #judica-widget-frame {
      position: fixed;
      bottom: ${MARGIN + LAUNCHER_SIZE + 12}px;
      ${isRight ? "right" : "left"}: ${MARGIN}px;
      width: ${WIDGET_WIDTH}px;
      height: ${WIDGET_HEIGHT}px;
      border: none;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25);
      z-index: 2147483647;
      display: none;
      background: transparent;
    }
    #judica-widget-frame.open {
      display: block;
    }
  `;
  document.head.appendChild(style);

  // ─── Launcher button ───────────────────────────────────────────────────────

  const launcher = document.createElement("button");
  launcher.id = "judica-widget-launcher";
  launcher.setAttribute("aria-label", "Open AI chat");
  launcher.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  document.body.appendChild(launcher);

  // ─── Widget iframe ─────────────────────────────────────────────────────────

  const iframe = document.createElement("iframe");
  iframe.id = "judica-widget-frame";
  iframe.setAttribute("allow", "clipboard-write");
  iframe.src = `${API_URL}/api/surfaces/widget-frame?apiKey=${encodeURIComponent(API_KEY)}&theme=${encodeURIComponent(THEME)}&origin=${encodeURIComponent(window.location.origin)}`;
  document.body.appendChild(iframe);

  let isOpen = false;

  launcher.addEventListener("click", () => {
    isOpen = !isOpen;
    iframe.classList.toggle("open", isOpen);
    launcher.innerHTML = isOpen
      ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
      : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  });

  // ─── PostMessage bridge ────────────────────────────────────────────────────

  window.addEventListener("message", (event) => {
    if (event.source !== iframe.contentWindow) return;

    const data = event.data;
    if (data?.type === "judica-widget-close") {
      isOpen = false;
      iframe.classList.remove("open");
    }
    if (data?.type === "judica-widget-resize") {
      iframe.style.height = `${Math.min(data.height ?? WIDGET_HEIGHT, 700)}px`;
    }
  });
})();

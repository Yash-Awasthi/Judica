/**
 * Widget Styles — Shadow DOM styles for the embeddable chat widget.
 */

import type { WidgetTheme } from "./models.js";
import { DEFAULT_THEME } from "./models.js";

export function generateWidgetStyles(theme: Partial<WidgetTheme> = {}): string {
  const t = { ...DEFAULT_THEME, ...theme };

  return `
    :host {
      --judica-primary: ${t.primaryColor};
      --judica-bg: ${t.backgroundColor};
      --judica-text: ${t.textColor};
      --judica-border: ${t.borderColor};
      --judica-input-bg: ${t.inputBackground};
      --judica-user-bubble: ${t.userBubbleColor};
      --judica-assistant-bubble: ${t.assistantBubbleColor};
      --judica-font: ${t.fontFamily};
      --judica-font-size: ${t.fontSize};
      --judica-radius: ${t.borderRadius};

      font-family: var(--judica-font);
      font-size: var(--judica-font-size);
      color: var(--judica-text);
    }

    .judica-widget-container {
      display: flex;
      flex-direction: column;
      background: var(--judica-bg);
      border: 1px solid var(--judica-border);
      border-radius: var(--judica-radius);
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
    }

    .judica-widget-container.floating {
      position: fixed;
      width: 380px;
      height: 560px;
      z-index: 99999;
    }

    .judica-widget-container.floating.bottom-right {
      bottom: 80px;
      right: 20px;
    }

    .judica-widget-container.floating.bottom-left {
      bottom: 80px;
      left: 20px;
    }

    .judica-widget-container.inline {
      width: 100%;
      height: 100%;
      min-height: 400px;
    }

    /* Header */
    .judica-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--judica-primary);
      color: white;
      font-weight: 600;
    }

    .judica-header-close {
      cursor: pointer;
      background: none;
      border: none;
      color: white;
      font-size: 18px;
      padding: 4px;
    }

    /* Messages */
    .judica-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .judica-message {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 16px;
      line-height: 1.5;
      word-wrap: break-word;
    }

    .judica-message.user {
      align-self: flex-end;
      background: var(--judica-user-bubble);
      color: white;
      border-bottom-right-radius: 4px;
    }

    .judica-message.assistant {
      align-self: flex-start;
      background: var(--judica-assistant-bubble);
      color: var(--judica-text);
      border-bottom-left-radius: 4px;
    }

    .judica-sources {
      margin-top: 8px;
      font-size: 12px;
      opacity: 0.8;
    }

    .judica-source-link {
      color: var(--judica-primary);
      text-decoration: none;
    }

    .judica-source-link:hover {
      text-decoration: underline;
    }

    /* Input */
    .judica-input-area {
      display: flex;
      padding: 12px;
      border-top: 1px solid var(--judica-border);
      gap: 8px;
    }

    .judica-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--judica-border);
      border-radius: 20px;
      background: var(--judica-input-bg);
      font-family: var(--judica-font);
      font-size: var(--judica-font-size);
      outline: none;
      resize: none;
    }

    .judica-input:focus {
      border-color: var(--judica-primary);
    }

    .judica-send {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: var(--judica-primary);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }

    .judica-send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Floating launcher button */
    .judica-launcher {
      position: fixed;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--judica-primary);
      color: white;
      border: none;
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      z-index: 99998;
      transition: transform 0.2s;
    }

    .judica-launcher:hover {
      transform: scale(1.1);
    }

    .judica-launcher.bottom-right {
      bottom: 20px;
      right: 20px;
    }

    .judica-launcher.bottom-left {
      bottom: 20px;
      left: 20px;
    }

    /* Streaming indicator */
    .judica-typing {
      display: inline-flex;
      gap: 4px;
      padding: 8px 12px;
    }

    .judica-typing-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--judica-text);
      opacity: 0.4;
      animation: judica-bounce 1.4s infinite ease-in-out;
    }

    .judica-typing-dot:nth-child(1) { animation-delay: 0s; }
    .judica-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .judica-typing-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes judica-bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
    }

    .hidden { display: none !important; }
  `;
}

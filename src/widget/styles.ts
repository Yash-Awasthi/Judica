/**
 * Widget Styles — Shadow DOM styles for the embeddable chat widget.
 */

import type { WidgetTheme } from "./models.js";
import { DEFAULT_THEME } from "./models.js";

export function generateWidgetStyles(theme: Partial<WidgetTheme> = {}): string {
  const t = { ...DEFAULT_THEME, ...theme };

  return `
    :host {
      --aibyai-primary: ${t.primaryColor};
      --aibyai-bg: ${t.backgroundColor};
      --aibyai-text: ${t.textColor};
      --aibyai-border: ${t.borderColor};
      --aibyai-input-bg: ${t.inputBackground};
      --aibyai-user-bubble: ${t.userBubbleColor};
      --aibyai-assistant-bubble: ${t.assistantBubbleColor};
      --aibyai-font: ${t.fontFamily};
      --aibyai-font-size: ${t.fontSize};
      --aibyai-radius: ${t.borderRadius};

      font-family: var(--aibyai-font);
      font-size: var(--aibyai-font-size);
      color: var(--aibyai-text);
    }

    .aibyai-widget-container {
      display: flex;
      flex-direction: column;
      background: var(--aibyai-bg);
      border: 1px solid var(--aibyai-border);
      border-radius: var(--aibyai-radius);
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
    }

    .aibyai-widget-container.floating {
      position: fixed;
      width: 380px;
      height: 560px;
      z-index: 99999;
    }

    .aibyai-widget-container.floating.bottom-right {
      bottom: 80px;
      right: 20px;
    }

    .aibyai-widget-container.floating.bottom-left {
      bottom: 80px;
      left: 20px;
    }

    .aibyai-widget-container.inline {
      width: 100%;
      height: 100%;
      min-height: 400px;
    }

    /* Header */
    .aibyai-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--aibyai-primary);
      color: white;
      font-weight: 600;
    }

    .aibyai-header-close {
      cursor: pointer;
      background: none;
      border: none;
      color: white;
      font-size: 18px;
      padding: 4px;
    }

    /* Messages */
    .aibyai-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .aibyai-message {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 16px;
      line-height: 1.5;
      word-wrap: break-word;
    }

    .aibyai-message.user {
      align-self: flex-end;
      background: var(--aibyai-user-bubble);
      color: white;
      border-bottom-right-radius: 4px;
    }

    .aibyai-message.assistant {
      align-self: flex-start;
      background: var(--aibyai-assistant-bubble);
      color: var(--aibyai-text);
      border-bottom-left-radius: 4px;
    }

    .aibyai-sources {
      margin-top: 8px;
      font-size: 12px;
      opacity: 0.8;
    }

    .aibyai-source-link {
      color: var(--aibyai-primary);
      text-decoration: none;
    }

    .aibyai-source-link:hover {
      text-decoration: underline;
    }

    /* Input */
    .aibyai-input-area {
      display: flex;
      padding: 12px;
      border-top: 1px solid var(--aibyai-border);
      gap: 8px;
    }

    .aibyai-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--aibyai-border);
      border-radius: 20px;
      background: var(--aibyai-input-bg);
      font-family: var(--aibyai-font);
      font-size: var(--aibyai-font-size);
      outline: none;
      resize: none;
    }

    .aibyai-input:focus {
      border-color: var(--aibyai-primary);
    }

    .aibyai-send {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: var(--aibyai-primary);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }

    .aibyai-send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Floating launcher button */
    .aibyai-launcher {
      position: fixed;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--aibyai-primary);
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

    .aibyai-launcher:hover {
      transform: scale(1.1);
    }

    .aibyai-launcher.bottom-right {
      bottom: 20px;
      right: 20px;
    }

    .aibyai-launcher.bottom-left {
      bottom: 20px;
      left: 20px;
    }

    /* Streaming indicator */
    .aibyai-typing {
      display: inline-flex;
      gap: 4px;
      padding: 8px 12px;
    }

    .aibyai-typing-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--aibyai-text);
      opacity: 0.4;
      animation: aibyai-bounce 1.4s infinite ease-in-out;
    }

    .aibyai-typing-dot:nth-child(1) { animation-delay: 0s; }
    .aibyai-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .aibyai-typing-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes aibyai-bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
    }

    .hidden { display: none !important; }
  `;
}

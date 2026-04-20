import logger from "../../logger.js";
import { BaseProvider } from "../baseProvider.js";
import type { ProviderConfig, ProviderResponse, Message } from "../types.js";
import fs from "fs";
import path from "path";

let playwright: typeof import("playwright") | null = null;

interface RPATarget {
  name: "chatgpt" | "claude" | "deepseek" | "gemini";
  url: string;
  newChatUrl: string;
  inputSelectors: string[];
  responseSelectors: string[];
  loginIndicators: string[];
}

const RPA_TARGETS: Record<string, RPATarget> = {
  chatgpt: {
    name: "chatgpt",
    url: "https://chat.openai.com",
    newChatUrl: "https://chat.openai.com/?model=gpt-4",
    inputSelectors: [
      '#prompt-textarea',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Ask"]',
      'textarea',
      '[contenteditable="true"]',
      'div[role="textbox"]',
    ],
    responseSelectors: [
      '[data-message-author-role="assistant"]',
      '[data-testid="conversation-turn-2"] .markdown',
      '.markdown',
      '.prose',
      '[data-testid*="response"]',
      '.message-content',
      '[class*="assistant"]',
    ],
    loginIndicators: [
      'input[type="email"]',
      'input[name="username"]',
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      'button:has-text("Continue")',
      'button:has-text("Verify")',
      'button:has-text("Confirm")',
      '[data-testid="login-button"]',
      'text=Log in',
      'text=Sign in',
      'text=Verify your email',
      'text=Security check',
    ],
  },
  claude: {
    name: "claude",
    url: "https://claude.ai",
    newChatUrl: "https://claude.ai/chat",
    inputSelectors: [
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Ask"]',
      'textarea',
      '[contenteditable="true"]',
      'div[role="textbox"]',
    ],
    responseSelectors: [
      '.font-claude-message',
      '.prose',
      '.markdown',
      '[data-testid*="assistant"]',
      '[class*="assistant-message"]',
    ],
    loginIndicators: [
      'input[type="email"]',
      'button:has-text("Sign in")',
      'button:has-text("Continue with email")',
      'button:has-text("Sign up")',
      'button:has-text("Verify")',
      'text=Sign in',
      'text=Verify',
      'text=Security check',
    ],
  },
  deepseek: {
    name: "deepseek",
    url: "https://chat.deepseek.com",
    newChatUrl: "https://chat.deepseek.com",
    inputSelectors: [
      'textarea#chat-input',
      'textarea[placeholder*="Message"]',
      'textarea',
    ],
    responseSelectors: [
      '.ds-markdown--block',
      '[class*="assistant"]',
      '.ds-message-row--assistant',
    ],
    loginIndicators: [
      'a[href*="/sign-in"]',
      'button:has-text("Log in")',
      'button:has-text("Sign up")',
      'text=Sign in',
      'text=Log in',
    ],
  },
  gemini: {
    name: "gemini",
    url: "https://gemini.google.com",
    newChatUrl: "https://gemini.google.com/app",
    inputSelectors: [
      'div[aria-label="Enter a prompt for Gemini"] .ql-editor',
      'div[contenteditable="true"]',
      'textarea[placeholder*="Enter a prompt"]',
    ],
    responseSelectors: [
      'div.model-response-text',
      'div.message-content',
      '[data-testid*="response"]',
    ],
    loginIndicators: [
      'a[aria-label="Sign in"]',
      'button:has-text("Sign in")',
      'text=Sign in',
    ],
  },
};

let globalBrowser: import("playwright").Browser | null = null;
let browserLaunchPromise: Promise<import("playwright").Browser> | null = null;

async function getBrowser(): Promise<import("playwright").Browser> {
  if (globalBrowser) {
    try { await globalBrowser.version(); return globalBrowser; } catch { globalBrowser = null; }
  }
  if (browserLaunchPromise) return browserLaunchPromise;
  browserLaunchPromise = launchBrowser();
  globalBrowser = await browserLaunchPromise;
  browserLaunchPromise = null;
  return globalBrowser;
}

async function launchBrowser(): Promise<import("playwright").Browser> {
  if (!playwright) playwright = await import("playwright");
  logger.info("Launching headless Chromium for RPA");
  return await playwright.chromium.launch({
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", 
      "--disable-gpu", "--disable-web-security"
    ],
  });
}

export class RPAProvider extends BaseProvider {
  private target: RPATarget;
  private sessionDir: string;
  private readonly SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

  constructor(config: ProviderConfig) {
    super(config);
    const targetName = config.model as keyof typeof RPA_TARGETS; 
    this.target = RPA_TARGETS[targetName];
    if (!this.target) throw new Error(`Unknown RPA target: ${targetName}`);
    
    const safeUserId = String(config.userId || "default").replace(/[^a-zA-Z0-9_-]/g, "");
    this.sessionDir = path.resolve(`./sessions/${safeUserId}`);
    
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private get sessionPath(): string {
    return path.join(this.sessionDir, `${this.target.name}.json`);
  }

  private lazyCleanup(): void {
    try {
      if (fs.existsSync(this.sessionPath)) {
        const stats = fs.statSync(this.sessionPath);
        const age = Date.now() - stats.mtimeMs;
        if (age > this.SESSION_TTL_MS) {
          logger.info({ path: this.sessionPath }, "Deleting stale RPA session file");
          fs.unlinkSync(this.sessionPath);
        }
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Failed during lazy RPA session cleanup");
    }
  }

  async call({ prompt, messages, signal, maxTokens, isFallback: _isFallback, onChunk }: {
    messages: Message[];
    prompt?: string;
    signal?: AbortSignal;
    maxTokens?: number;
    isFallback?: boolean;
    onChunk?: (chunk: string) => void;
  }): Promise<ProviderResponse> {
    const lastMessage = messages[messages.length - 1];
    const lastContent = lastMessage.content;
    const finalPrompt = prompt || (Array.isArray(lastContent) ? JSON.stringify(lastContent) : lastContent);
    
    this.lazyCleanup(); // Perform lazy cleanup before access

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await this.generateOnce(finalPrompt, maxTokens || 60000, signal, onChunk);
        const usage = {
          promptTokens: Math.ceil(finalPrompt.length / 4),
          completionTokens: Math.ceil(text.length / 4),
          totalTokens: Math.ceil((finalPrompt.length + text.length) / 4)
        };
        return { text, usage };
      } catch (err) {
        if (signal?.aborted) throw err;
        if (attempt === 2) throw new Error(`RPA failed after 2 attempts: ${(err as Error).message}`, { cause: err });
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    throw new Error("RPA failed unexpectedly");
  }

  private async generateOnce(prompt: string, timeoutMs: number, externalSignal?: AbortSignal, onChunk?: (chunk: string) => void): Promise<string> {
    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortSignal = controller.signal;

    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      externalSignal.addEventListener("abort", () => controller.abort());
    }
    
    let page: import("playwright").Page | null = null;
    let context: import("playwright").BrowserContext | null = null;

    try {
      const browser = await getBrowser();
      context = await browser.newContext({
        storageState: fs.existsSync(this.sessionPath) ? this.sessionPath : undefined,
      });

      page = await context.newPage();
      await page.goto(this.target.newChatUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      
      const loginRequired = await this.checkLogin(page);
      if (loginRequired) throw new Error(`Login required for ${this.target.name}`);

      const input = await this.findInput(page);
      await input.fill(prompt);
      await input.press("Enter");

      const response = await this.waitForResponse(page, abortSignal, timeoutMs - 15000, onChunk);
      await context.storageState({ path: this.sessionPath }); // Save session
      return response;
    } finally {
      clearTimeout(abortTimeout);
      await page?.close().catch(() => {});
      await context?.close().catch(() => {});
    }
  }

  private async checkLogin(page: import("playwright").Page): Promise<boolean> {
    for (const selector of this.target.loginIndicators) {
      if (await page.locator(selector).first().isVisible({ timeout: 500 }).catch(() => false)) return true;
    }
    return false;
  }

  private async findInput(page: import("playwright").Page): Promise<import("playwright").Locator> {
    for (const selector of this.target.inputSelectors) {
      const el = page.locator(selector).first();
      try {
        await el.waitFor({ state: "visible", timeout: 2000 });
        return el;
      } catch { continue; }
    }
    throw new Error("Input not found");
  }

  private async waitForResponse(page: import("playwright").Page, abortSignal: AbortSignal, timeout: number, onChunk?: (chunk: string) => void): Promise<string> {
    const start = Date.now();
    let last = "";
    let stable = 0;
    while (Date.now() - start < timeout) {
      if (abortSignal.aborted) throw new Error("Aborted");
      let current = "";
      for (const sel of this.target.responseSelectors) {
        const text = await page.locator(sel).last().textContent().catch(() => "");
        if (text && text.trim().length > current.length) current = text.trim();
      }

      if (current !== last && current.length > last.length) {
        if (onChunk) {
          onChunk(current.slice(last.length));
        }
      }

      if (current && current === last) stable++; else stable = 0;
      if (stable >= 4) return current;
      last = current;
      await page.waitForTimeout(500);
    }
    return last;
  }

  async healthCheck(): Promise<boolean> {
    try { const b = await getBrowser(); return !!(await b.version()); } catch { return false; }
  }
}

import {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  session,
  shell,
  protocol,
  net,
} from "electron";
import path from "path";
import { pathToFileURL } from "url";
import { randomUUID } from "crypto";
import {
  getDb,
  createThread,
  updateThreadTitle,
  listThreads,
  deleteThread,
  insertMessage,
  getThreadMessages,
  getCompaction,
  upsertCompaction,
  getMemory,
  setMemory,
} from "../db";
import {
  PROVIDERS,
  PROVIDER_URLS,
  Provider,
  getInjectionScript,
  buildFollowUpMessage,
  buildContextBlock,
} from "../providers";

// ── Constants ────────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV === "development";

// Remove Electron's webdriver flag so Google OAuth doesn't block sign-in
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");

// Register app:// protocol so React Router sees pathname "/" instead of the
// full file path (which would match no routes and render a black screen).
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const UI_URL = isDev ? "http://localhost:5173" : "app://localhost/";

// Script injected into every login window to hide automation signals
const WEBDRIVER_PATCH = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = window.chrome || { runtime: {}, app: {}, csi: () => {}, loadTimes: () => {} };
`;

const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 900;
const SIDEBAR_WIDTH = 260; // history panel

// ── State ────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow;
const views: Partial<Record<Provider, BrowserView>> = {};
let glassMode = false;
let activeProviders: Provider[] = ["chatgpt", "gemini", "claude"];

// Council members config (synced from renderer via IPC)
interface CouncilMember {
  id: string;
  label: string;
  enabled: boolean;
  mode: "browser" | "api";
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  /** API-mode only: enable extended reasoning (Anthropic thinking / o1 models / Gemini flash-thinking) */
  deepThinking?: boolean;
  /** API-mode only: enable web search tool (Anthropic search / Gemini google_search / GPT-4o-search) */
  webSearch?: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
};

let councilMembers: CouncilMember[] = [
  { id: "chatgpt", label: "ChatGPT", enabled: true, mode: "browser", provider: "openai",    model: "gpt-4o",    apiKey: "", baseUrl: "https://api.openai.com/v1" },
  { id: "gemini",  label: "Gemini",  enabled: true, mode: "browser", provider: "gemini",    model: "gemini-2.0-flash", apiKey: "", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "claude",  label: "Claude",  enabled: true, mode: "browser", provider: "anthropic", model: "claude-3-5-sonnet-20241022", apiKey: "", baseUrl: "https://api.anthropic.com" },
];

// Verdict rotation: which member generates the verdict each round
let verdictIndex = 0;

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Serve built frontend via app:// so React Router sees "/" as pathname
  if (!isDev) {
    const uiDir = app.isPackaged
      ? path.join(process.resourcesPath, "ui")
      : path.join(__dirname, "../../../frontend/build/client");

    protocol.handle("app", (req) => {
      const { pathname } = new URL(req.url);
      // For SPA: any path that isn't a static asset gets index.html
      const assetPath = path.join(uiDir, pathname);
      const target = pathname.includes(".") ? assetPath : path.join(uiDir, "index.html");
      return net.fetch(pathToFileURL(target).toString());
    });
  }

  getDb(); // initialize SQLite
  createMainWindow();
  createProviderViews();
  registerIPC();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

// ── Main window ───────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(UI_URL);

  mainWindow.on("resize", () => updateViewBounds());

  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}

// ── BrowserViews (AI provider panels) ────────────────────────────────────────

// Plain Chrome UA — avoids Google blocking OAuth/sign-in in Electron windows
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function createProviderViews() {
  for (const provider of PROVIDERS) {
    // Each provider gets its own persistent session (cookies/login saved)
    const ses = session.fromPartition(`persist:${provider}`);
    ses.setUserAgent(CHROME_UA);

    const view = new BrowserView({
      webPreferences: {
        session: ses,
        contextIsolation: false, // needed for window.__molecule injection
        nodeIntegration: false,
      },
    });

    view.webContents.loadURL(PROVIDER_URLS[provider]);

    // Inject molecule API after every page load
    view.webContents.on("did-finish-load", () => {
      view.webContents.executeJavaScript(getInjectionScript(provider));
    });

    // Prevent navigation away from the AI sites
    view.webContents.on("will-navigate", (event, url) => {
      const allowed = PROVIDER_URLS[provider];
      if (!url.startsWith(allowed.split("/app")[0].split("/new")[0])) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });

    views[provider] = view;
  }
}

function updateViewBounds() {
  if (!mainWindow || !glassMode) return;
  const [w, h] = mainWindow.getContentSize();
  const activeCount = activeProviders.length;
  if (activeCount === 0) return;

  // Glass mode: split the right portion of the window between AI panels
  const panelAreaX = SIDEBAR_WIDTH;
  const panelWidth = Math.floor((w - SIDEBAR_WIDTH) / activeCount);

  activeProviders.forEach((provider, i) => {
    const view = views[provider];
    if (!view) return;
    if (!mainWindow.getBrowserViews().includes(view)) {
      mainWindow.addBrowserView(view);
    }
    view.setBounds({
      x: panelAreaX + i * panelWidth,
      y: 0,
      width: panelWidth,
      height: h,
    });
  });
}

function showGlass() {
  glassMode = true;
  for (const provider of activeProviders) {
    const view = views[provider];
    if (view && !mainWindow.getBrowserViews().includes(view)) {
      mainWindow.addBrowserView(view);
    }
  }
  updateViewBounds();
}

function hideGlass() {
  glassMode = false;
  for (const view of Object.values(views)) {
    if (view) mainWindow.removeBrowserView(view);
  }
}

// ── Deliberation logic ────────────────────────────────────────────────────────

async function waitForReady(provider: Provider, maxMs = 10000): Promise<boolean> {
  const view = views[provider];
  if (!view) return false;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const ready = await view.webContents.executeJavaScript(
        "window.__molecule ? window.__molecule.isReady() : false"
      );
      if (ready) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

async function sendToProvider(
  provider: Provider,
  message: string
): Promise<{ ok: boolean; text?: string; summary?: string; error?: string }> {
  const view = views[provider];
  if (!view) return { ok: false, error: "Provider view not found" };

  try {
    // Ensure script is injected
    await view.webContents.executeJavaScript(getInjectionScript(provider));
    const ready = await waitForReady(provider);
    if (!ready) return { ok: false, error: "Page not ready" };

    const sendResult = await view.webContents.executeJavaScript(
      `window.__molecule.send(${JSON.stringify(message)})`
    );
    if (!sendResult.ok) return sendResult;

    const response = await view.webContents.executeJavaScript(
      `window.__molecule.waitForResponse(90000)`
    );
    return response;
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── API-based send (for non-browser members) ──────────────────────────────────

async function sendToApi(
  member: CouncilMember,
  message: string
): Promise<{ ok: boolean; text?: string; summary?: string; error?: string }> {
  try {
    // ── Anthropic ──────────────────────────────────────────────────────────────
    if (member.provider === "anthropic") {
      const betaHeaders: string[] = [];
      const body: any = {
        model: member.model,
        max_tokens: member.deepThinking ? 16000 : 2048,
        messages: [{ role: "user", content: message }],
      };

      if (member.deepThinking) {
        // Extended thinking — requires interleaved-thinking beta + max_tokens ≥ budget
        body.thinking = { type: "enabled", budget_tokens: 10000 };
        betaHeaders.push("interleaved-thinking-2025-05-14");
      }

      if (member.webSearch) {
        body.tools = [{ type: "web_search_20250305" }];
        betaHeaders.push("web-search-2025-03-05");
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": member.apiKey,
        "anthropic-version": "2023-06-01",
      };
      if (betaHeaders.length) headers["anthropic-beta"] = betaHeaders.join(",");

      const res = await fetch(`${member.baseUrl}/v1/messages`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.text();
        return { ok: false, error: `Anthropic API error ${res.status}: ${err.slice(0, 200)}` };
      }
      const data: any = await res.json();
      // Filter out thinking blocks — only return text blocks
      const text = (data.content as any[] ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text as string)
        .join("") || data.content?.[0]?.text || "";
      return { ok: true, text, summary: text.slice(0, 200) };
    }

    // ── OpenAI / Gemini (OpenAI-compatible) ───────────────────────────────────
    let model = member.model;
    const tools: any[] = [];

    if (member.provider === "openai") {
      if (member.deepThinking) model = "o3-mini"; // switch to reasoning model
      else if (member.webSearch) model = "gpt-4o-search-preview"; // built-in search
    } else if (member.provider === "gemini") {
      if (member.deepThinking) model = "gemini-2.0-flash-thinking-exp";
      if (member.webSearch) tools.push({ google_search: {} });
    }

    const baseUrl = member.baseUrl.replace(/\/$/, "");
    const url = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl}/chat/completions`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (member.apiKey) headers["Authorization"] = `Bearer ${member.apiKey}`;

    const reqBody: any = {
      model,
      messages: [{ role: "user", content: message }],
      stream: false,
    };
    if (tools.length) reqBody.tools = tools;

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(reqBody) });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `API error ${res.status}: ${err.slice(0, 200)}` };
    }

    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    return { ok: true, text, summary: text.slice(0, 200) };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Unified send — routes to browser or API ───────────────────────────────────

async function sendToMember(
  member: CouncilMember,
  message: string
): Promise<{ ok: boolean; text?: string; summary?: string; error?: string }> {
  if (member.mode === "browser") {
    const browserId = member.id as Provider;
    if (views[browserId]) return sendToProvider(browserId, message);
    return { ok: false, error: `No browser view for ${member.id}` };
  }
  return sendToApi(member, message);
}

async function runDeliberation(
  threadId: string,
  userMessage: string,
  round: number,
  isFollowUp: boolean,
  previousOpinions?: Array<{ member: string; summary: string }>,
  previousVerdictSummary?: string,
  compactionSummary?: string
) {
  // Notify UI that deliberation started
  mainWindow.webContents.send("deliberation:started", { threadId, round });

  // Build the message to inject
  let messageToSend = userMessage;

  if (isFollowUp && previousOpinions && previousVerdictSummary) {
    const contextBlock = buildContextBlock(
      round - 1,
      previousOpinions,
      previousVerdictSummary,
      compactionSummary
    );
    messageToSend = buildFollowUpMessage(previousVerdictSummary, userMessage);
    // Prepend context (only on round 2+ for each AI's own awareness)
    messageToSend = `${contextBlock}\n\n${messageToSend}`;
  }

  // Add user memory prefix if set
  const memory = getMemory();
  if (memory) {
    messageToSend = `[Context about me: ${memory}]\n\n${messageToSend}`;
  }

  // Send to all enabled council members in parallel
  const opinions: Array<{
    provider: string;
    text: string;
    summary: string;
  }> = [];

  const enabledMembers = councilMembers.filter((m) => m.enabled);

  const promises = enabledMembers.map(async (member) => {
    const result = await sendToMember(member, messageToSend);
    const text = result.text ?? result.error ?? "No response.";
    const summary = result.summary ?? text.slice(0, 150);

    // Save to DB
    insertMessage({
      id: randomUUID(),
      threadId,
      role: "opinion",
      member: member.id,
      content: text,
      summary,
      round,
    });

    // Stream to UI in real time
    mainWindow.webContents.send("deliberation:opinion", {
      threadId,
      provider: member.id,
      label: member.label,
      text,
      summary,
      round,
    });

    opinions.push({ provider: member.id, text, summary });
  });

  await Promise.all(promises);

  // Generate verdict — rotate which member synthesizes it
  const verdictMember = enabledMembers[verdictIndex % enabledMembers.length];
  verdictIndex++;

  const opinionLines = opinions
    .map((o) => `${o.provider}: ${o.summary}`)
    .join("\n");

  const verdictPrompt = `You are synthesizing a council deliberation. Given these AI perspectives:\n\n${opinionLines}\n\nQuestion was: "${userMessage}"\n\nWrite a concise verdict (3-4 sentences): key insight, main disagreements, clear recommendation.`;

  const verdictResult = await sendToMember(verdictMember, verdictPrompt);
  const verdictText = verdictResult.text ?? "Council could not reach a verdict.";
  const verdictSummary =
    verdictResult.summary ?? verdictText.slice(0, 200);

  insertMessage({
    id: randomUUID(),
    threadId,
    role: "verdict",
    content: verdictText,
    summary: verdictSummary,
    round,
  });

  // Auto-title thread from first user message
  if (round === 1) {
    const title = userMessage.slice(0, 60).trim();
    updateThreadTitle(threadId, title);
  }

  // Compact if thread is getting long (> 5 rounds)
  await maybeCompact(threadId);

  mainWindow.webContents.send("deliberation:verdict", {
    threadId,
    text: verdictText,
    summary: verdictSummary,
    round,
  });

  mainWindow.webContents.send("deliberation:done", { threadId, round });
}

// ── Compaction ────────────────────────────────────────────────────────────────

async function maybeCompact(threadId: string) {
  const messages = getThreadMessages(threadId);
  const rounds = new Set(messages.map((m) => m.round)).size;
  if (rounds <= 5) return;

  // Summarize everything except the last 3 rounds
  const maxRound = Math.max(...messages.map((m) => m.round));
  const oldMessages = messages.filter((m) => m.round < maxRound - 2);
  if (oldMessages.length === 0) return;

  const summaryLines = oldMessages
    .filter((m) => m.role !== "user" || true)
    .map((m) => {
      if (m.role === "user") return `User asked: ${m.content.slice(0, 100)}`;
      if (m.role === "verdict") return `Verdict (round ${m.round}): ${m.summary ?? m.content.slice(0, 150)}`;
      if (m.role === "opinion") return `${m.member} (round ${m.round}): ${m.summary ?? m.content.slice(0, 100)}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");

  const compactionSummary = `[Compacted history]\n${summaryLines}`;
  const oldestTimestamp = Math.min(...oldMessages.map((m) => m.created_at));
  upsertCompaction(threadId, compactionSummary, oldestTimestamp);
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

function registerIPC() {
  // Thread management
  ipcMain.handle("threads:list", () => listThreads());
  ipcMain.handle("threads:create", () => {
    const id = randomUUID();
    createThread(id);
    return id;
  });
  ipcMain.handle("threads:delete", (_e, id: string) => deleteThread(id));
  ipcMain.handle("threads:messages", (_e, threadId: string) =>
    getThreadMessages(threadId)
  );

  // Deliberation
  ipcMain.handle(
    "deliberate",
    async (
      _e,
      {
        threadId,
        message,
        round,
        memberOptions,
      }: {
        threadId: string;
        message: string;
        round: number;
        /** Per-member capability overrides sent from the renderer's UI state */
        memberOptions?: Record<string, { deepThinking?: boolean; webSearch?: boolean }>;
      }
    ) => {
      // Overlay member options from the UI onto the stored council config
      if (memberOptions) {
        councilMembers = councilMembers.map((m) =>
          memberOptions[m.id]
            ? { ...m, ...memberOptions[m.id] }
            : m
        );
      }
      // Save user message
      insertMessage({
        id: randomUUID(),
        threadId,
        role: "user",
        content: message,
        round,
      });

      const isFollowUp = round > 1;
      let previousOpinions: Array<{ member: string; summary: string }> = [];
      let previousVerdictSummary: string | undefined;
      let compactionSummary: string | undefined;

      if (isFollowUp) {
        const allMessages = getThreadMessages(threadId);
        const prevRoundMessages = allMessages.filter(
          (m) => m.round === round - 1
        );
        previousOpinions = prevRoundMessages
          .filter((m) => m.role === "opinion")
          .map((m) => ({ member: m.member!, summary: m.summary ?? m.content.slice(0, 150) }));
        const prevVerdict = prevRoundMessages.find((m) => m.role === "verdict");
        previousVerdictSummary = prevVerdict?.summary ?? prevVerdict?.content.slice(0, 200);

        const compaction = getCompaction(threadId);
        compactionSummary = compaction?.summary;
      }

      await runDeliberation(
        threadId,
        message,
        round,
        isFollowUp,
        previousOpinions,
        previousVerdictSummary,
        compactionSummary
      );

      return { ok: true };
    }
  );

  // Glass mode toggle
  ipcMain.handle("glass:toggle", (_e, on: boolean) => {
    on ? showGlass() : hideGlass();
    return glassMode;
  });

  // Provider management (legacy — kept for compat)
  ipcMain.handle("providers:list", () => activeProviders);
  ipcMain.handle("providers:set", (_e, providers: Provider[]) => {
    activeProviders = providers;
    if (glassMode) updateViewBounds();
    return activeProviders;
  });

  // Council members — the new unified config
  ipcMain.handle("council:getMembers", () => councilMembers);
  ipcMain.handle("council:setMembers", (_e, members: CouncilMember[]) => {
    councilMembers = members;
    // Keep activeProviders in sync for glass view
    activeProviders = members
      .filter((m) => m.enabled && m.mode === "browser")
      .map((m) => m.id as Provider)
      .filter((id) => PROVIDERS.includes(id));
    if (glassMode) updateViewBounds();
    return true;
  });

  // Memory
  ipcMain.handle("memory:get", () => getMemory());
  ipcMain.handle("memory:set", (_e, value: string) => {
    setMemory(value);
    return true;
  });

  // Provider browser connection — opens a visible login window using the same
  // persistent session as the hidden BrowserView, so cookies carry over.
  // We spoof the user-agent to look like plain Chrome so Google OAuth works
  // (Google blocks login in windows that advertise "Electron" in their UA).
  ipcMain.handle("provider:connect", async (_e, provider: string) => {
    const providerUrl = PROVIDER_URLS[provider as Provider] ?? `https://${provider}.com`;
    const ses = session.fromPartition(`persist:${provider}`);

    // Spoof UA on this session so Google does not block OAuth
    const chromeUA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    ses.setUserAgent(chromeUA);

    const loginWin = new BrowserWindow({
      width: 960,
      height: 720,
      title: `Sign in to ${PROVIDER_LABELS[provider as Provider] ?? provider}`,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
      },
      autoHideMenuBar: true,
    });

    // Patch webdriver detection before any page JS runs
    loginWin.webContents.on("did-start-loading", () => {
      loginWin.webContents.executeJavaScript(WEBDRIVER_PATCH).catch(() => {});
    });

    loginWin.loadURL(providerUrl);

    return new Promise<void>((resolve) => {
      loginWin.on("closed", () => resolve());
    });
  });

  ipcMain.handle("provider:isConnected", async (_e, provider: string) => {
    const providerUrl = PROVIDER_URLS[provider as Provider];
    if (!providerUrl) return false;
    const ses = session.fromPartition(`persist:${provider}`);
    const cookies = await ses.cookies.get({ url: providerUrl });
    // Presence of any session/auth cookie means the user is logged in
    return cookies.some((c) =>
      c.name.startsWith("__Secure") ||
      c.name.includes("session") ||
      c.name.includes("auth") ||
      c.name.includes("token") ||
      c.name.startsWith("_ga") === false && c.name.startsWith("_")
    );
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

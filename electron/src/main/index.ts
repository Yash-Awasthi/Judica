import {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  session,
  shell,
} from "electron";
import path from "path";
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
const UI_URL = isDev
  ? "http://localhost:5173"
  : `file://${path.join(process.resourcesPath, "ui", "index.html")}`;

const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 900;
const SIDEBAR_WIDTH = 260; // history panel

// ── State ────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow;
const views: Partial<Record<Provider, BrowserView>> = {};
let glassMode = false;
let activeProviders: Provider[] = ["chatgpt", "gemini", "claude"];

// Verdict rotation: which provider generates the verdict each round
const verdictRotation: Provider[] = ["chatgpt", "gemini", "claude"];
let verdictIndex = 0;

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
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

function createProviderViews() {
  for (const provider of PROVIDERS) {
    // Each provider gets its own persistent session (cookies/login saved)
    const ses = session.fromPartition(`persist:${provider}`);

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

  // Send to all active providers in parallel
  const opinions: Array<{
    provider: Provider;
    text: string;
    summary: string;
  }> = [];

  const promises = activeProviders.map(async (provider) => {
    const result = await sendToProvider(provider, messageToSend);
    const text = result.text ?? "No response.";
    const summary = result.summary ?? text.slice(0, 150);

    // Save to DB
    insertMessage({
      id: randomUUID(),
      threadId,
      role: "opinion",
      member: provider,
      content: text,
      summary,
      round,
    });

    // Stream to UI in real time
    mainWindow.webContents.send("deliberation:opinion", {
      threadId,
      provider,
      text,
      summary,
      round,
    });

    opinions.push({ provider, text, summary });
  });

  await Promise.all(promises);

  // Generate verdict — rotate which AI synthesizes it
  const verdictProvider = verdictRotation[verdictIndex % verdictRotation.length];
  verdictIndex++;

  const opinionLines = opinions
    .map((o) => `${o.provider}: ${o.summary}`)
    .join("\n");

  const verdictPrompt = `You are synthesizing a council deliberation. Given these AI perspectives:\n\n${opinionLines}\n\nQuestion was: "${userMessage}"\n\nWrite a concise verdict (3-4 sentences): key insight, main disagreements, clear recommendation.`;

  const verdictResult = await sendToProvider(verdictProvider, verdictPrompt);
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
      }: { threadId: string; message: string; round: number }
    ) => {
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

  // Provider management
  ipcMain.handle("providers:list", () => activeProviders);
  ipcMain.handle("providers:set", (_e, providers: Provider[]) => {
    activeProviders = providers;
    if (glassMode) updateViewBounds();
    return activeProviders;
  });

  // Memory
  ipcMain.handle("memory:get", () => getMemory());
  ipcMain.handle("memory:set", (_e, value: string) => {
    setMemory(value);
    return true;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

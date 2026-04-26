/**
 * Browser Agent / Computer Use — Phase 4.13
 *
 * LLM-driven web automation:
 * - Navigate URLs, click elements, fill forms, extract content
 * - Screenshot + describe page (vision loop optional)
 * - Multi-step task planning with ReAct-style action loop
 *
 * Uses Playwright (pre-installed in sandbox) via child_process.
 * For production deployments, runs in a separate browser worker process.
 *
 * Inspired by:
 * - Browser-Use (browser-use/browser-use, 35k stars) — Python LLM browser agent
 * - Anthropic Computer Use — tool-use pattern for desktop/browser control
 * - Playwright MCP — browser automation via tool calls
 *
 * Note: Playwright/Chromium must be available in the runtime environment.
 * PLAYWRIGHT_BROWSERS_PATH env var can point to custom browser location.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

// ─── Provider ─────────────────────────────────────────────────────────────────

const llmProvider = {
  name: "openai",
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? "",
  model: "gpt-4o",
  systemPrompt: `You are a browser automation agent.
You plan and execute web tasks step by step.
For each step, decide the next action and respond in JSON.`,
};

// ─── Types ────────────────────────────────────────────────────────────────────

type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | { type: "extract"; selector: string }
  | { type: "screenshot" }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "wait"; ms: number }
  | { type: "done"; result: string };

interface BrowserStep {
  action: BrowserAction;
  observation: string;
  timestamp: string;
}

interface BrowserSession {
  sessionId: string;
  userId: number;
  goal: string;
  steps: BrowserStep[];
  status: "running" | "done" | "error";
  result: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── In-memory session store ─────────────────────────────────────────────────

const browserSessions = new Map<string, BrowserSession>();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const taskSchema = z.object({
  /** Natural language goal */
  goal: z.string().min(1).max(1000),
  /** Starting URL (optional) */
  startUrl: z.string().url().optional(),
  /** Max steps (default 10) */
  maxSteps: z.number().min(1).max(20).optional(),
});

const actionSchema = z.object({
  sessionId: z.string().uuid(),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("navigate"), url: z.string().url() }),
    z.object({ type: z.literal("click"), selector: z.string() }),
    z.object({ type: z.literal("type"), selector: z.string(), text: z.string() }),
    z.object({ type: z.literal("extract"), selector: z.string() }),
    z.object({ type: z.literal("screenshot") }),
    z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]), amount: z.number().optional() }),
    z.object({ type: z.literal("wait"), ms: z.number().min(100).max(10000) }),
    z.object({ type: z.literal("done"), result: z.string() }),
  ]),
});

// ─── Planning prompt ──────────────────────────────────────────────────────────

function buildPlanningPrompt(goal: string, previousSteps: BrowserStep[], currentState: string): string {
  const history = previousSteps.length > 0
    ? previousSteps.map((s, i) => `Step ${i + 1}: ${JSON.stringify(s.action)}\nObservation: ${s.observation}`).join("\n\n")
    : "No steps taken yet.";

  return `Goal: ${goal}

Current page state:
${currentState}

Previous steps:
${history}

What is the next action to take? Choose from:
- navigate: { type: "navigate", url: "..." }
- click: { type: "click", selector: "CSS selector" }
- type: { type: "type", selector: "CSS selector", text: "..." }
- extract: { type: "extract", selector: "CSS selector" }
- screenshot: { type: "screenshot" }
- scroll: { type: "scroll", direction: "up"|"down" }
- done: { type: "done", result: "final answer/result" }

Respond ONLY in JSON: { "action": {...}, "reasoning": "why this action" }`;
}

// ─── Browser execution (Playwright integration) ───────────────────────────────

/**
 * Execute a single browser action using Playwright.
 * Returns an observation string describing what happened.
 *
 * Uses dynamic import so the module loads fine if playwright isn't installed.
 */
async function executeBrowserAction(action: BrowserAction, context: {
  page?: unknown;
  browser?: unknown;
}): Promise<{ observation: string; newPage?: unknown; newBrowser?: unknown }> {
  try {
    // Dynamic import — gracefully degrade if playwright not available
    const { chromium } = await import("playwright").catch(() => null) ?? {};
    if (!chromium) {
      return { observation: `[Playwright not available] Simulated: ${JSON.stringify(action)}` };
    }

    let browser = context.browser as Awaited<ReturnType<typeof chromium.launch>> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let page = context.page as any;

    if (!browser) {
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext();
      page = await ctx.newPage();
    }

    let observation = "";

    switch (action.type) {
      case "navigate":
        await page!.goto(action.url, { waitUntil: "domcontentloaded", timeout: 15000 });
        observation = `Navigated to ${action.url}. Title: ${await page!.title()}`;
        break;

      case "click":
        await page!.click(action.selector, { timeout: 5000 });
        observation = `Clicked element: ${action.selector}`;
        break;

      case "type":
        await page!.fill(action.selector, action.text, { timeout: 5000 });
        observation = `Typed into ${action.selector}: "${action.text}"`;
        break;

      case "extract": {
        const text = await page!.$eval(action.selector, (el: Element) => el.textContent ?? "").catch(() => "");
        observation = `Extracted from ${action.selector}: ${text.trim().slice(0, 500)}`;
        break;
      }

      case "screenshot": {
        const buf = await page!.screenshot({ type: "jpeg", quality: 60 });
        const b64 = Buffer.from(buf as Uint8Array).toString("base64").slice(0, 100);
        observation = `Screenshot taken (${(buf as Uint8Array).length} bytes). Preview: data:image/jpeg;base64,${b64}...`;
        break;
      }

      case "scroll":
        await page!.evaluate(({ dir, amt }: { dir: string; amt: number }) => {
          window.scrollBy(0, dir === "down" ? amt : -amt);
        }, { dir: action.direction, amt: action.amount ?? 300 });
        observation = `Scrolled ${action.direction}`;
        break;

      case "wait":
        await new Promise((r) => setTimeout(r, action.ms));
        observation = `Waited ${action.ms}ms`;
        break;

      case "done":
        observation = `Task complete: ${action.result}`;
        if (browser) await browser.close().catch(() => {});
        break;
    }

    return { observation, newPage: page, newBrowser: browser };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ action, err: msg }, "browser-agent: action failed");
    return { observation: `Error executing ${action.type}: ${msg}` };
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function browserAgentPlugin(app: FastifyInstance) {

  /**
   * POST /browser-agent/tasks
   * Start a new browser automation task.
   * Runs a ReAct loop (plan → act → observe) up to maxSteps.
   */
  app.post("/browser-agent/tasks", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { goal, startUrl, maxSteps = 10 } = parsed.data;
    const { randomUUID } = await import("crypto");
    const sessionId = randomUUID();

    const session: BrowserSession = {
      sessionId,
      userId,
      goal,
      steps: [],
      status: "running",
      result: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    browserSessions.set(sessionId, session);

    // Run async in background — return session immediately
    (async () => {
      let browserCtx: { page?: unknown; browser?: unknown } = {};
      let currentState = startUrl ? `Starting URL: ${startUrl}` : "No URL specified yet.";

      try {
        // Navigate to start URL if provided
        if (startUrl) {
          const nav = await executeBrowserAction({ type: "navigate", url: startUrl }, browserCtx);
          browserCtx = { page: nav.newPage, browser: nav.newBrowser };
          currentState = nav.observation;
        }

        for (let step = 0; step < maxSteps; step++) {
          const prompt = buildPlanningPrompt(goal, session.steps, currentState);
          const response = await askProvider(llmProvider, [{ role: "user", content: prompt }]);

          let plan: { action: BrowserAction; reasoning?: string } = { action: { type: "done", result: "Unable to parse plan" } };
          try {
            const match = response.text.match(/\{[\s\S]*\}/);
            if (match) plan = JSON.parse(match[0]);
          } catch { /* use default */ }

          const { observation, newPage, newBrowser } = await executeBrowserAction(plan.action, browserCtx);
          if (newPage) browserCtx.page = newPage;
          if (newBrowser) browserCtx.browser = newBrowser;

          session.steps.push({
            action: plan.action,
            observation,
            timestamp: new Date().toISOString(),
          });
          currentState = observation;
          session.updatedAt = new Date().toISOString();

          if (plan.action.type === "done") {
            session.result = plan.action.result;
            session.status = "done";
            break;
          }
        }

        if (session.status === "running") {
          session.status = "done";
          session.result = `Reached max steps (${maxSteps}). Last observation: ${currentState.slice(0, 200)}`;
        }
      } catch (err) {
        session.status = "error";
        session.result = err instanceof Error ? err.message : String(err);
        logger.error({ sessionId, err: session.result }, "browser-agent: session error");
      }

      browserSessions.set(sessionId, session);
    })();

    return reply.status(202).send({
      success: true,
      sessionId,
      status: "running",
      message: "Browser agent started. Poll /browser-agent/sessions/:id for results.",
    });
  });

  /**
   * GET /browser-agent/sessions/:sessionId
   * Get the current status and steps of a browser session.
   */
  app.get("/browser-agent/sessions/:sessionId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.params as { sessionId: string };
    const session = browserSessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return reply.status(404).send({ error: "Session not found" });
    }

    return { success: true, session };
  });

  /**
   * GET /browser-agent/sessions
   * List all browser sessions for the user.
   */
  app.get("/browser-agent/sessions", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const sessions = [...browserSessions.values()]
      .filter((s) => s.userId === userId)
      .map(({ steps: _, ...s }) => ({ ...s, stepCount: _.length }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { success: true, sessions, count: sessions.length };
  });

  /**
   * POST /browser-agent/sessions/:sessionId/action
   * Manually send a single action to an existing session (for human-in-loop).
   */
  app.post("/browser-agent/sessions/:sessionId/action", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.params as { sessionId: string };
    const session = browserSessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const parsed = actionSchema.safeParse({ ...(req.body as object), sessionId });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { observation } = await executeBrowserAction(parsed.data.action, {});
    session.steps.push({ action: parsed.data.action, observation, timestamp: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();
    if (parsed.data.action.type === "done") {
      session.status = "done";
      session.result = parsed.data.action.result;
    }
    browserSessions.set(sessionId, session);

    return { success: true, observation, session };
  });
}

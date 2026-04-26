/**
 * Messaging Bot Integrations — Phase 4.11
 *
 * Connect council AI to WhatsApp (via Twilio or Meta Cloud API)
 * and Telegram (via Bot API). Incoming messages trigger an AI response
 * using the council's ask endpoint.
 *
 * Inspired by:
 * - Flowise (FlowiseAI/Flowise, 38k stars) — Telegram/WhatsApp bot integration
 * - Botpress — multi-channel bot platform
 *
 * Webhook endpoints:
 * - POST /bot/telegram/webhook  — Telegram Bot API webhook
 * - POST /bot/whatsapp/webhook  — Meta WhatsApp Cloud API webhook
 * - GET  /bot/whatsapp/webhook  — Meta webhook verification
 *
 * Required env vars:
 * - TELEGRAM_BOT_TOKEN — from @BotFather
 * - WHATSAPP_ACCESS_TOKEN — Meta Graph API token
 * - WHATSAPP_PHONE_NUMBER_ID — Meta phone number ID
 * - WHATSAPP_VERIFY_TOKEN — your verification token for Meta webhook setup
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

// ─── Bot config (env stubs) ───────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? "verify_token";

const aiProvider = {
  name: "openai",
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? "",
  model: "gpt-4o-mini",
  systemPrompt: "You are a helpful AI assistant. Answer concisely and clearly.",
};

// ─── Telegram API helpers ─────────────────────────────────────────────────────

async function telegramSendMessage(chatId: number | string, text: string) {
  if (!TELEGRAM_BOT_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot replies disabled");
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    logger.error({ status: res.status }, "Telegram sendMessage failed");
  }
}

// ─── WhatsApp Cloud API helpers ───────────────────────────────────────────────

async function whatsappSendMessage(to: string, text: string) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    logger.warn("WhatsApp credentials not set — bot replies disabled");
    return;
  }
  const url = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    logger.error({ status: res.status }, "WhatsApp sendMessage failed");
  }
}

// ─── AI response helper ───────────────────────────────────────────────────────

async function getAIResponse(text: string): Promise<string> {
  try {
    const response = await askProvider(aiProvider, [{ role: "user", content: text }]);
    return response.text.trim().slice(0, 4096); // Telegram/WA message limit
  } catch (err) {
    logger.error({ err }, "bot: AI response failed");
    return "Sorry, I couldn't process your message. Please try again.";
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function botPlugin(app: FastifyInstance) {

  /**
   * POST /bot/telegram/webhook
   * Telegram Bot API webhook endpoint.
   * Register via: https://api.telegram.org/bot{TOKEN}/setWebhook?url={your-url}/api/bot/telegram/webhook
   */
  app.post("/bot/telegram/webhook", async (req, reply) => {
    const update = req.body as Record<string, unknown>;

    // Handle message updates
    const message = (update.message as Record<string, unknown> | undefined);
    const callbackQuery = (update.callback_query as Record<string, unknown> | undefined);

    if (message) {
      const chatId = (message.chat as Record<string, unknown>)?.id;
      const text = message.text as string | undefined;
      const from = (message.from as Record<string, unknown>);

      logger.info({ chatId, from: from?.username }, "telegram: incoming message");

      if (text && chatId) {
        // Fire-and-forget: respond asynchronously
        getAIResponse(text)
          .then((reply) => telegramSendMessage(chatId as string, reply))
          .catch((err) => logger.error({ err }, "telegram: async response failed"));
      }
    } else if (callbackQuery) {
      // Handle inline keyboard callbacks
      const chatId = ((callbackQuery.message as Record<string, unknown>)?.chat as Record<string, unknown>)?.id;
      const data = callbackQuery.data as string;
      if (chatId && data) {
        getAIResponse(data)
          .then((r) => telegramSendMessage(chatId as string, r))
          .catch(() => {});
      }
    }

    // Always return 200 immediately to acknowledge receipt
    return reply.status(200).send({ ok: true });
  });

  /**
   * GET /bot/telegram/status
   * Check Telegram bot configuration status.
   */
  app.get("/bot/telegram/status", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return {
      success: true,
      configured: Boolean(TELEGRAM_BOT_TOKEN),
      botToken: TELEGRAM_BOT_TOKEN ? `${TELEGRAM_BOT_TOKEN.slice(0, 8)}***` : null,
      webhookPath: "/api/bot/telegram/webhook",
    };
  });

  /**
   * GET /bot/whatsapp/webhook
   * Meta webhook verification (GET challenge).
   */
  app.get("/bot/whatsapp/webhook", async (req, reply) => {
    const query = req.query as Record<string, string>;
    const mode      = query["hub.mode"];
    const token     = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      logger.info("whatsapp: webhook verified");
      return reply.status(200).send(challenge);
    }
    return reply.status(403).send({ error: "Verification failed" });
  });

  /**
   * POST /bot/whatsapp/webhook
   * Meta WhatsApp Cloud API webhook endpoint.
   */
  app.post("/bot/whatsapp/webhook", async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    // Always ack immediately
    reply.status(200).send({ received: true });

    try {
      const entry = (body.entry as unknown[])?.[0] as Record<string, unknown> | undefined;
      const changes = (entry?.changes as unknown[])?.[0] as Record<string, unknown> | undefined;
      const value = changes?.value as Record<string, unknown> | undefined;
      const messages = value?.messages as unknown[] | undefined;

      if (!messages || messages.length === 0) return;

      for (const msg of messages) {
        const m = msg as Record<string, unknown>;
        const from = m.from as string;
        const type = m.type as string;
        const text = (m.text as Record<string, string> | undefined)?.body;

        if (type === "text" && text && from) {
          logger.info({ from, type }, "whatsapp: incoming message");
          const aiReply = await getAIResponse(text);
          await whatsappSendMessage(from, aiReply);
        }
      }
    } catch (err) {
      logger.error({ err }, "whatsapp: webhook processing error");
    }
  });

  /**
   * GET /bot/whatsapp/status
   * Check WhatsApp bot configuration status.
   */
  app.get("/bot/whatsapp/status", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return {
      success: true,
      configured: Boolean(WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID),
      phoneNumberId: WHATSAPP_PHONE_NUMBER_ID || null,
      verifyToken: WHATSAPP_VERIFY_TOKEN,
      webhookPath: "/api/bot/whatsapp/webhook",
    };
  });

  /**
   * POST /bot/test
   * Test the AI response without sending to any messaging platform.
   */
  app.post("/bot/test", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { message } = req.body as { message?: string };
    if (!message) return reply.status(400).send({ error: "message required" });

    const response = await getAIResponse(message);
    return { success: true, response };
  });
}

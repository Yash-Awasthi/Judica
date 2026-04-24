/**
 * Slack Bot Integration — Event Handler
 *
 * Processes incoming Slack events: messages, app_mentions, slash commands.
 * Verifies request signatures and dispatches to appropriate handlers.
 */

import type {
  SlackEventPayload,
  SlackMessageEvent,
  SlackAppMentionEvent,
  SlackBotConfig,
  SlackChannelConfig,
} from "./models.js";
import { SlackBot } from "./bot.js";
import logger from "../../lib/logger.js";
import crypto from "crypto";

/** Verify Slack request signature (HMAC-SHA256). */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  // Reject requests older than 5 minutes (replay protection)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac("sha256", signingSecret);
  hmac.update(sigBasestring);
  const computed = `v0=${hmac.digest("hex")}`;

  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(signature),
  );
}

/** Strip bot mention from message text. */
function stripBotMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

/** Get channel config or default. */
function getChannelConfig(
  channelId: string,
  channelConfigs: Map<string, SlackChannelConfig>,
): SlackChannelConfig | null {
  return channelConfigs.get(channelId) || null;
}

export interface SlackEventContext {
  config: SlackBotConfig;
  channelConfigs: Map<string, SlackChannelConfig>;
  bot: SlackBot;
  /** API base URL for aibyai queries. */
  apiBaseUrl: string;
  /** API key for internal calls. */
  apiKey?: string;
}

/** Main event dispatcher. */
export async function handleSlackEvent(
  payload: SlackEventPayload,
  ctx: SlackEventContext,
): Promise<{ challenge?: string } | void> {
  // Handle URL verification challenge
  if (payload.type === "url_verification" && payload.challenge) {
    return { challenge: payload.challenge };
  }

  const event = payload.event;
  if (!event) return;

  try {
    switch (event.type) {
      case "message":
        await handleMessage(event as SlackMessageEvent, ctx);
        break;
      case "app_mention":
        await handleAppMention(event as SlackAppMentionEvent, ctx);
        break;
      default:
        logger.debug({ eventType: event.type }, "Unhandled Slack event type");
    }
  } catch (err) {
    logger.error({ err, eventType: event.type }, "Error handling Slack event");
  }
}

/** Handle direct messages to the bot. */
async function handleMessage(
  event: SlackMessageEvent,
  ctx: SlackEventContext,
): Promise<void> {
  // Ignore bot's own messages, message edits, and deletions
  if (event.subtype) return;

  // Only respond to DMs automatically; channels require @mention
  if (event.channel_type !== "im") return;

  const query = event.text.trim();
  if (!query) return;

  const threadTs = ctx.config.respondInThread
    ? (event.thread_ts || event.ts)
    : undefined;

  await processAndRespond(query, event.channel, threadTs, ctx);
}

/** Handle @mention of the bot in a channel. */
async function handleAppMention(
  event: SlackAppMentionEvent,
  ctx: SlackEventContext,
): Promise<void> {
  const channelConfig = getChannelConfig(event.channel, ctx.channelConfigs);

  // If channel has explicit config and is disabled, ignore
  if (channelConfig && !channelConfig.enabled) return;

  const query = stripBotMention(event.text);
  if (!query) return;

  const threadTs = ctx.config.respondInThread
    ? (event.thread_ts || event.ts)
    : undefined;

  await processAndRespond(
    query,
    event.channel,
    threadTs,
    ctx,
    channelConfig || undefined,
  );
}

/** Query aibyai and send response to Slack. */
async function processAndRespond(
  query: string,
  channel: string,
  threadTs: string | undefined,
  ctx: SlackEventContext,
  channelConfig?: SlackChannelConfig,
): Promise<void> {
  // Show typing indicator
  if (ctx.config.showTypingIndicator) {
    await ctx.bot.react(channel, threadTs || "", "hourglass_flowing_sand");
  }

  try {
    // Call aibyai API
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (ctx.apiKey) {
      headers["Authorization"] = `Bearer ${ctx.apiKey}`;
    }

    const body: Record<string, unknown> = { query };
    if (channelConfig?.knowledgeBaseId) {
      body.knowledgeBaseId = channelConfig.knowledgeBaseId;
    }

    const res = await fetch(`${ctx.apiBaseUrl}/api/ask`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const data = (await res.json()) as {
      answer?: string;
      sources?: Array<{ title: string; url: string }>;
    };

    let answer = data.answer || "I couldn't find an answer to that question.";

    // Truncate if needed
    if (answer.length > ctx.config.maxResponseLength) {
      answer = answer.slice(0, ctx.config.maxResponseLength - 3) + "...";
    }

    // Add sources if configured
    if (ctx.config.includeSources && data.sources && data.sources.length > 0) {
      const sourcesText = data.sources
        .slice(0, 3)
        .map((s, i) => `${i + 1}. ${s.url ? `<${s.url}|${s.title}>` : s.title}`)
        .join("\n");
      answer += `\n\n📚 *Sources:*\n${sourcesText}`;
    }

    await ctx.bot.postMessage({
      channel,
      text: answer,
      thread_ts: threadTs,
      unfurl_links: false,
    });

    // Remove typing indicator
    if (ctx.config.showTypingIndicator) {
      await ctx.bot.removeReaction(channel, threadTs || "", "hourglass_flowing_sand");
    }
  } catch (err) {
    logger.error({ err, channel }, "Failed to process Slack query");
    await ctx.bot.postMessage({
      channel,
      text: "Sorry, I encountered an error processing your question. Please try again.",
      thread_ts: threadTs,
    });
  }
}

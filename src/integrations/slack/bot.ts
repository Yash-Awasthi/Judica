/**
 * Slack Bot Integration — Bot Client
 *
 * Wraps Slack Web API for posting messages, reactions, ephemeral messages,
 * and updating existing messages.
 */

import type { SlackBlockMessage, SlackApiResponse, SlackBotConfig } from "./models.js";
import logger from "../../lib/logger.js";

const SLACK_API_BASE = "https://slack.com/api";

export class SlackBot {
  private token: string;

  constructor(config: SlackBotConfig) {
    this.token = config.botToken;
  }

  /** Post a message to a channel or thread. */
  async postMessage(msg: SlackBlockMessage): Promise<SlackApiResponse> {
    return this.callApi("chat.postMessage", {
      channel: msg.channel,
      text: msg.text,
      blocks: msg.blocks ? JSON.stringify(msg.blocks) : undefined,
      thread_ts: msg.thread_ts,
      unfurl_links: msg.unfurl_links ?? false,
      unfurl_media: msg.unfurl_media ?? false,
    });
  }

  /** Post an ephemeral message (only visible to one user). */
  async postEphemeral(
    channel: string,
    user: string,
    text: string,
    threadTs?: string,
  ): Promise<SlackApiResponse> {
    return this.callApi("chat.postEphemeral", {
      channel,
      user,
      text,
      thread_ts: threadTs,
    });
  }

  /** Update an existing message. */
  async updateMessage(
    channel: string,
    ts: string,
    text: string,
  ): Promise<SlackApiResponse> {
    return this.callApi("chat.update", {
      channel,
      ts,
      text,
    });
  }

  /** Add a reaction to a message. */
  async react(
    channel: string,
    timestamp: string,
    emoji: string,
  ): Promise<SlackApiResponse> {
    return this.callApi("reactions.add", {
      channel,
      timestamp,
      name: emoji,
    });
  }

  /** Remove a reaction from a message. */
  async removeReaction(
    channel: string,
    timestamp: string,
    emoji: string,
  ): Promise<SlackApiResponse> {
    return this.callApi("reactions.remove", {
      channel,
      timestamp,
      name: emoji,
    });
  }

  /** List channels the bot is in. */
  async listChannels(): Promise<Array<{ id: string; name: string; is_member: boolean }>> {
    const res = await this.callApi("conversations.list", {
      types: "public_channel,private_channel",
      limit: "200",
    });
    if (!res.ok) return [];
    const channels = (res as unknown as Record<string, unknown>).channels as Array<{
      id: string;
      name: string;
      is_member: boolean;
    }> || [];
    return channels;
  }

  /** Get bot's own user info. */
  async authTest(): Promise<{ ok: boolean; user_id?: string; team_id?: string; bot_id?: string }> {
    const res = await this.callApi("auth.test", {});
    return res as { ok: boolean; user_id?: string; team_id?: string; bot_id?: string };
  }

  /** Generic Slack API caller. */
  private async callApi(
    method: string,
    params: Record<string, string | boolean | undefined>,
  ): Promise<SlackApiResponse> {
    try {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          body.append(key, String(value));
        }
      }

      const res = await fetch(`${SLACK_API_BASE}/${method}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
      });

      const data = (await res.json()) as SlackApiResponse;

      if (!data.ok) {
        logger.warn({ method, error: data.error }, "Slack API error");
      }

      return data;
    } catch (err) {
      logger.error({ err, method }, "Slack API call failed");
      return { ok: false, error: "network_error" };
    }
  }
}

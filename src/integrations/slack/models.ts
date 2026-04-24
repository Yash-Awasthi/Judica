/**
 * Slack Bot Integration — Models
 *
 * Types for the Slack workspace bot that answers questions from channels
 * with channel-specific persona configuration and DM support.
 *
 * Modeled after Onyx's Slack bot integration.
 */

export interface SlackBotConfig {
  /** Slack Bot OAuth token. */
  botToken: string;
  /** Slack App-level token (for socket mode). */
  appToken?: string;
  /** Slack signing secret for request verification. */
  signingSecret: string;
  /** Default persona/agent to use for responses. */
  defaultPersonaId?: string;
  /** Whether to respond in threads. */
  respondInThread: boolean;
  /** Whether to show typing indicator. */
  showTypingIndicator: boolean;
  /** Max response length (characters). */
  maxResponseLength: number;
  /** Whether to include source citations. */
  includeSources: boolean;
  /** Rate limit: max responses per channel per minute. */
  rateLimitPerChannel: number;
}

export const DEFAULT_SLACK_BOT_CONFIG: SlackBotConfig = {
  botToken: "",
  signingSecret: "",
  respondInThread: true,
  showTypingIndicator: true,
  maxResponseLength: 3000,
  includeSources: true,
  rateLimitPerChannel: 10,
};

export interface SlackChannelConfig {
  /** Slack channel ID. */
  channelId: string;
  /** Channel name (for display). */
  channelName: string;
  /** Override persona for this channel. */
  personaId?: string;
  /** Knowledge base to scope searches. */
  knowledgeBaseId?: string;
  /** Whether the bot is enabled in this channel. */
  enabled: boolean;
  /** Response style for this channel. */
  responseStyle?: "concise" | "detailed" | "technical";
}

export interface SlackEventPayload {
  type: string;
  challenge?: string;
  token?: string;
  event?: SlackEvent;
  team_id?: string;
  api_app_id?: string;
  event_id?: string;
  event_time?: number;
}

export type SlackEvent =
  | SlackMessageEvent
  | SlackAppMentionEvent
  | SlackCommandEvent;

export interface SlackMessageEvent {
  type: "message";
  subtype?: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  channel_type: "channel" | "group" | "im" | "mpim";
}

export interface SlackAppMentionEvent {
  type: "app_mention";
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
}

export interface SlackCommandEvent {
  type: "slash_command";
  command: string;
  text: string;
  channel_id: string;
  user_id: string;
  response_url: string;
  trigger_id: string;
}

export interface SlackBlock {
  type: "section" | "divider" | "context" | "actions" | "header";
  text?: { type: "mrkdwn" | "plain_text"; text: string };
  elements?: Array<{ type: string; text?: { type: string; text: string }; [key: string]: unknown }>;
  accessory?: Record<string, unknown>;
}

export interface SlackBlockMessage {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}

export interface SlackApiResponse {
  ok: boolean;
  error?: string;
  channel?: string;
  ts?: string;
  message?: Record<string, unknown>;
}

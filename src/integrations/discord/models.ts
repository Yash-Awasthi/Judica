/**
 * Discord Bot Integration — Models
 *
 * Types for the Discord guild bot that answers questions from channels
 * with per-channel persona configuration, slash commands, and thread support.
 */

export interface DiscordBotConfig {
  /** Discord bot token. */
  botToken: string;
  /** Discord application ID. */
  applicationId: string;
  /** Discord public key for interaction verification. */
  publicKey: string;
  /** Default persona/agent to use for responses. */
  defaultPersonaId?: string;
  /** Whether to respond in threads. */
  respondInThread: boolean;
  /** Whether to show typing indicator. */
  showTypingIndicator: boolean;
  /** Max response length (characters, Discord limit is 2000). */
  maxResponseLength: number;
  /** Whether to include source citations. */
  includeSources: boolean;
  /** Rate limit: max responses per channel per minute. */
  rateLimitPerChannel: number;
}

export const DEFAULT_DISCORD_BOT_CONFIG: DiscordBotConfig = {
  botToken: "",
  applicationId: "",
  publicKey: "",
  respondInThread: true,
  showTypingIndicator: true,
  maxResponseLength: 1900,
  includeSources: true,
  rateLimitPerChannel: 10,
};

export interface DiscordChannelConfig {
  /** Discord channel ID (snowflake). */
  channelId: string;
  /** Channel name (for display). */
  channelName: string;
  /** Guild (server) ID. */
  guildId: string;
  /** Override persona for this channel. */
  personaId?: string;
  /** Knowledge base to scope searches. */
  knowledgeBaseId?: string;
  /** Whether the bot is enabled in this channel. */
  enabled: boolean;
  /** Response style for this channel. */
  responseStyle?: "concise" | "detailed" | "technical";
}

// ─── Discord API Types ────────────────────────────────────────────────────────

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: DiscordInteractionType;
  data?: DiscordInteractionData;
  guild_id?: string;
  channel_id?: string;
  member?: DiscordMember;
  user?: DiscordUser;
  token: string;
  version: number;
  message?: DiscordMessage;
}

export enum DiscordInteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  MODAL_SUBMIT = 5,
}

export enum DiscordInteractionResponseType {
  PONG = 1,
  CHANNEL_MESSAGE_WITH_SOURCE = 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5,
  DEFERRED_UPDATE_MESSAGE = 6,
  UPDATE_MESSAGE = 7,
}

export interface DiscordInteractionData {
  id: string;
  name: string;
  type?: number;
  options?: DiscordCommandOption[];
  custom_id?: string;
  values?: string[];
  resolved?: Record<string, unknown>;
}

export interface DiscordCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordCommandOption[];
  focused?: boolean;
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
  global_name?: string;
}

export interface DiscordMember {
  user: DiscordUser;
  nick?: string;
  roles: string[];
  permissions?: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  author: DiscordUser;
  timestamp: string;
  referenced_message?: DiscordMessage;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
}

export interface DiscordApiResponse {
  id?: string;
  type?: number;
  content?: string;
  error?: { code: number; message: string };
}

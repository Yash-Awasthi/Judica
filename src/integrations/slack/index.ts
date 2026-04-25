/**
 * Slack Bot Integration — Barrel Export
 */

export type {
  SlackBotConfig,
  SlackChannelConfig,
  SlackEventPayload,
  SlackEvent,
  SlackMessageEvent,
  SlackAppMentionEvent,
  SlackCommandEvent,
  SlackBlock,
  SlackBlockMessage,
  SlackApiResponse,
} from "./models.js";
export { DEFAULT_SLACK_BOT_CONFIG } from "./models.js";
export { SlackBot } from "./bot.js";
export { handleSlackEvent, verifySlackSignature } from "./events.js";
export { default as slackPlugin } from "./routes.js";

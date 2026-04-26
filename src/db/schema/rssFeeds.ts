/**
 * RSS/Atom Feed Connector — Phase 3.17
 *
 * Subscribe to any RSS/Atom feed. Background polling via BullMQ queue.
 * Council surfaces items matching user-defined relevance filters.
 *
 * Inspired by:
 * - rss-parser (MIT, rbren/rss-parser, 1.5k stars) — lightweight RSS/Atom parser
 * - Miniflux (Apache 2.0, miniflux/v2, 7k stars) — self-hosted RSS reader API
 * - Feedbin (MIT, feedbin/feedbin, 3.5k stars) — full-featured RSS backend
 *
 * Zero-dependency XML parsing: custom minimal RSS/Atom extractor.
 */

import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const rssFeeds = pgTable("rss_feeds", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  url:              text("url").notNull(),
  title:            text("title"),
  description:      text("description"),
  /** Plain-language filter: e.g. "articles about AI safety" */
  relevanceFilter:  text("relevance_filter"),
  pollIntervalMins: integer("poll_interval_mins").notNull().default(60),
  isActive:         boolean("is_active").notNull().default(true),
  lastPolledAt:     timestamp("last_polled_at"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_rss_feeds_user_id").on(t.userId),
}));

export const rssFeedItems = pgTable("rss_feed_items", {
  id:          serial("id").primaryKey(),
  feedId:      integer("feed_id").notNull(),
  guid:        text("guid").notNull(),
  title:       text("title"),
  link:        text("link"),
  description: text("description"),
  pubDate:     timestamp("pub_date"),
  isRead:      boolean("is_read").notNull().default(false),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  feedIdx: index("idx_rss_feed_items_feed_id").on(t.feedId),
  guidIdx: index("idx_rss_feed_items_guid").on(t.guid),
}));

-- Phase 3.17: RSS/Atom Feed Connector (rss-parser / Miniflux / Feedbin pattern)
CREATE TABLE IF NOT EXISTS rss_feeds (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL,
  url               TEXT NOT NULL,
  title             TEXT,
  description       TEXT,
  relevance_filter  TEXT,
  poll_interval_mins INTEGER NOT NULL DEFAULT 60,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_polled_at    TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS rss_feed_items (
  id          SERIAL PRIMARY KEY,
  feed_id     INTEGER NOT NULL,
  guid        TEXT NOT NULL,
  title       TEXT,
  link        TEXT,
  description TEXT,
  pub_date    TIMESTAMP,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rss_feeds_user_id       ON rss_feeds(user_id);
CREATE INDEX IF NOT EXISTS idx_rss_feed_items_feed_id  ON rss_feed_items(feed_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_feed_items_guid ON rss_feed_items(feed_id, guid);

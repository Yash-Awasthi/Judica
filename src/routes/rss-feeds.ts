/**
 * RSS/Atom Feed Connector routes — Phase 3.17
 *
 * Subscribe to feeds, poll for new items, surface relevant content.
 * Background polling via BullMQ (existing queue infrastructure).
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { rssFeeds, rssFeedItems } from "../db/schema/rssFeeds.js";
import { fetchFeed } from "../lib/rssFeedParser.js";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const feedSchema = z.object({
  url:              z.string().url(),
  relevanceFilter:  z.string().optional(),
  pollIntervalMins: z.number().min(5).max(1440).optional(),
  isActive:         z.boolean().optional(),
});

export async function rssFeedsPlugin(app: FastifyInstance) {
  // GET /rss/feeds — list subscribed feeds
  app.get("/rss/feeds", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const feeds = await db
      .select()
      .from(rssFeeds)
      .where(and(eq(rssFeeds.userId, userId), eq(rssFeeds.isActive, true)));

    return { success: true, feeds };
  });

  // POST /rss/feeds — subscribe to a feed
  app.post("/rss/feeds", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = feedSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { url, relevanceFilter, pollIntervalMins = 60, isActive = true } = parsed.data;

    // Fetch feed metadata
    let title = url, description = "";
    try {
      const feed = await fetchFeed(url);
      title = feed.title || url;
      description = feed.description;
    } catch { /* use URL as title if fetch fails */ }

    const [feed] = await db
      .insert(rssFeeds)
      .values({ userId, url, title, description, relevanceFilter, pollIntervalMins, isActive })
      .returning();

    return reply.status(201).send({ success: true, feed });
  });

  // DELETE /rss/feeds/:id — unsubscribe
  app.delete("/rss/feeds/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    await db
      .update(rssFeeds)
      .set({ isActive: false })
      .where(and(eq(rssFeeds.id, id), eq(rssFeeds.userId, userId)));

    return { success: true };
  });

  // POST /rss/feeds/:id/poll — manually trigger a poll
  app.post("/rss/feeds/:id/poll", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);

    const [feed] = await db
      .select()
      .from(rssFeeds)
      .where(and(eq(rssFeeds.id, id), eq(rssFeeds.userId, userId)))
      .limit(1);

    if (!feed) return reply.status(404).send({ error: "Feed not found" });

    const parsedFeed = await fetchFeed(feed.url);
    let newCount = 0;

    for (const item of parsedFeed.items) {
      try {
        await db
          .insert(rssFeedItems)
          .values({
            feedId:      id,
            guid:        item.guid,
            title:       item.title,
            link:        item.link,
            description: item.description,
            pubDate:     item.pubDate ?? null,
          })
          .onConflictDoNothing();
        newCount++;
      } catch { /* conflict = already exists */ }
    }

    await db
      .update(rssFeeds)
      .set({ lastPolledAt: new Date() })
      .where(eq(rssFeeds.id, id));

    return { success: true, newItems: newCount, totalItems: parsedFeed.items.length };
  });

  // GET /rss/feeds/:id/items — get items for a feed
  app.get("/rss/feeds/:id/items", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    const { unread, limit = "50" } = req.query as Record<string, string>;

    // Verify ownership
    const [feed] = await db
      .select({ id: rssFeeds.id })
      .from(rssFeeds)
      .where(and(eq(rssFeeds.id, id), eq(rssFeeds.userId, userId)))
      .limit(1);

    if (!feed) return reply.status(404).send({ error: "Feed not found" });

    let query = db
      .select()
      .from(rssFeedItems)
      .where(eq(rssFeedItems.feedId, id))
      .$dynamic();

    if (unread === "true") {
      query = query.where(eq(rssFeedItems.isRead, false)) as any;
    }

    const items = await (query as any)
      .orderBy(desc(rssFeedItems.pubDate))
      .limit(Number(limit));

    return { success: true, items };
  });

  // PATCH /rss/items/:id/read — mark item as read
  app.patch("/rss/items/:id/read", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    await db.update(rssFeedItems).set({ isRead: true }).where(eq(rssFeedItems.id, id));
    return { success: true };
  });
}

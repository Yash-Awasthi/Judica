import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import {
  marketplaceItems,
  marketplaceStars,
  marketplaceReviews,
  userSkills,
} from "../db/schema/marketplace.js";
import { users } from "../db/schema/users.js";
import { prompts, promptVersions } from "../db/schema/prompts.js";
import { workflows } from "../db/schema/workflows.js";
import { customPersonas } from "../db/schema/council.js";
import { eq, and, or, ilike, desc, count, sql } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";

const marketplacePlugin: FastifyPluginAsync = async (fastify) => {
    // GET / — list marketplace items
  fastify.get("/", async (request, _reply) => {
    const {
      type,
      tags,
      sort = "newest",
      search,
      page = "1",
      limit = "20",
    } = request.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const conditions = [eq(marketplaceItems.published, true)];

    if (type) {
      conditions.push(eq(marketplaceItems.type, type));
    }

    if (tags) {
      const tagList = tags.split(",").map((t) => t.trim());
      conditions.push(
        sql`${marketplaceItems.tags} && ARRAY[${sql.join(tagList.map(t => sql`${t}`), sql`,`)}]::text[]`
      );
    }

    if (search) {
      // Escape LIKE special characters to prevent wildcard injection
      const escapedSearch = search
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");
      conditions.push(
        or(
          ilike(marketplaceItems.name, `%${escapedSearch}%`),
          ilike(marketplaceItems.description, `%${escapedSearch}%`)
        )!
      );
    }

    const whereClause = and(...conditions);

    let orderByClause = desc(marketplaceItems.createdAt);
    if (sort === "stars") orderByClause = desc(marketplaceItems.stars);
    else if (sort === "downloads") orderByClause = desc(marketplaceItems.downloads);

    const [items, totalResult] = await Promise.all([
      db
        .select()
        .from(marketplaceItems)
        .where(whereClause)
        .orderBy(orderByClause)
        .offset(skip)
        .limit(limitNum),
      db
        .select({ value: count() })
        .from(marketplaceItems)
        .where(whereClause),
    ]);

    return { items, total: totalResult[0].value, page: pageNum, limit: limitNum };
  });

    // GET /:id — item detail with reviews
  fastify.get("/:id", async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [item] = await db
      .select()
      .from(marketplaceItems)
      .where(eq(marketplaceItems.id, id))
      .limit(1);

    if (!item) {
      throw new AppError(404, "Marketplace item not found", "ITEM_NOT_FOUND");
    }

    const reviews = await db
      .select()
      .from(marketplaceReviews)
      .where(eq(marketplaceReviews.itemId, id))
      .orderBy(desc(marketplaceReviews.createdAt))
      .limit(50);

    // Check if current user has starred
    let starred = false;
    if (request.userId) {
      const [star] = await db
        .select()
        .from(marketplaceStars)
        .where(
          and(
            eq(marketplaceStars.userId, request.userId!),
            eq(marketplaceStars.itemId, id)
          )
        )
        .limit(1);
      starred = !!star;
    }

    return { ...item, reviews, starred };
  });

    // POST / — publish item
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { type, name, description, content, tags } = request.body as { type?: string; name?: string; description?: string; content?: string; tags?: string[] };

    if (!type || !name || !description || !content) {
      throw new AppError(400, "type, name, description, and content are required", "MISSING_FIELDS");
    }

    const validTypes = ["prompt", "workflow", "persona", "tool"];
    if (!validTypes.includes(type)) {
      throw new AppError(400, `Invalid type. Must be one of: ${validTypes.join(", ")}`, "INVALID_TYPE");
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, request.userId!))
      .limit(1);
    if (!user) {
      throw new AppError(404, "User not found", "USER_NOT_FOUND");
    }

    const now = new Date();
    const [item] = await db
      .insert(marketplaceItems)
      .values({
        id: randomUUID(),
        type,
        name,
        description,
        content,
        tags: tags || [],
        authorId: request.userId!,
        authorName: user.username,
        published: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ userId: request.userId, itemId: item.id }, "Marketplace item published");
    reply.code(201);
    return item;
  });

    // PUT /:id — update item (author only)
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [item] = await db
      .select()
      .from(marketplaceItems)
      .where(eq(marketplaceItems.id, id))
      .limit(1);

    if (!item) {
      throw new AppError(404, "Item not found", "ITEM_NOT_FOUND");
    }
    if (item.authorId !== request.userId) {
      throw new AppError(403, "Not authorized to update this item", "FORBIDDEN");
    }

    const { name, description, content, tags, version, published } = request.body as { name?: string; description?: string; content?: string; tags?: string[]; version?: string; published?: boolean };

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (content !== undefined) data.content = content;
    if (tags !== undefined) data.tags = tags;
    if (version !== undefined) data.version = version;
    if (published !== undefined) data.published = published;

    const [updated] = await db
      .update(marketplaceItems)
      .set(data)
      .where(eq(marketplaceItems.id, id))
      .returning();

    return updated;
  });

    // DELETE /:id — delete item (author or admin)
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [item] = await db
      .select()
      .from(marketplaceItems)
      .where(eq(marketplaceItems.id, id))
      .limit(1);

    if (!item) {
      throw new AppError(404, "Item not found", "ITEM_NOT_FOUND");
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, request.userId!))
      .limit(1);
    if (item.authorId !== request.userId && user?.role !== "admin") {
      throw new AppError(403, "Not authorized to delete this item", "FORBIDDEN");
    }

    await db.delete(marketplaceItems).where(eq(marketplaceItems.id, id));
    logger.info({ userId: request.userId, itemId: id }, "Marketplace item deleted");
    return { success: true };
  });

    // POST /:id/install — increment downloads, import into user account, return content
  fastify.post("/:id/install", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;

    const [item] = await db
      .update(marketplaceItems)
      .set({ downloads: sql`${marketplaceItems.downloads} + 1` })
      .where(eq(marketplaceItems.id, id))
      .returning();

    if (!item) {
      throw new AppError(404, "Item not found", "ITEM_NOT_FOUND");
    }

    const content = item.content as Record<string, unknown>;

    // Import item into user's account based on type
    try {
      switch (item.type) {
        case "prompt": {
          const promptId = randomUUID();
          await db.insert(prompts).values({
            id: promptId,
            userId,
            name: (content.name as string) || item.name,
            description: (content.description as string) || item.description,
          });
          await db.insert(promptVersions).values({
            id: randomUUID(),
            promptId,
            versionNum: 1,
            content: (content.text as string) || (content.content as string) || JSON.stringify(content),
            model: (content.model as string) || null,
            temperature: (content.temperature as number) ?? null,
            notes: `Installed from marketplace: ${item.name}`,
          });
          break;
        }
        case "workflow": {
          const now = new Date();
          await db.insert(workflows).values({
            id: randomUUID(),
            userId,
            name: (content.name as string) || item.name,
            description: (content.description as string) || item.description,
            definition: (content.definition || content) as Record<string, unknown>,
            createdAt: now,
            updatedAt: now,
          });
          break;
        }
        case "persona": {
          await db.insert(customPersonas).values({
            id: randomUUID(),
            userId,
            name: (content.name as string) || item.name,
            systemPrompt: (content.systemPrompt as string) || (content.system_prompt as string) || "",
            temperature: (content.temperature as number) ?? 0.7,
            critiqueStyle: (content.critiqueStyle as string) || null,
            domain: (content.domain as string) || null,
            aggressiveness: (content.aggressiveness as number) ?? 5,
          });
          break;
        }
        case "tool": {
          // Register as a user skill if the format is valid
          if (content.code) {
            await db.insert(userSkills).values({
              id: randomUUID(),
              userId: userId,
              name: (content.name as string) || item.name,
              description: (content.description as string) || item.description,
              code: content.code as string,
              parameters: (content.parameters || {}) as Record<string, unknown>,
              active: true,
            });
          }
          break;
        }
      }
    } catch (err) {
      logger.warn({ err, userId, itemId: id, type: item.type }, "Failed to auto-import marketplace item (download still counted)");
    }

    logger.info({ userId, itemId: id, type: item.type }, "Marketplace item installed");
    return { content: item.content, type: item.type, name: item.name };
  });

    // POST /:id/star — toggle star (atomic using ON CONFLICT and transaction)
  fastify.post("/:id/star", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;

    const result = await db.transaction(async (tx) => {
      // Attempt to insert; if the row already exists, delete it instead
      const [inserted] = await tx
        .insert(marketplaceStars)
        .values({ userId, itemId: id })
        .onConflictDoNothing()
        .returning();

      if (inserted) {
        // Star was added
        await tx
          .update(marketplaceItems)
          .set({ stars: sql`GREATEST(${marketplaceItems.stars} + 1, 0)` })
          .where(eq(marketplaceItems.id, id));
        return { starred: true };
      } else {
        // Row already existed — remove it (unstar)
        await tx
          .delete(marketplaceStars)
          .where(
            and(
              eq(marketplaceStars.userId, userId),
              eq(marketplaceStars.itemId, id)
            )
          );
        await tx
          .update(marketplaceItems)
          .set({ stars: sql`GREATEST(${marketplaceItems.stars} - 1, 0)` })
          .where(eq(marketplaceItems.id, id));
        return { starred: false };
      }
    });

    return result;
  });

    // POST /:id/reviews — add review
  fastify.post("/:id/reviews", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id: itemId } = request.params as { id: string };
    const { rating, comment } = request.body as { rating?: number; comment?: string };

    if (!rating || rating < 1 || rating > 5) {
      throw new AppError(400, "Rating must be between 1 and 5", "INVALID_RATING");
    }

    const [item] = await db
      .select()
      .from(marketplaceItems)
      .where(eq(marketplaceItems.id, itemId))
      .limit(1);
    if (!item) {
      throw new AppError(404, "Item not found", "ITEM_NOT_FOUND");
    }

    const [review] = await db
      .insert(marketplaceReviews)
      .values({
        id: randomUUID(),
        itemId,
        userId: request.userId!,
        rating: Math.round(rating),
        comment: comment || null,
      })
      .returning();

    reply.code(201);
    return review;
  });

    // GET /:id/reviews — list reviews
  fastify.get("/:id/reviews", async (request, _reply) => {
    const { id: itemId } = request.params as { id: string };

    const reviews = await db
      .select()
      .from(marketplaceReviews)
      .where(eq(marketplaceReviews.itemId, itemId))
      .orderBy(desc(marketplaceReviews.createdAt))
      .limit(100);

    return reviews;
  });
};

export default marketplacePlugin;

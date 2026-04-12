import { FastifyPluginAsync } from "fastify";
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
  /**
   * @openapi
   * /marketplace:
   *   get:
   *     summary: List marketplace items
   *     description: Returns a paginated list of published marketplace items with optional filtering by type, tags, search term, and sort order.
   *     tags:
   *       - Marketplace
   *     parameters:
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [prompt, workflow, persona, tool]
   *         description: Filter by item type
   *       - in: query
   *         name: tags
   *         schema:
   *           type: string
   *         description: Comma-separated list of tags to filter by
   *       - in: query
   *         name: sort
   *         schema:
   *           type: string
   *           enum: [newest, stars, downloads]
   *           default: newest
   *         description: Sort order for results
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search term to match against name and description
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *           minimum: 1
   *         description: Page number for pagination
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *           minimum: 1
   *           maximum: 100
   *         description: Number of items per page
   *     responses:
   *       200:
   *         description: Paginated list of marketplace items
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 items:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/MarketplaceItem'
   *                 total:
   *                   type: integer
   *                   description: Total number of matching items
   *                 page:
   *                   type: integer
   *                 limit:
   *                   type: integer
   */
  // GET / — list marketplace items
  fastify.get("/", async (request, reply) => {
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

    const conditions: any[] = [eq(marketplaceItems.published, true)];

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
        )
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

  /**
   * @openapi
   * /marketplace/{id}:
   *   get:
   *     summary: Get marketplace item detail
   *     description: Returns a single marketplace item by ID, including its most recent reviews and whether the current user has starred it.
   *     tags:
   *       - Marketplace
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Marketplace item ID
   *     responses:
   *       200:
   *         description: Marketplace item detail with reviews and starred status
   *         content:
   *           application/json:
   *             schema:
   *               allOf:
   *                 - $ref: '#/components/schemas/MarketplaceItem'
   *                 - type: object
   *                   properties:
   *                     reviews:
   *                       type: array
   *                       items:
   *                         $ref: '#/components/schemas/MarketplaceReview'
   *                     starred:
   *                       type: boolean
   *                       description: Whether the current user has starred this item
   *       404:
   *         description: Item not found
   */
  // GET /:id — item detail with reviews
  fastify.get("/:id", async (request, reply) => {
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

  /**
   * @openapi
   * /marketplace:
   *   post:
   *     summary: Publish a new marketplace item
   *     description: Creates and publishes a new item to the marketplace. Requires authentication.
   *     tags:
   *       - Marketplace
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - type
   *               - name
   *               - description
   *               - content
   *             properties:
   *               type:
   *                 type: string
   *                 enum: [prompt, workflow, persona, tool]
   *                 description: The type of marketplace item
   *               name:
   *                 type: string
   *                 description: Display name of the item
   *               description:
   *                 type: string
   *                 description: Description of the item
   *               content:
   *                 type: object
   *                 description: The item content/payload
   *               tags:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Tags for categorization
   *     responses:
   *       201:
   *         description: Item published successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/MarketplaceItem'
   *       400:
   *         description: Missing required fields or invalid type
   *       404:
   *         description: User not found
   */
  // POST / — publish item
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { type, name, description, content, tags } = request.body as any;

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

  /**
   * @openapi
   * /marketplace/{id}:
   *   put:
   *     summary: Update a marketplace item
   *     description: Updates an existing marketplace item. Only the original author can update their item.
   *     tags:
   *       - Marketplace
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Marketplace item ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 description: Updated display name
   *               description:
   *                 type: string
   *                 description: Updated description
   *               content:
   *                 type: object
   *                 description: Updated item content/payload
   *               tags:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Updated tags
   *               version:
   *                 type: string
   *                 description: Updated version string
   *               published:
   *                 type: boolean
   *                 description: Whether the item is published
   *     responses:
   *       200:
   *         description: Item updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/MarketplaceItem'
   *       403:
   *         description: Not authorized to update this item
   *       404:
   *         description: Item not found
   */
  // PUT /:id — update item (author only)
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

    const { name, description, content, tags, version, published } = request.body as any;

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

  /**
   * @openapi
   * /marketplace/{id}:
   *   delete:
   *     summary: Delete a marketplace item
   *     description: Deletes a marketplace item. Only the original author or an admin can delete an item.
   *     tags:
   *       - Marketplace
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Marketplace item ID
   *     responses:
   *       200:
   *         description: Item deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *       403:
   *         description: Not authorized to delete this item
   *       404:
   *         description: Item not found
   */
  // DELETE /:id — delete item (author or admin)
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /marketplace/{id}/install:
   *   post:
   *     summary: Install a marketplace item
   *     description: Increments the download count and imports the item into the authenticated user's account based on its type (prompt, workflow, persona, or tool). Returns the item content.
   *     tags:
   *       - Marketplace
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Marketplace item ID
   *     responses:
   *       200:
   *         description: Item installed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 content:
   *                   type: object
   *                   description: The item content/payload
   *                 type:
   *                   type: string
   *                   enum: [prompt, workflow, persona, tool]
   *                 name:
   *                   type: string
   *       404:
   *         description: Item not found
   */
  // POST /:id/install — increment downloads, import into user account, return content
  fastify.post("/:id/install", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

    const content = item.content as Record<string, any>;

    // Import item into user's account based on type
    try {
      switch (item.type) {
        case "prompt": {
          const promptId = randomUUID();
          await db.insert(prompts).values({
            id: promptId,
            userId,
            name: content.name || item.name,
            description: content.description || item.description,
          });
          await db.insert(promptVersions).values({
            id: randomUUID(),
            promptId,
            versionNum: 1,
            content: content.text || content.content || JSON.stringify(content),
            model: content.model || null,
            temperature: content.temperature ?? null,
            notes: `Installed from marketplace: ${item.name}`,
          });
          break;
        }
        case "workflow": {
          const now = new Date();
          await db.insert(workflows).values({
            id: randomUUID(),
            userId,
            name: content.name || item.name,
            description: content.description || item.description,
            definition: content.definition || content,
            createdAt: now,
            updatedAt: now,
          });
          break;
        }
        case "persona": {
          await db.insert(customPersonas).values({
            id: randomUUID(),
            userId,
            name: content.name || item.name,
            systemPrompt: content.systemPrompt || content.system_prompt || "",
            temperature: content.temperature ?? 0.7,
            critiqueStyle: content.critiqueStyle || null,
            domain: content.domain || null,
            aggressiveness: content.aggressiveness ?? 5,
          });
          break;
        }
        case "tool": {
          // Register as a user skill if the format is valid
          if (content.code) {
            await db.insert(userSkills).values({
              id: randomUUID(),
              userId: userId,
              name: content.name || item.name,
              description: content.description || item.description,
              code: content.code,
              parameters: content.parameters || {},
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

  /**
   * @openapi
   * /marketplace/{id}/star:
   *   post:
   *     summary: Toggle star on a marketplace item
   *     description: Stars or unstars a marketplace item for the authenticated user. If already starred, removes the star; otherwise adds one.
   *     tags:
   *       - Marketplace
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Marketplace item ID
   *     responses:
   *       200:
   *         description: Star toggled successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 starred:
   *                   type: boolean
   *                   description: Whether the item is now starred by the user
   */
  // POST /:id/star — toggle star (atomic using ON CONFLICT and transaction)
  fastify.post("/:id/star", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /marketplace/{id}/reviews:
   *   post:
   *     summary: Add a review to a marketplace item
   *     description: Creates a new review with a rating (1-5) and optional comment for a marketplace item.
   *     tags:
   *       - Marketplace
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Marketplace item ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - rating
   *             properties:
   *               rating:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 5
   *                 description: Rating from 1 to 5
   *               comment:
   *                 type: string
   *                 description: Optional review comment
   *     responses:
   *       201:
   *         description: Review created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/MarketplaceReview'
   *       400:
   *         description: Invalid rating
   *       404:
   *         description: Item not found
   */
  // POST /:id/reviews — add review
  fastify.post("/:id/reviews", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id: itemId } = request.params as { id: string };
    const { rating, comment } = request.body as any;

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

  /**
   * @openapi
   * /marketplace/{id}/reviews:
   *   get:
   *     summary: List reviews for a marketplace item
   *     description: Returns up to 100 reviews for a marketplace item, ordered by most recent first.
   *     tags:
   *       - Marketplace
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Marketplace item ID
   *     responses:
   *       200:
   *         description: List of reviews
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/MarketplaceReview'
   */
  // GET /:id/reviews — list reviews
  fastify.get("/:id/reviews", async (request, reply) => {
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

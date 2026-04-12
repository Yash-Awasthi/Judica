import { Router, Response } from "express";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";

const router = Router();

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
router.get("/", async (req: AuthRequest, res: Response) => {
  const {
    type,
    tags,
    sort = "newest",
    search,
    page = "1",
    limit = "20",
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip = (pageNum - 1) * limitNum;

  const where: any = { published: true };

  if (type) {
    where.type = type;
  }

  if (tags) {
    const tagList = tags.split(",").map((t) => t.trim());
    where.tags = { hasSome: tagList };
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  let orderBy: any = { createdAt: "desc" };
  if (sort === "stars") orderBy = { stars: "desc" };
  else if (sort === "downloads") orderBy = { downloads: "desc" };

  const [items, total] = await Promise.all([
    prisma.marketplaceItem.findMany({
      where,
      orderBy,
      skip,
      take: limitNum,
    }),
    prisma.marketplaceItem.count({ where }),
  ]);

  res.json({ items, total, page: pageNum, limit: limitNum });
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
router.get("/:id", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id as string);
  const item = await prisma.marketplaceItem.findUnique({
    where: { id },
    include: { reviews: { orderBy: { createdAt: "desc" }, take: 50 } },
  });

  if (!item) {
    throw new AppError(404, "Marketplace item not found", "ITEM_NOT_FOUND");
  }

  // Check if current user has starred
  let starred = false;
  if (req.userId) {
    const star = await prisma.marketplaceStar.findUnique({
      where: { userId_itemId: { userId: String(req.userId), itemId: id } },
    });
    starred = !!star;
  }

  res.json({ ...item, starred });
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
router.post("/", async (req: AuthRequest, res: Response) => {
  const { type, name, description, content, tags } = req.body;

  if (!type || !name || !description || !content) {
    throw new AppError(400, "type, name, description, and content are required", "MISSING_FIELDS");
  }

  const validTypes = ["prompt", "workflow", "persona", "tool"];
  if (!validTypes.includes(type)) {
    throw new AppError(400, `Invalid type. Must be one of: ${validTypes.join(", ")}`, "INVALID_TYPE");
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    throw new AppError(404, "User not found", "USER_NOT_FOUND");
  }

  const item = await prisma.marketplaceItem.create({
    data: {
      type,
      name,
      description,
      content,
      tags: tags || [],
      authorId: String(req.userId),
      authorName: user.username,
      published: true,
    },
  });

  logger.info({ userId: req.userId, itemId: item.id }, "Marketplace item published");
  res.status(201).json(item);
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
router.put("/:id", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id as string);
  const item = await prisma.marketplaceItem.findUnique({ where: { id } });

  if (!item) {
    throw new AppError(404, "Item not found", "ITEM_NOT_FOUND");
  }
  if (item.authorId !== String(req.userId)) {
    throw new AppError(403, "Not authorized to update this item", "FORBIDDEN");
  }

  const { name, description, content, tags, version, published } = req.body;

  const updated = await prisma.marketplaceItem.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(content !== undefined && { content }),
      ...(tags !== undefined && { tags }),
      ...(version !== undefined && { version }),
      ...(published !== undefined && { published }),
    },
  });

  res.json(updated);
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
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id as string);
  const item = await prisma.marketplaceItem.findUnique({ where: { id } });

  if (!item) {
    throw new AppError(404, "Item not found", "ITEM_NOT_FOUND");
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (item.authorId !== String(req.userId) && user?.role !== "admin") {
    throw new AppError(403, "Not authorized to delete this item", "FORBIDDEN");
  }

  await prisma.marketplaceItem.delete({ where: { id } });
  logger.info({ userId: req.userId, itemId: id }, "Marketplace item deleted");
  res.json({ success: true });
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
router.post("/:id/install", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id as string);
  const userId = req.userId!;

  const item = await prisma.marketplaceItem.update({
    where: { id },
    data: { downloads: { increment: 1 } },
  });

  if (!item) {
    throw new AppError(404, "Item not found", "ITEM_NOT_FOUND");
  }

  const content = item.content as Record<string, any>;

  // Import item into user's account based on type
  try {
    switch (item.type) {
      case "prompt": {
        const prompt = await prisma.prompt.create({
          data: {
            userId,
            name: content.name || item.name,
            description: content.description || item.description,
          },
        });
        await prisma.promptVersion.create({
          data: {
            promptId: prompt.id,
            versionNum: 1,
            content: content.text || content.content || JSON.stringify(content),
            model: content.model || null,
            temperature: content.temperature ?? null,
            notes: `Installed from marketplace: ${item.name}`,
          },
        });
        break;
      }
      case "workflow": {
        await prisma.workflow.create({
          data: {
            userId,
            name: content.name || item.name,
            description: content.description || item.description,
            definition: content.definition || content,
          },
        });
        break;
      }
      case "persona": {
        await prisma.customPersona.create({
          data: {
            userId,
            name: content.name || item.name,
            systemPrompt: content.systemPrompt || content.system_prompt || "",
            temperature: content.temperature ?? 0.7,
            critiqueStyle: content.critiqueStyle || null,
            domain: content.domain || null,
            aggressiveness: content.aggressiveness ?? 5,
          },
        });
        break;
      }
      case "tool": {
        // Register as a user skill if the format is valid
        if (content.code) {
          await prisma.userSkill.create({
            data: {
              userId: String(userId),
              name: content.name || item.name,
              description: content.description || item.description,
              code: content.code,
              parameters: content.parameters || {},
              active: true,
            },
          });
        }
        break;
      }
    }
  } catch (err) {
    logger.warn({ err, userId, itemId: id, type: item.type }, "Failed to auto-import marketplace item (download still counted)");
  }

  logger.info({ userId, itemId: id, type: item.type }, "Marketplace item installed");
  res.json({ content: item.content, type: item.type, name: item.name });
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
// POST /:id/star — toggle star
router.post("/:id/star", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id as string);
  const userId = String(req.userId);

  const existing = await prisma.marketplaceStar.findUnique({
    where: { userId_itemId: { userId, itemId: id } },
  });

  if (existing) {
    await prisma.marketplaceStar.delete({
      where: { userId_itemId: { userId, itemId: id } },
    });
    await prisma.marketplaceItem.update({
      where: { id },
      data: { stars: { decrement: 1 } },
    });
    res.json({ starred: false });
  } else {
    await prisma.marketplaceStar.create({
      data: { userId, itemId: id },
    });
    await prisma.marketplaceItem.update({
      where: { id },
      data: { stars: { increment: 1 } },
    });
    res.json({ starred: true });
  }
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
router.post("/:id/reviews", async (req: AuthRequest, res: Response) => {
  const itemId = String(req.params.id as string);
  const { rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    throw new AppError(400, "Rating must be between 1 and 5", "INVALID_RATING");
  }

  const item = await prisma.marketplaceItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new AppError(404, "Item not found", "ITEM_NOT_FOUND");
  }

  const review = await prisma.marketplaceReview.create({
    data: {
      itemId,
      userId: String(req.userId),
      rating: Math.round(rating),
      comment: comment || null,
    },
  });

  res.status(201).json(review);
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
router.get("/:id/reviews", async (req: AuthRequest, res: Response) => {
  const itemId = String(req.params.id as string);

  const reviews = await prisma.marketplaceReview.findMany({
    where: { itemId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json(reviews);
});

export default router;

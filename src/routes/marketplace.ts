import { Router, Response } from "express";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";

const router = Router();

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

// GET /:id — item detail with reviews
router.get("/:id", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
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

// PUT /:id — update item (author only)
router.put("/:id", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
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

// DELETE /:id — delete item (author or admin)
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
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

// POST /:id/install — increment downloads, import into user account, return content
router.post("/:id/install", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
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

// POST /:id/star — toggle star
router.post("/:id/star", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
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

// POST /:id/reviews — add review
router.post("/:id/reviews", async (req: AuthRequest, res: Response) => {
  const itemId = String(req.params.id);
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

// GET /:id/reviews — list reviews
router.get("/:id/reviews", async (req: AuthRequest, res: Response) => {
  const itemId = String(req.params.id);

  const reviews = await prisma.marketplaceReview.findMany({
    where: { itemId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json(reviews);
});

export default router;

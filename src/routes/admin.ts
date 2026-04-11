import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

// GET /users — list all users
router.get("/users", requireAuth, requireRole("admin"), async (_req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ users });
});

// PUT /users/:id/role — change user role
router.put("/users/:id/role", requireAuth, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  const { role } = req.body;
  const validRoles = ["admin", "member", "viewer"];
  if (!validRoles.includes(role)) {
    throw new AppError(400, `Role must be: ${validRoles.join(", ")}`, "INVALID_ROLE");
  }

  const user = await prisma.user.update({
    where: { id: parseInt(String(req.params.id)) },
    data: { role },
    select: { id: true, email: true, role: true },
  });

  res.json(user);
});

// POST /groups — create group
router.post("/groups", requireAuth, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name) throw new AppError(400, "Name required", "GROUP_NAME_REQUIRED");

  const group = await prisma.userGroup.create({ data: { name } });
  res.status(201).json(group);
});

// GET /groups — list groups
router.get("/groups", requireAuth, requireRole("admin"), async (_req: AuthRequest, res: Response) => {
  const groups = await prisma.userGroup.findMany({
    include: { members: { include: { user: { select: { id: true, email: true, username: true } } } } },
  });
  res.json({ groups });
});

// POST /groups/:id/members — add member
router.post("/groups/:id/members", requireAuth, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  const { userId } = req.body;
  if (!userId) throw new AppError(400, "userId required", "USER_ID_REQUIRED");

  await prisma.groupMembership.create({
    data: { userId: parseInt(userId), groupId: String(req.params.id) },
  });

  res.json({ success: true });
});

// DELETE /groups/:id/members/:userId — remove member
router.delete("/groups/:id/members/:userId", requireAuth, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  await prisma.groupMembership.delete({
    where: {
      userId_groupId: {
        userId: parseInt(String(req.params.userId)),
        groupId: String(req.params.id),
      },
    },
  });
  res.json({ success: true });
});

// GET /stats — system stats
router.get("/stats", requireAuth, requireRole("admin"), async (_req: AuthRequest, res: Response) => {
  const [totalUsers, totalConversations, totalChats] = await Promise.all([
    prisma.user.count(),
    prisma.conversation.count(),
    prisma.chat.count(),
  ]);

  res.json({ totalUsers, totalConversations, totalChats });
});

export default router;

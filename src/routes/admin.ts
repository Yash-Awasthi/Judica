import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import logger from "../lib/logger.js";

const router = Router();

/**
 * @openapi
 * /admin/users:
 *   get:
 *     summary: List all users
 *     description: Returns a list of all users with basic profile information. Requires admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A list of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       email:
 *                         type: string
 *                       username:
 *                         type: string
 *                       role:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin role required
 */
// GET /users — list all users
router.get("/users", requireAuth, requireRole("admin"), async (_req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ users });
});

/**
 * @openapi
 * /admin/users/{id}/role:
 *   put:
 *     summary: Change a user's role
 *     description: Updates the role for the specified user. Valid roles are admin, member, and viewer. Requires admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The user ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [admin, member, viewer]
 *     responses:
 *       200:
 *         description: Updated user object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 email:
 *                   type: string
 *                 role:
 *                   type: string
 *       400:
 *         description: Invalid role provided
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin role required
 */
// PUT /users/:id/role — change user role
router.put("/users/:id/role", requireAuth, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  const { role } = req.body;
  const validRoles = ["admin", "member", "viewer"];
  if (!validRoles.includes(role)) {
    throw new AppError(400, `Role must be: ${validRoles.join(", ")}`, "INVALID_ROLE");
  }

  const user = await prisma.user.update({
    where: { id: parseInt(String(req.params.id as string)) },
    data: { role },
    select: { id: true, email: true, role: true },
  });

  res.json(user);
});

/**
 * @openapi
 * /admin/groups:
 *   post:
 *     summary: Create a group
 *     description: Creates a new user group. Requires admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: The created group
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *       400:
 *         description: Name is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin role required
 */
// POST /groups — create group
router.post("/groups", requireAuth, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name) throw new AppError(400, "Name required", "GROUP_NAME_REQUIRED");

  const group = await prisma.userGroup.create({ data: { name } });
  res.status(201).json(group);
});

/**
 * @openapi
 * /admin/groups:
 *   get:
 *     summary: List all groups
 *     description: Returns all user groups with their members. Requires admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A list of groups with members
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 groups:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       members:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             user:
 *                               type: object
 *                               properties:
 *                                 id:
 *                                   type: integer
 *                                 email:
 *                                   type: string
 *                                 username:
 *                                   type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin role required
 */
// GET /groups — list groups
router.get("/groups", requireAuth, requireRole("admin"), async (_req: AuthRequest, res: Response) => {
  const groups = await prisma.userGroup.findMany({
    include: { members: { include: { user: { select: { id: true, email: true, username: true } } } } },
  });
  res.json({ groups });
});

/**
 * @openapi
 * /admin/groups/{id}/members:
 *   post:
 *     summary: Add a member to a group
 *     description: Adds a user to the specified group. Requires admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Member added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: userId is required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin role required
 */
// POST /groups/:id/members — add member
router.post("/groups/:id/members", requireAuth, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  const { userId } = req.body;
  if (!userId) throw new AppError(400, "userId required", "USER_ID_REQUIRED");

  await prisma.groupMembership.create({
    data: { userId: parseInt(userId), groupId: String(req.params.id as string) },
  });

  res.json({ success: true });
});

/**
 * @openapi
 * /admin/groups/{id}/members/{userId}:
 *   delete:
 *     summary: Remove a member from a group
 *     description: Removes a user from the specified group. Requires admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The user ID to remove
 *     responses:
 *       200:
 *         description: Member removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin role required
 */
// DELETE /groups/:id/members/:userId — remove member
router.delete("/groups/:id/members/:userId", requireAuth, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  await prisma.groupMembership.delete({
    where: {
      userId_groupId: {
        userId: parseInt(String(req.params.userId as string)),
        groupId: String(req.params.id as string),
      },
    },
  });
  res.json({ success: true });
});

/**
 * @openapi
 * /admin/stats:
 *   get:
 *     summary: Get system statistics
 *     description: Returns aggregate counts for users, conversations, and chats. Requires admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalUsers:
 *                   type: integer
 *                 totalConversations:
 *                   type: integer
 *                 totalChats:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin role required
 */
// GET /stats — system stats
router.get("/stats", requireAuth, requireRole("admin"), async (_req: AuthRequest, res: Response) => {
  const [totalUsers, totalConversations, totalChats] = await Promise.all([
    prisma.user.count(),
    prisma.conversation.count(),
    prisma.chat.count(),
  ]);

  res.json({ totalUsers, totalConversations, totalChats });
});

/**
 * @openapi
 * /admin/rotate-keys:
 *   post:
 *     summary: Rotate AES encryption keys
 *     description: Re-encrypts all stored secrets (custom provider auth keys and memory backend configs) from the old encryption key to a new one. Requires admin role.
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - old_key
 *               - new_key
 *             properties:
 *               old_key:
 *                 type: string
 *                 description: The current encryption key
 *               new_key:
 *                 type: string
 *                 description: The new encryption key (minimum 32 characters)
 *                 minLength: 32
 *     responses:
 *       200:
 *         description: Key rotation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 rotated:
 *                   type: integer
 *                   description: Number of secrets successfully re-encrypted
 *       400:
 *         description: Missing keys or new_key too short
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin role required
 */
// POST /rotate-keys — rotate AES encryption key (admin only)
router.post("/rotate-keys", requireAuth, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  const { old_key, new_key } = req.body;
  if (!old_key || !new_key) {
    throw new AppError(400, "old_key and new_key are required", "MISSING_KEYS");
  }
  if (new_key.length < 32) {
    throw new AppError(400, "new_key must be at least 32 characters", "KEY_TOO_SHORT");
  }

  const ALGO = "aes-256-gcm";

  function decrypt(encrypted: string, key: string): string {
    const buf = Buffer.from(encrypted, "base64");
    const iv = buf.subarray(0, 16);
    const tag = buf.subarray(16, 32);
    const ciphertext = buf.subarray(32);
    const derivedKey = scryptSync(key, "salt", 32);
    const decipher = createDecipheriv(ALGO, derivedKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
  }

  function encrypt(text: string, key: string): string {
    const iv = randomBytes(16);
    const derivedKey = scryptSync(key, "salt", 32);
    const cipher = createCipheriv(ALGO, derivedKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64");
  }

  let rotated = 0;

  // Rotate CustomProvider authKey fields
  const providers = await prisma.customProvider.findMany({ select: { id: true, authKey: true } });
  for (const p of providers) {
    try {
      const decrypted = decrypt(p.authKey, old_key);
      const reEncrypted = encrypt(decrypted, new_key);
      await prisma.customProvider.update({ where: { id: p.id }, data: { authKey: reEncrypted } });
      rotated++;
    } catch (err) {
      logger.warn({ err, providerId: p.id }, "Failed to rotate key for provider");
    }
  }

  // Rotate MemoryBackend config fields
  const backends = await prisma.memoryBackend.findMany({ select: { id: true, config: true } });
  for (const b of backends) {
    try {
      const decrypted = decrypt(b.config, old_key);
      const reEncrypted = encrypt(decrypted, new_key);
      await prisma.memoryBackend.update({ where: { id: b.id }, data: { config: reEncrypted } });
      rotated++;
    } catch (err) {
      logger.warn({ err, backendId: b.id }, "Failed to rotate key for memory backend");
    }
  }

  logger.info({ rotated, adminId: req.userId }, "Encryption key rotation completed");
  res.json({ message: "Key rotation complete", rotated });
});

export default router;

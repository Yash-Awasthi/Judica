import { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { userGroups, groupMemberships } from "../db/schema/social.js";
import { conversations, chats } from "../db/schema/conversations.js";
import { customProviders } from "../db/schema/council.js";
import { memoryBackends } from "../db/schema/memory.js";
import { eq, and, desc, count } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import logger from "../lib/logger.js";

function fastifyRequireRole(role: string) {
  return async (request: any, reply: any) => {
    // First run fastifyRequireAuth logic
    await fastifyRequireAuth(request, reply);
    // Then check role
    const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, request.userId)).limit(1);
    if (!row || row.role !== role) {
      throw new AppError(403, `Role '${role}' required`, "FORBIDDEN");
    }
  };
}

const adminPlugin: FastifyPluginAsync = async (fastify) => {
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
  fastify.get("/users", { preHandler: fastifyRequireRole("admin") }, async (request, reply) => {
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
    return { users: allUsers };
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
  fastify.put("/users/:id/role", { preHandler: fastifyRequireRole("admin") }, async (request, reply) => {
    const { role } = request.body as any;
    const validRoles = ["admin", "member", "viewer"];
    if (!validRoles.includes(role)) {
      throw new AppError(400, `Role must be: ${validRoles.join(", ")}`, "INVALID_ROLE");
    }

    const { id } = request.params as any;
    const [updated] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, parseInt(String(id))))
      .returning({ id: users.id, email: users.email, role: users.role });

    return updated;
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
  fastify.post("/groups", { preHandler: fastifyRequireRole("admin") }, async (request, reply) => {
    const { name } = request.body as any;
    if (!name) throw new AppError(400, "Name required", "GROUP_NAME_REQUIRED");

    const [group] = await db.insert(userGroups).values({ id: crypto.randomUUID(), name }).returning();
    reply.code(201);
    return group;
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
  fastify.get("/groups", { preHandler: fastifyRequireRole("admin") }, async (request, reply) => {
    const allGroups = await db.select().from(userGroups);

    const memberships = await db
      .select({
        userId: groupMemberships.userId,
        groupId: groupMemberships.groupId,
        userIdRef: users.id,
        email: users.email,
        username: users.username,
      })
      .from(groupMemberships)
      .innerJoin(users, eq(groupMemberships.userId, users.id));

    const groups = allGroups.map((g) => ({
      ...g,
      members: memberships
        .filter((m) => m.groupId === g.id)
        .map((m) => ({ user: { id: m.userIdRef, email: m.email, username: m.username } })),
    }));

    return { groups };
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
  fastify.post("/groups/:id/members", { preHandler: fastifyRequireRole("admin") }, async (request, reply) => {
    const { userId } = request.body as any;
    if (!userId) throw new AppError(400, "userId required", "USER_ID_REQUIRED");

    const { id } = request.params as any;
    await db.insert(groupMemberships).values({
      userId: parseInt(userId),
      groupId: String(id),
    });

    return { success: true };
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
  fastify.delete("/groups/:id/members/:userId", { preHandler: fastifyRequireRole("admin") }, async (request, reply) => {
    const { id, userId } = request.params as any;
    await db
      .delete(groupMemberships)
      .where(
        and(
          eq(groupMemberships.userId, parseInt(String(userId))),
          eq(groupMemberships.groupId, String(id)),
        ),
      );
    return { success: true };
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
  fastify.get("/stats", { preHandler: fastifyRequireRole("admin") }, async (request, reply) => {
    const [[userCount], [convCount], [chatCount]] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(conversations),
      db.select({ value: count() }).from(chats),
    ]);

    return {
      totalUsers: userCount.value,
      totalConversations: convCount.value,
      totalChats: chatCount.value,
    };
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
  fastify.post("/rotate-keys", { preHandler: fastifyRequireRole("admin") }, async (request, reply) => {
    const { old_key, new_key } = request.body as any;
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
      // Legacy data used hardcoded "salt"; use IV as salt for key derivation
      // to provide per-record uniqueness (BE-4: per-user random salt)
      const derivedKey = scryptSync(key, iv, 32);
      const decipher = createDecipheriv(ALGO, derivedKey, iv);
      decipher.setAuthTag(tag);
      try {
        return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
      } catch {
        // Fallback: try legacy hardcoded salt for pre-migration data.
        // This path only runs once per record — after decryption succeeds,
        // the record is immediately re-encrypted with IV-as-salt (line 508-515),
        // permanently removing the legacy salt dependency.
        const legacySalt = "salt";
        const legacyKey = scryptSync(key, legacySalt, 32);
        const legacyDecipher = createDecipheriv(ALGO, legacyKey, iv);
        legacyDecipher.setAuthTag(tag);
        logger.warn("Decrypting with legacy hardcoded salt — record will be re-encrypted with per-record salt on this rotation");
        return legacyDecipher.update(ciphertext, undefined, "utf8") + legacyDecipher.final("utf8");
      }
    }

    function encrypt(text: string, key: string): string {
      const iv = randomBytes(16);
      const derivedKey = scryptSync(key, iv, 32);
      const cipher = createCipheriv(ALGO, derivedKey, iv);
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]).toString("base64");
    }

    let rotated = 0;

    // Rotate CustomProvider authKey fields
    const providers = await db
      .select({ id: customProviders.id, authKey: customProviders.authKey })
      .from(customProviders);
    for (const p of providers) {
      try {
        const decrypted = decrypt(p.authKey, old_key);
        const reEncrypted = encrypt(decrypted, new_key);
        await db
          .update(customProviders)
          .set({ authKey: reEncrypted })
          .where(eq(customProviders.id, p.id));
        rotated++;
      } catch (err) {
        logger.warn({ err, providerId: p.id }, "Failed to rotate key for provider");
      }
    }

    // Rotate MemoryBackend config fields
    const backends = await db
      .select({ id: memoryBackends.id, config: memoryBackends.config })
      .from(memoryBackends);
    for (const b of backends) {
      try {
        const decrypted = decrypt(b.config, old_key);
        const reEncrypted = encrypt(decrypted, new_key);
        await db
          .update(memoryBackends)
          .set({ config: reEncrypted })
          .where(eq(memoryBackends.id, b.id));
        rotated++;
      } catch (err) {
        logger.warn({ err, backendId: b.id }, "Failed to rotate key for memory backend");
      }
    }

    logger.info({ rotated, adminId: request.userId }, "Encryption key rotation completed");
    return { message: "Key rotation complete", rotated };
  });
};

export default adminPlugin;

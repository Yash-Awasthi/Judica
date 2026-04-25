import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  generateSecret,
  verifyTOTP,
  enableMFA,
  disableMFA,
  verifyBackupCode,
  isMFARequired,
  regenerateBackupCodes,
} from "../services/mfa.service.js";

const mfaPlugin: FastifyPluginAsync = async (fastify) => {
  // POST /api/mfa/setup — generate TOTP secret + QR code (auth required)
  fastify.post("/setup", { preHandler: [fastifyRequireAuth] }, async (request, reply) => {
    const userId = request.userId!;
    const { secret, qrCodeDataUrl, backupCodes } = await generateSecret(userId);
    reply.code(201);
    return {
      secret,
      qrCodeDataUrl,
      backupCodes,
      message:
        "Scan the QR code with your authenticator app, then call /api/mfa/verify-setup with a valid token to enable MFA.",
    };
  });

  // POST /api/mfa/verify-setup — confirm TOTP token to activate MFA (auth required)
  fastify.post("/verify-setup", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { token } = request.body as { token?: string };
    if (!token || typeof token !== "string") {
      throw new AppError(400, "token is required");
    }
    await enableMFA(request.userId!, token);
    return { success: true, message: "MFA enabled successfully." };
  });

  // POST /api/mfa/verify — verify TOTP during login (no auth, public endpoint)
  fastify.post("/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, _reply) => {
    const { userId, token, backupCode } = request.body as {
      userId?: number;
      token?: string;
      backupCode?: string;
    };

    if (!userId || typeof userId !== "number") {
      throw new AppError(400, "userId is required");
    }

    // Disallow providing both — forces explicit choice to prevent unintended bypass
    if (backupCode && token) {
      throw new AppError(400, "Provide either token or backupCode, not both");
    }

    // Support backup code fallback
    if (backupCode) {
      const valid = await verifyBackupCode(userId, backupCode);
      if (!valid) throw new AppError(401, "Invalid backup code");
      return { valid: true, method: "backup_code" };
    }

    if (!token || typeof token !== "string") {
      throw new AppError(400, "token or backupCode is required");
    }

    const valid = await verifyTOTP(userId, token);
    if (!valid) throw new AppError(401, "Invalid or expired TOTP token");
    return { valid: true, method: "totp" };
  });

  // POST /api/mfa/disable — disable MFA (auth required + password confirmation)
  fastify.post("/disable", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { password } = request.body as { password?: string };
    if (!password || typeof password !== "string") {
      throw new AppError(400, "password is required to disable MFA");
    }
    await disableMFA(request.userId!, password);
    return { success: true, message: "MFA disabled." };
  });

  // GET /api/mfa/status — check current user's MFA status (auth required)
  fastify.get("/status", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const enabled = await isMFARequired(request.userId!);
    return { enabled };
  });

  // POST /api/mfa/backup-codes — regenerate backup codes (auth required)
  fastify.post("/backup-codes", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const codes = await regenerateBackupCodes(request.userId!);
    return {
      backupCodes: codes,
      message:
        "Store these codes securely. They will not be shown again and replace your previous backup codes.",
    };
  });
};

export default mfaPlugin;

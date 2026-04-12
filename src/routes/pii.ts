import { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { detectPII } from "../lib/pii.js";
import logger from "../lib/logger.js";
import { AppError } from "../middleware/errorHandler.js";

interface PiiCheckRequest {
  text: string;
  enforce?: boolean; // If true, reject if PII found
}

interface PiiCheckResponse {
  found: boolean;
  types: string[];
  riskScore: number;
  anonymized: string;
  allowed: boolean;
  message?: string;
}

const piiPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /api/pii/check:
   *   post:
   *     tags:
   *       - Admin
   *     summary: Check text for personally identifiable information (PII)
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - text
   *             properties:
   *               text:
   *                 type: string
   *                 description: Text to scan for PII
   *               enforce:
   *                 type: boolean
   *                 default: false
   *                 description: If true, reject when PII is found
   *     responses:
   *       200:
   *         description: PII detection result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 found:
   *                   type: boolean
   *                 types:
   *                   type: array
   *                   items:
   *                     type: string
   *                 riskScore:
   *                   type: number
   *                 anonymized:
   *                   type: string
   *                 allowed:
   *                   type: boolean
   *                 message:
   *                   type: string
   *       400:
   *         description: Text is required
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: PII check failed
   */
  fastify.post("/check", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    try {
      const { text, enforce = false } = request.body as PiiCheckRequest;

      if (!text || typeof text !== "string") {
        reply.code(400);
        return { error: "Text is required" };
      }

      const detection = detectPII(text);

      const riskWeights: Record<string, number> = {
        email: 30,
        phone: 40,
        ssn: 100,
        creditCard: 90,
        apiKey: 80,
        ipAddress: 20,
      };

      const riskScore = detection.types.reduce((score: number, type: string) =>
        score + (riskWeights[type] || 10), detection.riskScore
      );

      const response: PiiCheckResponse = {
        found: detection.found,
        types: detection.types,
        riskScore,
        anonymized: detection.anonymized,
        allowed: !enforce || !detection.found || riskScore < 50,
        message: detection.found
          ? `PII detected: ${detection.types.join(", ")}. Risk score: ${riskScore}`
          : undefined,
      };

      if (riskScore >= 70) {
        logger.warn({
          userId: request.userId,
          types: detection.types,
          riskScore
        }, "High-risk PII detected in request");
      }

      return response;
    } catch (err) {
      logger.error({ err, userId: request.userId }, "PII check failed");
      throw new AppError(500, "PII check failed", "PII_CHECK_FAILED");
    }
  });
};

export default piiPlugin;

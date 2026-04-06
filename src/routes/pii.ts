import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { detectPII, type PIIDetection } from "../lib/pii.js";
import logger from "../lib/logger.js";

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

const router = Router();

router.post("/check", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { text, enforce = false } = req.body as PiiCheckRequest;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
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
        userId: req.userId, 
        types: detection.types,
        riskScore 
      }, "High-risk PII detected in request");
    }

    res.json(response);
  } catch (err) {
    logger.error({ err, userId: req.userId }, "PII check failed");
    res.status(500).json({ error: "PII check failed" });
  }
});

export function piiEnforcementMiddleware(
  req: AuthRequest, 
  res: Response, 
  next: () => void
) {
  const question = req.body?.question || req.body?.prompt;
  
  if (!question || typeof question !== "string") {
    return next();
  }

  const detection = detectPII(question);
  
  if (detection.found) {
    const riskScore = detection.types.reduce((score: number, type: string) => {
      const weights: Record<string, number> = {
        email: 30, phone: 40, ssn: 100, credit_card: 90, bank_account: 90,
        passport: 80, apiKey: 80, ip_address: 20,
      };
      return score + (weights[type] || 10);
    }, detection.riskScore);

    if (riskScore >= 70) {
      logger.warn({ 
        userId: req.userId, 
        types: detection.types,
        riskScore 
      }, "Request blocked due to high-risk PII");
      
      return res.status(400).json({
        error: "High-risk PII detected",
        types: detection.types,
        riskScore,
        message: "Request blocked. Please remove sensitive information or use the anonymized version.",
        anonymized: detection.anonymized,
      });
    }

    if (riskScore >= 30) {
      logger.info({ 
        userId: req.userId, 
        types: detection.types,
        riskScore 
      }, "Medium-risk PII detected, allowing with warning");
      
      (req as AuthRequest & { piiWarning?: PIIDetection }).piiWarning = detection;
    }
  }

  next();
}

export default router;

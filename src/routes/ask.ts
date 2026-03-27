import { Router, Response } from "express";
import { askProvider } from "../lib/providers.js";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import { optionalAuth, AuthRequest } from "../middleware/auth.js";
import { validate, askSchema } from "../middleware/validate.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

router.post("/", optionalAuth, validate(askSchema), async (req: AuthRequest, res: Response, next) => {
  const { question, members, master } = req.body;
  const startTime = Date.now();

  try {
    logger.info({ question: question.slice(0, 80), memberCount: members.length }, "Council ask started");

    // Ask all council members simultaneously
    const opinions = await Promise.all(
      members.map(async (m: any) => {
        try {
          const answer = await askProvider(m, question);
          return { name: m.name, answer, error: false };
        } catch (e: any) {
          logger.warn({ member: m.name, error: e.message }, "Member failed");
          return { name: m.name, answer: `[${m.name} failed to respond]`, error: true };
        }
      })
    );

    // Only synthesize successful responses
    const successfulOpinions = opinions.filter(o => !o.error);
    if (successfulOpinions.length === 0) {
      throw new AppError(502, "All council members failed to respond");
    }

    // Build synthesis prompt
    const synthesisPrompt = `You are the master of an AI council. Multiple AI models were asked:

"${question}"

Their responses:
${successfulOpinions.map((o, i) => `[${i + 1}] ${o.name}:\n${o.answer}`).join("\n\n")}

Write a single synthesized verdict. Be concise and direct. Note where models agreed or disagreed.`;

    let verdict = "";
    try {
      verdict = await askProvider({ ...master, systemPrompt: undefined }, synthesisPrompt);
    } catch (e: any) {
      logger.error({ error: e.message }, "Master synthesis failed");
      verdict = successfulOpinions.map(o => `**${o.name}:** ${o.answer}`).join("\n\n");
    }

    // Save to PostgreSQL via Prisma
    await prisma.chat.create({
      data: {
        userId: req.userId ?? null,
        question,
        verdict,
        opinions,
      },
    });

    const duration = Date.now() - startTime;
    logger.info({ duration, memberCount: members.length }, "Council ask completed");

    res.json({ verdict, opinions, duration });
  } catch (e) {
    next(e);
  }
});

export default router;
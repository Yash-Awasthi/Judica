import { Router, Response } from "express";
import { askProviderStream, askProvider } from "../lib/providers.js";
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
    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("start", { memberCount: members.length });

    // Ask all members simultaneously with streaming
    const opinions = await Promise.all(
      members.map(async (m: any) => {
        let fullAnswer = "";
        try {
          send("member_start", { name: m.name });
          
          const memberWithPrompt = {
            ...m,
            systemPrompt: (m.systemPrompt || "") + "\nRespond directly and concisely. Do not narrate your reasoning process. Just give the answer.",
          };
          fullAnswer = await askProviderStream(memberWithPrompt, question, (chunk: string) => {

            send("member_chunk", { name: m.name, chunk });
          });
          fullAnswer = fullAnswer.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
          send("member_done", { name: m.name });
          return { name: m.name, answer: fullAnswer, error: false };
        } catch (e: any) {
          logger.warn({ member: m.name, error: e.message }, "Member failed");
          send("member_error", { name: m.name, error: e.message });
          return { name: m.name, answer: `[${m.name} failed to respond]`, error: true };
        }
      })
    );

    const successfulOpinions = opinions.filter(o => !o.error);
    if (successfulOpinions.length === 0) {
      send("error", { message: "All council members failed to respond" });
      res.end();
      return;
    }

    // Master synthesis with streaming
    send("master_start", { name: master.name });

    const synthesisPrompt = `You are the master of an AI council. Multiple AI models were asked:

"${question}"

Their responses:
${successfulOpinions.map((o, i) => `[${i + 1}] ${o.name}:\n${o.answer}`).join("\n\n")}

Write a single synthesized verdict. Be concise and direct. Note where models agreed or disagreed.`;

    let verdict = "";
    try {
      verdict = await askProviderStream(
  { ...master, systemPrompt: "You are a council master. Be concise and direct. Do not narrate your reasoning. Just synthesize and conclude." },
  synthesisPrompt,
          (chunk: string) => send("master_chunk", { chunk })
        );
      verdict = verdict.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    } catch (e: any) {
      logger.error({ error: e.message }, "Master streaming failed, falling back");
      try {
        verdict = await askProvider({ ...master, systemPrompt: undefined }, synthesisPrompt);
      } catch {
        verdict = successfulOpinions.map(o => `**${o.name}:** ${o.answer}`).join("\n\n");
      }
    }

    send("master_done", {});

    // Save to DB
    await prisma.chat.create({
      data: {
        userId: req.userId ?? null,
        question,
        verdict,
        opinions,
      },
    });

    const duration = Date.now() - startTime;
    send("done", { duration });
    res.end();

  } catch (e) {
    next(e);
  }
});

export default router;
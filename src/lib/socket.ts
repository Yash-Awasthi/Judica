import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { streamCouncil, prepareCouncilMembers } from "./council.js";
import { getRecentHistory } from "./history.js";
import prisma from "./db.js";
import logger from "./logger.js";
import { Message } from "./providers.js";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { DAILY_REQUEST_LIMIT, DAILY_TOKEN_LIMIT } from "../config/quotas.js";

// Basic authentication logic could be hooked here if needed.
// For now, we will assume optionally authenticated via a token sent in the handshake.

export function initSocket(server: HttpServer) {
  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000"];

  const io = new SocketIOServer(server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error("CORS Policy: WebSocket origin not allowed"));
      },
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket: Socket) => {
    logger.debug({ socketId: socket.id }, "Client connected via WebSocket");

    // ── Per-socket rate limit (in-memory, sliding window) ─────────────────────
    const MAX_ASKS_PER_MINUTE = 10;
    let askCount = 0;
    let askWindowStart = Date.now();

    socket.on("ask", async (payload: any) => {
      // Reset window if a minute has elapsed
      const now = Date.now();
      if (now - askWindowStart > 60_000) {
        askCount = 0;
        askWindowStart = now;
      }
      askCount++;
      if (askCount > MAX_ASKS_PER_MINUTE) {
        return socket.emit("error", { message: `Rate limit: max ${MAX_ASKS_PER_MINUTE} asks per minute on this connection.` });
      }
      const startTime = Date.now();
      
      try {
        const { question, members, master, conversationId, summon, maxTokens, rounds = 1, context, token } = payload;
        
        let userId = socket.handshake.auth?.userId || null;
        if (token && !userId) {
          try {
            const decoded = jwt.verify(token, env.JWT_SECRET) as any;
            userId = decoded.userId;
          } catch (e: any) {
            logger.debug({ err: e.message, socketId: socket.id }, "WebSocket JWT verification failed; proceeding as guest");
          }
        }
        
        // --- 1. PRE-CHECK QUOTA ---
        if (userId) {
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);
          const usage = await prisma.dailyUsage.upsert({
            where: { userId_date: { userId, date: today } },
            update: { requests: { increment: 1 } },
            create: { userId, date: today, requests: 1 }
          });

          if (usage.requests > DAILY_REQUEST_LIMIT || usage.tokens > DAILY_TOKEN_LIMIT) {
            return socket.emit("error", { message: "Daily request or token quota exceeded." });
          }
        }

        let effectiveConversationId = conversationId;
        let messages: Message[] = [];

        if (effectiveConversationId) {
          const convo = await prisma.conversation.findFirst({
            where: { id: effectiveConversationId, userId: userId ?? null },
            select: { id: true }
          });
          if (convo) {
            messages = await getRecentHistory(effectiveConversationId);
          }
        }

        const councilMembers = await prepareCouncilMembers(members, summon, userId);
        const questionWithContext = context ? `GROUND TRUTH CONTEXT:\n${context}\n\n---\n\nQUESTION: ${question}` : question;
        const currentMessages = [...messages, { role: "user" as const, content: questionWithContext }];

        socket.emit("status", { message: "Council summoned", members: councilMembers.map((m: any) => m.name) });

        let finalVerdict = "";
        const finalOpinions: any[] = [];

        let totalTokensUsed = 0;

        const abortController = new AbortController();
        const onDisconnect = () => abortController.abort();
        socket.on("disconnect", onDisconnect);

        // Stream the deliberation over the socket connection
        try {
          await streamCouncil(
            councilMembers,
            master,
            currentMessages,
            (event: string, data: any) => {
              if (abortController.signal.aborted) return;
              socket.emit(event, data);
              if (event === "opinion") finalOpinions.push(data);
              if (event === "done") {
                finalVerdict = data.verdict || "";
                totalTokensUsed = data.tokensUsed || 0;
              }
            },
            maxTokens,
            rounds,
            abortController.signal
          );
        } finally {
          socket.off("disconnect", onDisconnect);
        }

        if (abortController.signal.aborted) {
          logger.warn({ socketId: socket.id }, "Client disconnected before stream completed");
          return;
        }

        if (userId) {
          if (!effectiveConversationId) {
            const newConvo = await prisma.conversation.create({
              data: { 
                userId,
                title: question.slice(0, 50) + (question.length > 50 ? "..." : "")
              }
            });
            effectiveConversationId = newConvo.id;
          }

          await prisma.chat.create({
            data: {
              userId,
              conversationId: effectiveConversationId,
              question,
              verdict: finalVerdict,
              opinions: finalOpinions,
              tokensUsed: totalTokensUsed,
              durationMs: Date.now() - startTime,
            }
          });

          // --- 2. UPDATE TOKEN USAGE (UPSERT & TYPE-SAFE) ---
          if (totalTokensUsed > 0) {
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            await prisma.dailyUsage.upsert({
              where: { userId_date: { userId, date: today } },
              update: { tokens: { increment: totalTokensUsed } },
              create: { userId, date: today, tokens: totalTokensUsed, requests: 1 }
            }).catch((err: any) => logger.error({ err, userId, tokensUsed: totalTokensUsed }, "Failed to update daily token usage from socket"));
          }
        }

        socket.emit("complete", { conversationId: effectiveConversationId, latency: Date.now() - startTime });

      } catch (e: any) {
        logger.error({ err: e.message, socketId: socket.id }, "WebSocket ask error");
        socket.emit("error", { message: e.message });
      }
    });

    socket.on("disconnect", () => {
      logger.debug({ socketId: socket.id }, "Client disconnected from WebSocket");
    });
  });

  return io;
}

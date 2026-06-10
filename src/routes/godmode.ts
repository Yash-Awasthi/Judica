/**
 * GODMODE CLASSIC — POST /api/godmode/stream
 *
 * Raw parallel multi-model query. Fire all council members simultaneously,
 * stream each response as it arrives. No composite scoring — pure speed comparison.
 *
 * The "classic" G0DM0D3 experience: minimal, fast, no frills.
 *
 * SSE events:
 *   init      — { memberCount: number, members: SlotInfo[] }
 *   response  — { id, label, model, text, latencyMs, tokens, status, error? }
 *   done      — { totalMs, responseCount, successCount, fastestId, fastestLabel }
 *   error     — { message }
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyOptionalAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { createProvider } from "../lib/providers/factory.js";
import logger from "../lib/logger.js";
import { env } from "../config/env.js";

const log = logger.child({ route: "godmode" });

// ── Types ────────────────────────────────────────────────────────────────────

interface GodModeSlot {
  id:        string;
  label:     string;
  provider:  string;
  model:     string;
  apiKey?:   string;
  baseUrl?:  string;
}

interface GodModeRequest {
  question:   string;
  members?:   GodModeSlot[];  // user-supplied council (optional — uses env defaults if absent)
  systemPrompt?: string;
}

// ── Default member pool (top-tier picks, no scoring pressure) ─────────────────

const DEFAULT_GODMODE_MEMBERS: GodModeSlot[] = [
  { id: "gpt-4o",            label: "GPT-4o",           provider: "openai",     model: "gpt-4o"                         },
  { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet",provider: "anthropic",  model: "claude-3-5-sonnet-20241022"     },
  { id: "gemini-2-flash",    label: "Gemini 2.0 Flash", provider: "google",     model: "gemini-2.0-flash"               },
  { id: "llama-3-3-70b",     label: "Llama 3.3 70B",    provider: "groq",       model: "llama-3.3-70b-versatile", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "mistral-large",     label: "Mistral Large",    provider: "mistral",    model: "mistral-large-latest",    baseUrl: "https://api.mistral.ai/v1"    },
];

const MAX_MEMBERS = 20;

// ── Route plugin ─────────────────────────────────────────────────────────────

const godmodePlugin: FastifyPluginAsync = async (fastify) => {

  // GET /api/godmode — describe the feature
  fastify.get("/", async (_req, _reply) => {
    return {
      description: "GODMODE CLASSIC — raw parallel multi-model compare",
      defaultMembers: DEFAULT_GODMODE_MEMBERS.map((m) => ({ id: m.id, label: m.label, model: m.model })),
      maxCustomMembers: MAX_MEMBERS,
    };
  });

  // POST /api/godmode/stream — SSE streaming compare
  fastify.post<{ Body: GodModeRequest }>(
    "/stream",
    { preHandler: fastifyOptionalAuth },
    async (request, reply) => {
      const { question, members: customMembers, systemPrompt } = request.body ?? {};

      if (!question?.trim()) {
        throw new AppError(400, "question is required", "MISSING_QUESTION");
      }

      // Validate custom members if supplied
      const rawMembers = customMembers && customMembers.length > 0
        ? customMembers.slice(0, MAX_MEMBERS)
        : DEFAULT_GODMODE_MEMBERS;

      if (rawMembers.length === 0) {
        throw new AppError(400, "No council members available", "NO_MEMBERS");
      }

      // ── Open SSE ────────────────────────────────────────────────────────────

      reply.raw.writeHead(200, {
        "Content-Type":               "text/event-stream",
        "Cache-Control":              "no-cache",
        "Connection":                 "keep-alive",
        "X-Accel-Buffering":          "no",
        "Access-Control-Allow-Origin": "*",
      });

      const emit = (type: string, data: Record<string, unknown>) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }
      };

      const controller = new AbortController();
      request.raw.on("close",  () => controller.abort());
      request.raw.on("error",  () => controller.abort());

      try {
        emit("init", {
          memberCount: rawMembers.length,
          members: rawMembers.map((m) => ({ id: m.id, label: m.label, model: m.model, provider: m.provider })),
        });

        const startAll = Date.now();
        let fastestId    = "";
        let fastestMs    = Infinity;
        let successCount = 0;

        const sysPrompt = systemPrompt?.trim() ||
          "You are a direct, accurate AI assistant. Answer concisely and confidently.";

        // Fire all members in parallel
        const jobs = rawMembers.map(async (member) => {
          const startMs = Date.now();
          try {
            // Resolve API key — member-supplied wins, then env lookup
            const apiKey = member.apiKey
              || (env as Record<string, string>)[`${member.provider.toUpperCase()}_API_KEY`]
              || "";

            const providerConfig = {
              name:    member.provider,
              model:   member.model,
              apiKey,
              baseUrl: member.baseUrl,
            };

            const prov = createProvider(providerConfig);
            const resp = await prov.chat(
              [
                { role: "system",  content: sysPrompt        },
                { role: "user",    content: question.trim()   },
              ],
              { signal: controller.signal }
            );

            const latencyMs = Date.now() - startMs;
            const text      = resp.content ?? "";
            const tokens    = resp.usage?.totalTokens ?? Math.ceil(text.length / 4);

            if (latencyMs < fastestMs) {
              fastestMs = latencyMs;
              fastestId = member.id;
            }
            successCount++;

            emit("response", {
              id:        member.id,
              label:     member.label,
              model:     member.model,
              text,
              latencyMs,
              tokens,
              status:    "done",
            });
          } catch (err) {
            const latencyMs = Date.now() - startMs;
            const errMsg    = err instanceof Error ? err.message : "Unknown error";
            log.warn({ err, memberId: member.id }, "GODMODE member failed");

            emit("response", {
              id:        member.id,
              label:     member.label,
              model:     member.model,
              text:      "",
              latencyMs,
              tokens:    0,
              status:    "error",
              error:     errMsg,
            });
          }
        });

        await Promise.allSettled(jobs);

        emit("done", {
          totalMs:       Date.now() - startAll,
          responseCount: rawMembers.length,
          successCount,
          fastestId,
          fastestLabel:  rawMembers.find((m) => m.id === fastestId)?.label ?? "",
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : "GODMODE stream failed";
        log.error({ err }, "GODMODE stream error");
        emit("error", { message: msg });
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    }
  );
};

export default godmodePlugin;

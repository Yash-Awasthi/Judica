/**
 * Surface Access Routes — manage embeddable widgets and multi-surface access tokens.
 *
 * Endpoints:
 *   POST   /widgets           — Create widget config
 *   GET    /widgets           — List user's widgets
 *   PUT    /widgets/:id       — Update widget config
 *   DELETE /widgets/:id       — Delete widget
 *   POST   /tokens            — Generate surface access token
 *   GET    /tokens            — List surface tokens
 *   DELETE /tokens/:id        — Revoke surface token
 *   GET    /stats             — Usage stats per surface
 *   POST   /widget-ask        — Public endpoint for widget (validates apiKey + origin)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import {
  createWidget,
  getWidgets,
  updateWidget,
  deleteWidget,
  getWidgetByApiKey,
  generateSurfaceToken,
  revokeSurfaceToken,
  getSurfaceTokens,
  getSurfaceUsageStats,
  VALID_SURFACES,
  VALID_THEMES,
  VALID_POSITIONS,
  type Surface,
  type WidgetTheme,
  type WidgetPosition,
} from "../services/surfaceAccess.service.js";

const surfaceAccessPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── Widget CRUD (authenticated) ──────────────────────────────────────────

  fastify.post("/widgets", { onRequest: [fastifyRequireAuth] }, async (request, reply) => {
    const body = request.body as {
      name?: string;
      allowedOrigins?: string[];
      theme?: string;
      position?: string;
      customCss?: string;
    };

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      reply.code(400);
      return { error: "name is required" };
    }
    if (body.name.length > 100) {
      reply.code(400);
      return { error: "name must be 100 characters or fewer" };
    }

    if (body.allowedOrigins !== undefined) {
      if (!Array.isArray(body.allowedOrigins) || body.allowedOrigins.some((o) => typeof o !== "string")) {
        reply.code(400);
        return { error: "allowedOrigins must be an array of strings" };
      }
      if (body.allowedOrigins.length > 50) {
        reply.code(400);
        return { error: "allowedOrigins must contain 50 entries or fewer" };
      }
    }

    if (body.theme !== undefined && !(VALID_THEMES as readonly string[]).includes(body.theme)) {
      reply.code(400);
      return { error: `Invalid theme. Valid: ${VALID_THEMES.join(", ")}` };
    }

    if (body.position !== undefined && !(VALID_POSITIONS as readonly string[]).includes(body.position)) {
      reply.code(400);
      return { error: `Invalid position. Valid: ${VALID_POSITIONS.join(", ")}` };
    }

    const widget = await createWidget(request.userId!, {
      name: body.name.trim(),
      allowedOrigins: body.allowedOrigins,
      theme: (body.theme as WidgetTheme) ?? undefined,
      position: (body.position as WidgetPosition) ?? undefined,
      customCss: body.customCss,
    });

    reply.code(201);
    return { widget };
  });

  fastify.get("/widgets", { onRequest: [fastifyRequireAuth] }, async (request) => {
    const widgets = await getWidgets(request.userId!);
    return { widgets };
  });

  fastify.put("/widgets/:id", { onRequest: [fastifyRequireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      allowedOrigins?: string[];
      theme?: string;
      position?: string;
      customCss?: string | null;
      isActive?: boolean;
    };

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        reply.code(400);
        return { error: "name must be a non-empty string" };
      }
      if (body.name.length > 100) {
        reply.code(400);
        return { error: "name must be 100 characters or fewer" };
      }
    }

    if (body.allowedOrigins !== undefined) {
      if (!Array.isArray(body.allowedOrigins) || body.allowedOrigins.some((o) => typeof o !== "string")) {
        reply.code(400);
        return { error: "allowedOrigins must be an array of strings" };
      }
    }

    if (body.theme !== undefined && !(VALID_THEMES as readonly string[]).includes(body.theme)) {
      reply.code(400);
      return { error: `Invalid theme. Valid: ${VALID_THEMES.join(", ")}` };
    }

    if (body.position !== undefined && !(VALID_POSITIONS as readonly string[]).includes(body.position)) {
      reply.code(400);
      return { error: `Invalid position. Valid: ${VALID_POSITIONS.join(", ")}` };
    }

    const updated = await updateWidget(id, request.userId!, {
      name: body.name?.trim(),
      allowedOrigins: body.allowedOrigins,
      theme: body.theme as WidgetTheme | undefined,
      position: body.position as WidgetPosition | undefined,
      customCss: body.customCss,
      isActive: body.isActive,
    });

    if (!updated) {
      reply.code(404);
      return { error: "Widget not found" };
    }

    return { widget: updated };
  });

  fastify.delete("/widgets/:id", { onRequest: [fastifyRequireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const deleted = await deleteWidget(id, request.userId!);
    if (!deleted) {
      reply.code(404);
      return { error: "Widget not found" };
    }

    reply.code(204);
  });

  // ─── Token CRUD (authenticated) ───────────────────────────────────────────

  fastify.post(
    "/tokens",
    { onRequest: [fastifyRequireAuth], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body as {
        surface?: string;
        label?: string;
        expiresInDays?: number;
      };

      if (!body.label || typeof body.label !== "string" || body.label.trim().length === 0) {
        reply.code(400);
        return { error: "label is required" };
      }
      if (body.label.length > 100) {
        reply.code(400);
        return { error: "label must be 100 characters or fewer" };
      }

      if (!body.surface || !(VALID_SURFACES as readonly string[]).includes(body.surface)) {
        reply.code(400);
        return { error: `Invalid surface. Valid: ${VALID_SURFACES.join(", ")}` };
      }

      if (body.expiresInDays !== undefined) {
        if (!Number.isInteger(body.expiresInDays) || body.expiresInDays < 1 || body.expiresInDays > 365) {
          reply.code(400);
          return { error: "expiresInDays must be between 1 and 365" };
        }
      }

      const result = await generateSurfaceToken(
        request.userId!,
        body.surface as Surface,
        body.label.trim(),
        body.expiresInDays,
      );

      reply.code(201);
      return result;
    },
  );

  fastify.get("/tokens", { onRequest: [fastifyRequireAuth] }, async (request) => {
    const tokens = await getSurfaceTokens(request.userId!);
    return { tokens };
  });

  fastify.delete("/tokens/:id", { onRequest: [fastifyRequireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const revoked = await revokeSurfaceToken(id, request.userId!);
    if (!revoked) {
      reply.code(404);
      return { error: "Token not found" };
    }

    reply.code(204);
  });

  // ─── Usage Stats (authenticated) ──────────────────────────────────────────

  fastify.get("/stats", { onRequest: [fastifyRequireAuth] }, async (request) => {
    const stats = await getSurfaceUsageStats(request.userId!);
    return stats;
  });

  // ─── Widget Ask — public endpoint (apiKey + origin validation) ────────────

  fastify.post(
    "/widget-ask",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body as {
        apiKey?: string;
        message?: string;
      };

      if (!body.apiKey || typeof body.apiKey !== "string") {
        reply.code(401);
        return { error: "apiKey is required" };
      }

      if (!body.message || typeof body.message !== "string" || body.message.trim().length === 0) {
        reply.code(400);
        return { error: "message is required" };
      }

      if (body.message.length > 4000) {
        reply.code(400);
        return { error: "message must be 4000 characters or fewer" };
      }

      const widget = await getWidgetByApiKey(body.apiKey);
      if (!widget) {
        reply.code(401);
        return { error: "Invalid or inactive widget API key" };
      }

      // Origin validation
      const origin = request.headers.origin ?? request.headers.referer;
      if (widget.allowedOrigins.length > 0 && origin) {
        const allowed = widget.allowedOrigins.some((o) => origin.startsWith(o));
        if (!allowed) {
          reply.code(403);
          return { error: "Origin not allowed for this widget" };
        }
      }

      // Set CORS headers for widget origin
      if (origin) {
        reply.header("Access-Control-Allow-Origin", origin);
        reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
        reply.header("Access-Control-Allow-Headers", "Content-Type");
      }

      // Delegate to the council ask flow using the widget owner's context
      // In production this would call into the council service; here we return
      // a structured response that the widget iframe can render.
      return {
        widgetId: widget.id,
        userId: widget.userId,
        message: body.message.trim(),
        response: `[Council response placeholder — route to council.service for userId=${widget.userId}]`,
        timestamp: new Date().toISOString(),
      };
    },
  );
};

export { surfaceAccessPlugin };
export default surfaceAccessPlugin;

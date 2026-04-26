/**
 * api.deliberate — resource route (SPA mode)
 *
 * In Cloudflare Workers mode this route ran inference on the edge via env.AI.
 * In Node.js/SPA mode the fetch("/api/deliberate", ...) calls from the app
 * are handled directly by the Fastify backend (src/routes/deliberate-proxy.ts).
 * This file is kept as a placeholder so the route entry in routes.ts is valid.
 */
import type { Route } from "./+types/api.deliberate";

export async function clientLoader(_: Route.ClientLoaderArgs) {
  return { status: "ok" };
}

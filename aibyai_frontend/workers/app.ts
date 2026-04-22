import { createRequestHandler } from "react-router";

export { ExampleDO } from "./example-do";
export { LocalDataProxyService } from "./data-proxy";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Proxy /api/* requests to the configured backend URL
    if (url.pathname.startsWith("/api/")) {
      const backendUrl = (env as any).BACKEND_URL as string | undefined;

      if (!backendUrl) {
        return new Response(
          JSON.stringify({
            error: "Backend not configured",
            message:
              "Set the BACKEND_URL environment variable to your aibyai backend URL (e.g. https://api.yourdomain.com)",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }

      const targetUrl = new URL(url.pathname + url.search, backendUrl);
      const proxyRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body:
          request.method !== "GET" && request.method !== "HEAD"
            ? request.body
            : undefined,
      });

      try {
        const response = await fetch(proxyRequest);
        const newResponse = new Response(response.body, response);
        newResponse.headers.set("Access-Control-Allow-Origin", url.origin);
        newResponse.headers.set(
          "Access-Control-Allow-Credentials",
          "true"
        );
        return newResponse;
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Upstream error", message: String(err) }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": url.origin,
          "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type,Authorization,X-Requested-With",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;

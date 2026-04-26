import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { resolve } from "path";

const isCloudflare = process.env.BUILD_TARGET === "cloudflare";

export default defineConfig(async ({ command }) => {
  const plugins = isCloudflare
    ? [
        (await import("@cloudflare/vite-plugin")).cloudflare({ viteEnvironment: { name: "ssr" } }),
        tailwindcss(),
        reactRouter(),
      ]
    : [tailwindcss(), reactRouter()];

  return {
    plugins,
    resolve: {
      alias: {
        "~": resolve(__dirname, "./app"),
      },
    },
    // Only configure Cloudflare SSR environment when targeting Cloudflare Workers
    ...(isCloudflare && {
      environments: {
        ssr: {
          build: {
            rollupOptions: {
              input: "virtual:cloudflare/worker-entry",
            },
          },
        },
      },
    }),
    // Polyfill __filename for @cloudflare/codemode (uses zod-to-ts → TypeScript compiler)
    define: {
      __filename: "'index.ts'",
    },
    // Disable dep discovery during builds to avoid WebSocket error in @cloudflare/vite-plugin
    optimizeDeps: command === "build" ? { noDiscovery: true } : {},
  };
});

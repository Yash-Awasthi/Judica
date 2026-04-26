import type { Config } from "@react-router/dev/config";

const isCloudflare = process.env.BUILD_TARGET === "cloudflare";

export default {
  // SSR requires Cloudflare Workers runtime; for Node.js (Render) deploy as SPA
  ssr: isCloudflare,
  future: isCloudflare
    ? { v8_viteEnvironmentApi: true }
    : {},
} satisfies Config;

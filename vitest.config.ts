import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "**/node_modules/**"],

    // Ensure test fallbacks work (e.g. token similarity instead of ML worker)
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      JWT_SECRET: "test-jwt-secret-that-is-at-least-32-characters-long-for-validation",
      MASTER_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },

    // Tell Vitest to handle ESM properly with NodeNext resolution
    pool: "forks",
    singleFork: true,

    // Give each test file a clean module registry
    isolate: true,

    // Print verbose output so you see exactly which assertion fails
    reporters: ["verbose"],

    // How long a single test can run before timeout
    testTimeout: 30_000,

    // Code coverage settings
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/types/**", "src/**/index.ts", "src/db/schema/**"],
      all: true,
      thresholds: {
        lines: 44,
        functions: 41,
        branches: 37,
        statements: 42,
      },
    },
  },
  resolve: {
    alias: {
      // If any test imports from "@/" style paths, resolve to src/
      "@": resolve(__dirname, "./src"),
    },
  },
});

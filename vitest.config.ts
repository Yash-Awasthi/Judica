import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",

    // Tell Vitest to handle ESM properly with NodeNext resolution
    pool: "forks",          // Required for NodeNext ESM interop
    poolOptions: {
      forks: {
        singleFork: true,   // Prevents module state leaking between test files
      },
    },

    // Give each test file a clean module registry
    isolate: true,

    // Print verbose output so you see exactly which assertion fails
    reporters: ["verbose"],

    // How long a single test can run before timeout
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      // If any test imports from "@/" style paths, resolve to src/
      "@": resolve(__dirname, "./src"),
    },
  },
});

/**
 * Chrome extension build script using esbuild.
 *
 * Compiles TypeScript entry points to dist/, copies static assets.
 * Usage:
 *   node build.js          — one-shot production build
 *   node build.js --watch  — watch mode for development
 */

import esbuild from "esbuild";
import { cpSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const watch = process.argv.includes("--watch");
const __dir  = new URL(".", import.meta.url).pathname;

// Ensure output directory exists
mkdirSync(resolve(__dir, "dist"), { recursive: true });
mkdirSync(resolve(__dir, "dist/icons"), { recursive: true });

// ── Copy static files ─────────────────────────────────────────────────────────

const staticFiles = [
  ["manifest.json", "dist/manifest.json"],
  ["styles.css",    "dist/styles.css"],
  ["popup.html",    "dist/popup.html"],
  ["sidepanel.html","dist/sidepanel.html"],
  ["options.html",  "dist/options.html"],
];

for (const [src, dst] of staticFiles) {
  const srcPath = resolve(__dir, src);
  if (existsSync(srcPath)) {
    cpSync(srcPath, resolve(__dir, dst));
  }
}

// ── TypeScript entry points ───────────────────────────────────────────────────

const entryPoints = {
  background: resolve(__dir, "background.ts"),
  content:    resolve(__dir, "content.ts"),
  popup:      resolve(__dir, "popup.tsx"),
  sidepanel:  resolve(__dir, "sidepanel.tsx"),
  options:    resolve(__dir, "options.tsx"),
};

const ctx = await esbuild.context({
  entryPoints,
  bundle:    true,
  outdir:    resolve(__dir, "dist"),
  format:    "esm",
  target:    "chrome120",
  sourcemap: watch ? "inline" : false,
  minify:    !watch,
  logLevel:  "info",
  // Chrome extension service workers must be a single file
  splitting: false,
});

if (watch) {
  await ctx.watch();
  console.log("Watching for changes… (Ctrl+C to stop)");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("\nBuild complete → dist/");
  console.log("Load dist/ as an unpacked extension in chrome://extensions");
}

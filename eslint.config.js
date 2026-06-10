// @ts-check
// ESLint 10 flat config — covers backend (src/) and frontend (frontend/app/)
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "frontend/node_modules/**",
      "frontend/.react-router/**",
      "frontend/build/**",
      "frontend/public/sw.js",
      "electron/dist/**",
      "desktop/src-tauri/**",
      "extensions/chrome/dist/**",
      "coverage/**",
    ],
  },

  // ── Base JS recommended (no-undef etc) ─────────────────────────────────────
  js.configs.recommended,

  // ── Backend — src/**/*.ts ───────────────────────────────────────────────────
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-floating-promises": "warn",
      "no-console": "warn",
      "eqeqeq": ["error", "always"],
      "no-var": "error",
      "prefer-const": "warn",
      "no-empty": "warn",
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },

  // ── Frontend — frontend/app/**/*.{ts,tsx} ───────────────────────────────────
  {
    files: ["frontend/app/**/*.{ts,tsx}", "frontend/app/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
        // no project: here — frontend has its own tsconfig & tsc handles type-checking
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
        React: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-console": "warn",
      "no-var": "error",
      "prefer-const": "warn",
      "no-empty": "warn",
      "eqeqeq": ["error", "always"],
    },
  },

  // ── Tests ───────────────────────────────────────────────────────────────────
  {
    files: ["tests/**/*.ts", "tests/**/*.spec.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },

  // ── Chrome extension JS ─────────────────────────────────────────────────────
  {
    files: ["extensions/chrome/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },
];

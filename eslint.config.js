// @ts-check
// P5-02: Verified ESLint 10.x flat config compatibility.
// ESLint 10 requires flat config (eslint.config.js) — no .eslintrc support.
// typescript-eslint v8 is compatible with ESLint 10.
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
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
      // TypeScript-specific
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-floating-promises": "warn",

      // General quality
      "no-console": "warn",
      "eqeqeq": ["error", "always"],
      "no-var": "error",
      "prefer-const": "warn",
      "no-empty": "warn",
      "no-useless-assignment": "warn",

      // Override recommended for TS files
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
];

import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";
import svelteConfig from "./svelte.config.js";
import mbf from "./eslint-rules/index.js";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: [".svelte"], svelteConfig } },
  },
  {
    files: ["src/**/*.svelte"],
    // Test harnesses render fixtures, not the interface.
    ignores: ["src/test/**"],
    plugins: { mbf },
    rules: {
      "mbf/no-literal-ui-text": "error",
      "mbf/no-break-all": "error",
      "mbf/no-native-title": "error",
      "mbf/no-raw-color": "error",
      "mbf/raw-path-display": "error",
      "mbf/tooltip-repeats-text": "error",
      "svelte/no-at-html-tags": "error",
    },
  },
  {
    files: ["src/**/*.{ts,svelte}"],
    rules: {
      // Tooltips and reports are built from data: never through innerHTML.
      "no-restricted-properties": ["error", { property: "innerHTML" }, { property: "outerHTML" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // "ok && run()" and "cond ? show() : hide()" are the house style for small actions.
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      // Flags every local Set/Map; state that must react is declared as such, helpers are not state.
      "svelte/prefer-svelte-reactivity": "off",
    },
  },
  {
    ignores: ["build/", "build-audit/", "build-e2e/", "src-tauri/", "coverage/", "src/lib/bindings/", "node_modules/", "static/"],
  },
);

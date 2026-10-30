/// <reference types="vitest/config" />
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { realpathSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;

// A git worktree may share the install of another checkout through a link; Vite serves files only
// from inside the project, so the folder the link points to is allowed as well.
const installedAt = (() => {
  try {
    return [realpathSync("node_modules")];
  } catch {
    return [];
  }
})();

// Tests that read the sources through import.meta.glob (the backend contract, unused texts, the import graph)
// must see files added since the last run; the module cache keys a file by its own text, not by what its
// globs match, so those modules are never taken from it.
/** @type {import("vite").Plugin} */
const globsUncached = {
  name: "globs-uncached",
  configureVitest: ({ defineCacheKeyGenerator }) => defineCacheKeyGenerator(({ sourceCode }) => (sourceCode.includes("import.meta.glob") ? false : undefined)),
};

// A single-page app without routing: plain Svelte and Vite, no framework runtime in the bundle.
export default defineConfig(({ mode }) => ({
  // svelteTesting only acts under vitest: browser build of Svelte and DOM cleanup after each test.
  plugins: [tailwindcss(), svelte(), svelteTesting(), globsUncached],
  resolve: {
    alias: { $lib: new URL("./src/lib", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") },
  },
  publicDir: "static",
  // The audit build runs the app on a simulated backend for the headless UI audit; it has its own
  // entry and folder, so nothing of it can reach the release bundle. The e2e build is the app with its
  // test hooks, embedded into a debug build of the backend by scripts/e2e.mjs; it has a folder of its own too.
  build: {
    outDir: mode === "audit" ? "build-audit" : mode === "e2e" ? "build-e2e" : "build",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      ...(mode === "audit" ? { input: "audit.html" } : {}),
      // Everything the start page loads anyway goes into one chunk: the stores are many small modules, and as
      // separate chunks shared with the lazy views each one cost its import and export lists on top.
      output: { codeSplitting: { groups: [{ name: "start", tags: ["$initial"] }] } },
    },
  },
  // The diff colours load late; found only then, Vite would bundle them and reload the running page.
  // Keep in step with the languages in src/lib/git/diffHighlight.ts.
  optimizeDeps: {
    include: [
      "highlight.js/lib/core",
      ...["typescript", "javascript", "xml", "rust", "csharp", "json", "css", "markdown", "sql", "powershell", "yaml", "ini", "bash"].map(
        (l) => `highlight.js/lib/languages/${l}`,
      ),
    ],
  },
  // Tauri: keep Rust errors visible, fixed port, do not watch the backend.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...installedAt] },
    watch: { ignored: ["**/src-tauri/**", "**/build-audit/**", "**/build-e2e/**"] },
  },
  test: {
    include: ["src/**/*.test.ts", "eslint-rules/**/*.test.ts"],
    // Stylesheets are stubbed empty in tests; the check for unused classes reads the real app.css.
    css: { include: [/app\.css/] },
    setupFiles: ["src/test/setup.ts"],
    // A view test renders the real app in jsdom: on a busy machine (two runs at once) its work alone took
    // longer than the default 5 s. Waits fail on their own, shorter limit (src/test/wait.ts).
    testTimeout: 20_000,
    // Most of a cold run is transforming the same modules again; the cache keeps them between runs.
    fsModuleCache: true,
    coverage: {
      provider: /** @type {const} */ ("v8"),
      include: ["src/lib/**/*.ts", "src/lib/**/*.svelte"],
      // Generated types and plain text tables carry no logic.
      exclude: ["src/lib/bindings/**", "src/lib/**/*.test.ts", "src/lib/i18n/de.ts", "src/lib/i18n/en.ts", "src/lib/help/de.ts", "src/lib/help/en.ts"],
      reporter: ["text-summary", "text", "html"],
      reportsDirectory: "coverage",
    },
  },
}));

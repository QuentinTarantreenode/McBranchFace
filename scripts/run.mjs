// Starting programs for verify.mjs and release.mjs: never through a shell, every exit status checked.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const TAURI = join(ROOT, "src-tauri");

/** A step that failed; its message is the reason. */
export class Fail extends Error {}

// A git hook runs with GIT_DIR and friends pointing at this repository: the Rust tests' own git calls
// would then act on it instead of on their temporary repositories.
export const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));

/**
 * Runs a program, its output straight to the console; a non-zero exit throws Fail.
 * @param {string} program
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 */
export function exec(program, args, { cwd = ROOT, env = {} } = {}) {
  const line = [program, ...args].map(show).join(" ");
  console.log(`\n> ${line}${cwd === ROOT ? "" : `   (in ${relative(ROOT, cwd)})`}`);
  const r = spawnSync(program, args, { cwd, stdio: "inherit", env: { ...childEnv, ...env } });
  if (r.error) throw new Fail(`${line}: ${r.error.message}`);
  if (r.status !== 0) throw new Fail(`${line} exited with ${r.status ?? r.signal}`);
}

/** @param {string} arg */
const show = (arg) => (arg === process.execPath ? "node" : arg.startsWith(ROOT) ? relative(ROOT, arg) : arg);

/**
 * Runs a program and returns its trimmed standard output; a non-zero exit throws Fail.
 * @param {string} program
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 */
export function output(program, args, { cwd = ROOT } = {}) {
  const r = spawnSync(program, args, { cwd, encoding: "utf8", env: childEnv });
  if (r.error) throw new Fail(`${program}: ${r.error.message}`);
  if (r.status !== 0) throw new Fail(`${program} ${args.join(" ")} exited with ${r.status}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/**
 * A package's command-line entry, started with this node: no .cmd shim, no shell.
 * @param {string} pkg
 * @param {string} [bin]
 * @returns {(...args: string[]) => void}
 */
export function tool(pkg, bin = pkg) {
  // Read from the folder directly: not every package exports its package.json to require.resolve.
  const manifest = join(ROOT, "node_modules", pkg, "package.json");
  if (!existsSync(manifest)) throw new Fail(`${pkg} is not installed: run npm install`);
  const json = JSON.parse(readFileSync(manifest, "utf8"));
  const entry = typeof json.bin === "string" ? json.bin : json.bin[bin];
  return (...args) => exec(process.execPath, [join(dirname(manifest), entry), ...args]);
}

/** npm's own script (for `npm audit`), or undefined. */
export function npmCli() {
  const near = dirname(process.execPath);
  const candidates = [process.env.npm_execpath, join(near, "node_modules", "npm", "bin", "npm-cli.js"), join(near, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")];
  return candidates.find((c) => c && c.endsWith(".js") && existsSync(c));
}

/**
 * cargo in src-tauri, where its config (.cargo/config.toml) applies.
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
export const cargo = (args, env) => exec("cargo", args, { cwd: TAURI, env });

// One version for the whole app. package.json holds it, tauri.conf.json points to it, and Cargo.toml and
// both lock files carry copies that scripts/release.mjs writes. Pure functions over file texts: the
// release script, verify.mjs and a vitest test share them.

/** The files that carry the version, relative to the repository root. */
export const VERSION_FILES = ["package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];

/** What tauri.conf.json says instead of a number: Tauri reads the version from package.json. */
export const TAURI_VERSION_REF = "../package.json";

const VERSION_LINE = /^(version\s*=\s*")([^"]+)(")/m;

/**
 * Where the version line of the app's own entry is: the [package] table of Cargo.toml, or the
 * `name = "mcbranchface"` package of Cargo.lock.
 * @param {string} file
 * @param {string} text
 */
function cargoBlock(file, text) {
  const head = file.endsWith(".lock") ? /^name = "mcbranchface"\r?$/m : /^\[package\]\r?$/m;
  const start = text.search(head);
  if (start < 0) return null;
  const next = text.slice(start + 1).search(/^\[/m);
  return { start, end: next < 0 ? text.length : start + 1 + next };
}

/**
 * @param {string} file
 * @param {string} text
 */
function cargoVersion(file, text) {
  const block = cargoBlock(file, text);
  return block ? VERSION_LINE.exec(text.slice(block.start, block.end))?.[2] : undefined;
}

/**
 * Every place that disagrees with package.json, as readable lines; empty when all agree.
 * @param {Record<string, string>} text file contents by the names in VERSION_FILES
 * @returns {string[]}
 */
export function versionMismatches(text) {
  const version = JSON.parse(text["package.json"]).version;
  /** @type {string[]} */
  const problems = [];
  const expect = (/** @type {string} */ where, /** @type {unknown} */ found) => {
    if (found !== version) problems.push(`${where}: ${found ?? "no version"} (package.json: ${version})`);
  };
  const lock = JSON.parse(text["package-lock.json"]);
  expect("package-lock.json", lock.version);
  expect('package-lock.json packages[""]', lock.packages?.[""]?.version);
  const tauri = JSON.parse(text["src-tauri/tauri.conf.json"]).version;
  if (tauri !== TAURI_VERSION_REF) problems.push(`src-tauri/tauri.conf.json: "version" must be "${TAURI_VERSION_REF}", is ${JSON.stringify(tauri)}`);
  for (const file of ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) expect(file, cargoVersion(file, text[file]));
  return problems;
}

/**
 * The files whose text changes when the version is set, formatting kept.
 * @param {Record<string, string>} text file contents by the names in VERSION_FILES
 * @param {string} version
 * @returns {Record<string, string>}
 */
export function withVersion(text, version) {
  /** @type {Record<string, string>} */
  const out = {};
  const pkg = JSON.parse(text["package.json"]);
  pkg.version = version;
  out["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
  const lock = JSON.parse(text["package-lock.json"]);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  out["package-lock.json"] = JSON.stringify(lock, null, 2) + "\n";
  for (const file of ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
    const t = text[file];
    const block = cargoBlock(file, t);
    if (!block || !VERSION_LINE.test(t.slice(block.start, block.end))) throw new Error(`${file}: version line not found`);
    out[file] = t.slice(0, block.start) + t.slice(block.start, block.end).replace(VERSION_LINE, `$1${version}$3`) + t.slice(block.end);
  }
  for (const file of Object.keys(out)) if (out[file] === text[file]) delete out[file];
  return out;
}

// A release from a clean tree, every step checked: version in every file, the golden compat fixtures of
// this version, a CHANGELOG section, all gates, the installers with size budgets and checksums, then one
// commit and an annotated tag.
//   node scripts/release.mjs <version> [--summary "<one line>"] [--dry-run]
// --dry-run does all of it except the installer build, the commit and the tag, and puts the tree back.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cargo, childEnv, exec, Fail, output, ROOT, TAURI, tool } from "./run.mjs";
import { VERSION_FILES, withVersion } from "./versions.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const summaryArg = args.includes("--summary") ? args[args.indexOf("--summary") + 1] : undefined;
const version = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--summary");

const COMPAT = join(TAURI, "tests", "fixtures", "compat");
const BUNDLE = join(TAURI, "target", "release", "bundle");
const INSTALLER = /\.(exe|msi|dmg|AppImage|deb|rpm)$/;

/** Files this run wrote; a dry run puts them back, a failed real run names them. */
const written = { changed: new Set(), created: new Set() };

function write(rel, text) {
  const tracked = output("git", ["ls-files", "--", rel]) !== "";
  (tracked ? written.changed : written.created).add(rel);
  writeFileSync(join(ROOT, rel), text);
}

function step(title) {
  console.log(`\n=== ${title}`);
}

/** Subjects of the commits since the last release: since the nearest tag, else the newest release commit. */
function changesSinceLastRelease() {
  // No tag at all is no error here: describe fails, and the release commits stand in.
  const described = spawnSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], { cwd: ROOT, encoding: "utf8", env: childEnv });
  const tag = described.status === 0 ? described.stdout.trim() : "";
  // Only "Release <version>" is a release commit; other subjects may start with the word too.
  const since = tag || output("git", ["log", "-1", "--format=%H", "-E", "--grep", "^Release [0-9]+\\.[0-9]+\\.[0-9]+"]);
  const range = since ? `${since}..HEAD` : "HEAD";
  const subjects = output("git", ["log", "--no-merges", "--format=%s", range]).split("\n").filter((s) => s && !/^Release \d+\.\d+\.\d+/.test(s));
  return { since: tag || (since ? `the release commit ${since.slice(0, 7)}` : "the first commit"), subjects };
}

/** Without --summary: the subjects as one line, as many as fit a commit subject; the body lists all. */
function summaryOf(subjects) {
  let line = "";
  for (const s of subjects) {
    // A capital that only starts the sentence goes; a name in capitals (README, CI) stays.
    const part = /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
    if (line && line.length + part.length > 150) return `${line}; and more`;
    line = line ? `${line}; ${part}` : part;
  }
  return line;
}

/** The new section goes above the newest one; the head of the file stays. */
function prependChangelog(section) {
  const rel = "CHANGELOG.md";
  const text = existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "# Changelog\n";
  const at = text.search(/^## /m);
  write(rel, at < 0 ? `${text.trimEnd()}\n\n${section}` : `${text.slice(0, at)}${section}\n${text.slice(at)}`);
}

/** `<hash>  <name>` beside every installer of this version, the format sha256sum reads back. */
function writeChecksums() {
  if (!existsSync(BUNDLE)) throw new Fail(`no bundle folder: ${BUNDLE}`);
  const found = readdirSync(BUNDLE, { recursive: true })
    .map(String)
    .filter((f) => INSTALLER.test(f) && f.includes(version));
  if (!found.length) throw new Fail(`no installer of ${version} in ${BUNDLE}`);
  for (const f of found) {
    const path = join(BUNDLE, f);
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    const name = f.split(/[\\/]/).pop();
    writeFileSync(`${path}.sha256`, `${hash}  ${name}\n`);
    console.log(`${hash}  ${f}`);
  }
}

function putBack() {
  const changed = [...written.changed];
  if (changed.length) exec("git", ["checkout", "--", ...changed]);
  for (const rel of written.created) rmSync(join(ROOT, rel), { force: true });
}

function main() {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Fail("usage: node scripts/release.mjs <major.minor.patch> [--summary <text>] [--dry-run]");
  const dirty = output("git", ["status", "--porcelain"]);
  if (dirty) throw new Fail(`the work tree is not clean; commit or stash first:\n${dirty}`);
  const tag = `v${version}`;
  if (output("git", ["tag", "--list", tag])) throw new Fail(`tag ${tag} exists already`);
  const current = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  if (current === version) throw new Fail(`${version} is the current version already`);
  const { since, subjects } = changesSinceLastRelease();
  if (!subjects.length) throw new Fail(`no commits since ${since}`);

  step(`version ${current} -> ${version}`);
  const text = Object.fromEntries(VERSION_FILES.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));
  for (const [file, content] of Object.entries(withVersion(text, version))) write(file, content);

  step("compat fixtures of this version");
  // The shapes this version writes become golden files every later version must still read.
  const before = new Set(readdirSync(COMPAT));
  cargo(["test", "--test", "compat", "--", "--ignored", "--exact", "write_current_shapes"], { MBF_COMPAT_VERSION: version });
  for (const f of readdirSync(COMPAT).filter((f) => f.includes(version))) (before.has(f) ? written.changed : written.created).add(`src-tauri/tests/fixtures/compat/${f}`);

  step(`CHANGELOG: ${subjects.length} commits since ${since}`);
  const date = new Date().toISOString().slice(0, 10);
  const section = `## ${version} · ${date}\n\n${subjects.map((s) => `- ${s}`).join("\n")}\n`;
  prependChangelog(section);
  console.log(section);

  step("all gates");
  exec(process.execPath, [join(ROOT, "scripts", "verify.mjs")]);

  const message = [`Release ${version}: ${summaryArg ?? summaryOf(subjects)}`, subjects.map((s) => `- ${s}`).join("\n")];
  if (dryRun) {
    step("dry run: no installer build, no commit, no tag");
    console.log(`would commit ${[...written.changed, ...written.created].join(", ")}\n\n${message.join("\n\n")}\n\nand tag ${tag}`);
    return;
  }

  step("installers");
  tool("@tauri-apps/cli", "tauri")("build");
  exec(process.execPath, [join(ROOT, "scripts", "budgets.mjs"), "--release"]);
  writeChecksums();

  step(`commit and tag ${tag}`);
  exec("git", ["add", "--", ...written.changed, ...written.created]);
  exec("git", ["commit", "-m", message[0], "-m", message[1]]);
  exec("git", ["tag", "-a", tag, "-m", `Release ${version}`]);
  console.log(`\nreleased ${version}: installers and .sha256 files in ${BUNDLE}`);
}

try {
  main();
  if (dryRun) putBack();
} catch (e) {
  console.error(`\nrelease ${version ?? ""} FAILED: ${e instanceof Error ? e.message : e}`);
  if (dryRun) putBack();
  else if (written.changed.size || written.created.size) console.error(`the tree keeps the release edits: ${[...written.changed, ...written.created].join(", ")}`);
  process.exit(1);
}

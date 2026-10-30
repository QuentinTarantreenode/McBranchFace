// What the scenarios share: the store facade's name in page code and how to point at a branch's table row.

/** The store facade, in page code. */
export const S = "window.__mbfStore";

/**
 * The table row of a branch, for a click: the one in the repo whose path contains `repo`, or the only one. Rows
 * are keyed `<repo path>::<branch>`; the same branch in two working copies is two rows.
 */
export async function rowOf(t, name, repo) {
  const key = await t.js(
    `const b = ${S}.allBranches.find((b) => b.name === ${JSON.stringify(name)}${repo ? ` && b.repoPath.includes(${JSON.stringify(repo)})` : ""}); return b ? b.repoPath + "::" + b.name : null;`,
  );
  if (!key) throw new Error(`no branch ${name}${repo ? ` in ${repo}` : ""}`);
  return { css: `[role=option][data-key=${JSON.stringify(key)}]` };
}

/** The path of the first repo whose path contains `part`, as the app names it. */
export function repoPath(t, part) {
  return t.js(`return ${S}.repos.find((r) => r.info.path.includes(${JSON.stringify(part)})).info.path`);
}

/** The cleanup table of local branches, no grouping, every repo. */
export function cleanup(t) {
  return t.act(`${S}.setUi({ perspective: "Cleanup", tableGroup: "None" }); ${S}.setScope("Local"); ${S}.filters.repos = []; return true;`);
}

/**
 * Opens a row's context menu with a real right click, then the submenu of `parent` by hovering it. A menu entry's
 * name carries its description: the parent is matched by how the name starts.
 */
export async function rowMenu(t, row, parent) {
  await t.rightClick(row);
  if (!parent) return;
  await t.hover(["menuitem", new RegExp(`^${parent}\\b`)]);
  await t.when("submenu", `document.querySelectorAll("[role=menu]").length === 2`, { ms: 5000 });
}

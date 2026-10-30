// What an external program call means to the user: where it asks (the local git, the server behind
// origin, Azure DevOps, GitHub) and what for. Pure, unit-tested; the texts come in from the dictionary.

export interface OpTexts {
  local: string;
  server: string;
  azure: string;
  github: string;
  fetch: (remote: string) => string;
  pull: (remote: string) => string;
  push: (remote: string) => string;
  heads: (remote: string) => string;
  status: string;
  refs: string;
  commits: string;
  worktrees: string;
  stashes: string;
  config: string;
  resolve: string;
  prs: string;
  branches: string;
  user: string;
  other: (what: string) => string;
}

export interface Described {
  /** "Azure DevOps · Pull requests" */
  text: string;
  /** The working copy it runs in, where known. */
  where: string | null;
  /** A repo named in the arguments (provider calls run without a folder). */
  repo: string | null;
}

const base = (program: string) => program.replace(/\\/g, "/").split("/").pop()!.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();

/** The value after an option: `--repository X`, `-R owner/name`. */
const after = (args: string[], ...names: string[]) => {
  const i = args.findIndex((a) => names.includes(a));
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

export function describeProcess(program: string, args: string[], cwd: string | null, provider: (path: string | null) => "Azure" | "GitHub" | null, t: OpTexts): Described {
  const name = base(program);
  if (name === "git") {
    // Global options first: `-C <dir>` names the folder, `-c key=value` the config.
    let where = cwd;
    let i = 0;
    while (i < args.length && args[i].startsWith("-")) {
      if (args[i] === "-C") where = args[i + 1] ?? where;
      i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
    }
    const sub = args[i] ?? "";
    const rest = args.slice(i + 1).filter((a) => !a.startsWith("-"));
    const remote = rest[0] ?? "origin";
    const host = provider(where);
    const server = host === "Azure" ? t.azure : host === "GitHub" ? t.github : t.server;
    const net: Record<string, (r: string) => string> = { fetch: t.fetch, pull: t.pull, push: t.push, "ls-remote": t.heads };
    if (net[sub]) return { text: `${server} · ${net[sub](remote)}`, where, repo: null };
    const local: Record<string, string> = {
      status: t.status,
      "for-each-ref": t.refs,
      branch: t.refs,
      "rev-list": t.commits,
      "merge-base": t.commits,
      cherry: t.commits,
      log: t.commits,
      worktree: t.worktrees,
      stash: t.stashes,
      config: t.config,
      remote: t.config,
      "rev-parse": t.resolve,
    };
    return { text: `${t.local} · ${local[sub] ?? t.other(`git ${sub}`)}`, where, repo: null };
  }
  if (name === "az") {
    const words = args.filter((a) => !a.startsWith("-")).slice(0, 3).join(" ");
    const op = words.startsWith("repos pr") ? t.prs : words.startsWith("repos ref") ? t.branches : words.startsWith("account") ? t.user : t.other(`az ${words}`);
    return { text: `${t.azure} · ${op}`, where: cwd, repo: after(args, "--repository") };
  }
  if (name === "gh") {
    const words = args.filter((a) => !a.startsWith("-"));
    const api = words[0] === "api" ? (words[1] ?? "") : "";
    const op = words[0] === "pr" ? t.prs : /branches|git\/refs/.test(api) ? t.branches : api === "user" ? t.user : t.other(`gh ${words.slice(0, 2).join(" ")}`);
    const full = after(args, "-R", "--repo") ?? (api.match(/^repos\/([^/]+\/[^/]+)/)?.[1] ?? null);
    return { text: `${t.github} · ${op}`, where: cwd, repo: full ? full.split("/").pop()! : null };
  }
  return { text: t.other(name), where: cwd, repo: null };
}

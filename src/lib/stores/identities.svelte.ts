// Identities of folders, repos and repo groups: the sign and colour each is known by, the user's own
// choices first. Read wherever an object is named; written from the identity dialog.
import { repoName } from "$lib/filter";
import { PROBED } from "$lib/probe";
import { rootBadges, type RootBadge } from "$lib/rootBadges";
import { gitStatus } from "./gitStatus.svelte";
import { settings } from "./settings.svelte";
import { scanResults } from "./scanResults.svelte";
import { repoSelection } from "./repoSelection.svelte";

/** The object the identity dialog is open for. `auto`: the sign and colour without a choice. */
export interface IdentityTarget {
  kind: "folder" | "repo" | "group";
  key: string;
  name: string;
  auto: { text: string; color: string };
}

class Identities {
  /** The short sign of every root folder; a repo carries the one of the root it was found under. */
  rootBadges = $derived(rootBadges(settings.config?.roots ?? [], (r) => settings.config?.identities[`folder:${r}`]));
  rootBadgeOf = (path: string) => {
    const root = scanResults.repoByPath.get(path)?.root;
    const badge = root ? this.rootBadges.get(root) : undefined;
    return root && badge ? { root, badge } : null;
  };

  /** What the user gave a repository (all its working copies share it). */
  repoIdentity = (path: string) => {
    const id = scanResults.identityOf(path);
    return id ? settings.config?.identities[`repo:${id}`] : undefined;
  };

  /**
   * The sign a repo is known by wherever it is named: its own where it has one, else its folder's.
   * `own`: the repo's own sign, the folder then only in the tooltip.
   */
  markOf = (path: string): { root: string; badge: RootBadge; own: boolean } | null => {
    const folder = this.rootBadgeOf(path);
    const own = this.repoIdentity(path);
    if (!own?.short) return folder ? { ...folder, own: false } : null;
    const color = own.color ? `var(--${own.color})` : (folder?.badge.color ?? "var(--accent)");
    return { root: folder?.root ?? "", badge: { text: own.short, color, name: repoName(path) }, own: true };
  };

  /** The group the selection is: its badge stands for the repos in filters and headers. */
  activeRepoGroup = $derived.by(() => {
    const have = repoSelection.repos;
    if (!have.length) return null;
    return (
      (settings.config?.repoGroups ?? []).find((g) => {
        const want = [...new Set(g.paths.map((p) => gitStatus.ownerOf(p)).filter((p) => scanResults.repoByPath.has(p)))];
        return want.length === have.length && want.every((p) => have.includes(p));
      }) ?? null
    );
  });

  /** The folder the selection is, as for a group: one pill for its repos instead of one per repo. */
  activeFolder = $derived.by(() => {
    const have = new Set(repoSelection.repos);
    if (!have.size || this.activeRepoGroup) return null;
    for (const root of settings.config?.roots ?? []) {
      const want = scanResults.repos.filter((r) => r.info.root === root).map((r) => r.info.path);
      if (want.length && want.length === have.size && want.every((p) => have.has(p))) return root;
    }
    return null;
  });

  /** The identity dialog: which object, and what the app would show without a choice. */
  identityTarget = $state<IdentityTarget | null>(null);

  resetForTests() {
    this.identityTarget = null;
  }

  openIdentity(kind: IdentityTarget["kind"], ref: string, name: string) {
    const auto =
      kind === "folder"
        ? rootBadges(settings.config?.roots ?? []).get(ref)
        : kind === "repo"
          ? this.rootBadgeOf(ref)?.badge
          : { text: name.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase(), color: "var(--accent)", name };
    const key = kind === "repo" ? `repo:${scanResults.identityOf(ref) ?? ref}` : `${kind}:${ref}`;
    this.identityTarget = { kind, key, name, auto: { text: auto?.text ?? "", color: auto?.color ?? "var(--accent)" } };
  }

  async setIdentity(key: string, value: { short: string | null; color: string | null } | null) {
    if (!settings.config) return;
    const identities = { ...settings.config.identities };
    if (!value || (!value.short && !value.color)) delete identities[key];
    else identities[key] = value;
    await settings.saveConfig({ ...settings.config, identities }, true);
  }

  /** The colour chosen for a repository (all its working copies), else the one of its copy group. */
  repoColor = (path: string): { color: string; chosen: boolean } | null => {
    const chosen = this.repoIdentity(path)?.color;
    if (chosen) return { color: `var(--${chosen})`, chosen: true };
    const group = scanResults.groupOf(path);
    return group ? { color: group.color, chosen: false } : null;
  };

  /** The colour the repo a path belongs to is known by: its own, else its folder's (chosen or assigned).
   * The left edge of its card, its rows and its heads carries it everywhere. */
  tintOf = (path: string): string | null => {
    const owner = gitStatus.ownerOf(path);
    const own = this.repoColor(owner);
    if (own?.chosen) return own.color;
    return this.markOf(owner)?.badge.color ?? null;
  };

  /** A repo group's own colour, where one was chosen. */
  groupColor = (id: string): string | null => {
    const c = settings.config?.identities[`group:${id}`]?.color;
    return c ? `var(--${c})` : null;
  };

  async setRepoColor(path: string, color: string | null) {
    const id = scanResults.identityOf(path);
    if (!id) return;
    await this.setIdentity(`repo:${id}`, { short: this.repoIdentity(path)?.short ?? null, color });
  }
}

export const identities = new Identities();
if (PROBED) (globalThis as Record<string, unknown>).__mbfIdentities = identities;

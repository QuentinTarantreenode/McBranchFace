import type { RepoLinks } from "$lib/bindings/RepoLinks";

/**
 * The provider's page of a branch. Every character that has a meaning in a URL is escaped ("#", "?",
 * "&", "%"), only "/" stays: GitHub reads it as part of the path, Azure accepts it either way.
 */
export function branchUrl(links: RepoLinks, branch: string): string {
  return links.branch.replace("{branch}", encodeURIComponent(branch).replace(/%2F/gi, "/"));
}

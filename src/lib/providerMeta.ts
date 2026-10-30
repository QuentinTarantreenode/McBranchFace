// What the app knows about each code host, in one place: which CLI asks it for pull requests and for
// who the user is there. A new host is one more entry; the compiler names every place that needs it.
import type { ProviderKind } from "./bindings/ProviderKind";
import type { ToolId } from "./bindings/ToolId";

export type Host = Exclude<ProviderKind, "None">;

export const PROVIDERS = {
  Azure: { tool: "AzureCli" },
  GitHub: { tool: "GitHubCli" },
} as const satisfies Record<Host, { tool: ToolId }>;

/** The host of a repo, or null where it has none the app can ask. */
export const hostOf = (kind: ProviderKind | null | undefined): Host | null => (kind && kind in PROVIDERS ? (kind as Host) : null);

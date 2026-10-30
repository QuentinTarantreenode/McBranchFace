/** A key of the identity table, one spelling for every place that reads an identity directly. */
export const identityKey = (kind: "folder" | "repo" | "group", ref: string) => `${kind}:${ref}`;

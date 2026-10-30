// The built-in prompts as the settings store them and as the UI names them: one mapping, small
// enough for any page to import without the prompt texts.
import type { BuiltinPrompt } from "./bindings/BuiltinPrompt";

export type PromptKind = "merge" | "pr" | "cleanup" | "rebase";

export const KIND_OF: Record<BuiltinPrompt, PromptKind> = { Merge: "merge", Pr: "pr", Cleanup: "cleanup", Rebase: "rebase" };
export const BUILTIN_OF: Record<PromptKind, BuiltinPrompt> = { merge: "Merge", pr: "Pr", cleanup: "Cleanup", rebase: "Rebase" };

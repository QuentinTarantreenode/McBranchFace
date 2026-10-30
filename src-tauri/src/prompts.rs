//! Prompt templates: Markdown with `{{variables}}` that the UI fills from a branch and copies for an
//! AI assistant. The backend only keeps them valid; rendering happens in the UI, since a prompt is
//! copied, never run.

use serde::{Deserialize, Serialize};
#[cfg(test)]
use ts_rs::TS;

const NAME_LIMIT: usize = 60;
const BODY_LIMIT: usize = 20_000;

/// The prompts the app ships; a template with one of these replaces the built-in text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum BuiltinPrompt {
    Merge,
    Pr,
    Cleanup,
    Rebase,
}

/// Which rows a template is offered on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum PromptScope {
    Local,
    Online,
    #[default]
    Both,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct PromptTemplate {
    pub id: String,
    pub name: String,
    pub body: String,
    pub scope: PromptScope,
    /// Offered only for branches with commits of their own (merge, rebase and the like).
    pub needs_own_commits: bool,
    /// An edited built-in prompt; its name and scope come from the built-in one.
    pub builtin: Option<BuiltinPrompt>,
}

impl Default for PromptTemplate {
    fn default() -> Self {
        Self { id: String::new(), name: String::new(), body: String::new(), scope: PromptScope::Both, needs_own_commits: false, builtin: None }
    }
}

/// Normalises templates on load and save: names and bodies within limits, no empty entries (an
/// edited built-in with an empty body means the default again), one entry per built-in, unique ids.
pub fn sanitize(prompts: &mut Vec<PromptTemplate>) -> bool {
    let before = prompts.clone();
    let mut builtins = std::collections::HashSet::new();
    prompts.retain(|p| !p.body.trim().is_empty() && (p.builtin.is_some() || !p.name.trim().is_empty()) && p.builtin.is_none_or(|b| builtins.insert(b)));
    let mut seen = std::collections::HashSet::new();
    for (n, p) in prompts.iter_mut().enumerate() {
        p.name = p.name.trim().chars().take(NAME_LIMIT).collect();
        if p.body.chars().count() > BODY_LIMIT {
            p.body = p.body.chars().take(BODY_LIMIT).collect();
        }
        if p.id.trim().is_empty() || !seen.insert(p.id.clone()) {
            p.id = format!("prompt-{n}-{}", crate::git::snapshot::now());
            seen.insert(p.id.clone());
        }
    }
    *prompts != before
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(id: &str, name: &str, body: &str, builtin: Option<BuiltinPrompt>) -> PromptTemplate {
        PromptTemplate { id: id.into(), name: name.into(), body: body.into(), builtin, ..Default::default() }
    }

    #[test]
    fn keeps_valid_templates_and_drops_empty_and_doubled_ones() {
        let mut list = vec![
            p("a", "  Review  ", "Check {{branch}}", None),
            p("b", "", "no name", None),
            p("c", "Empty", "   ", None),
            p("d", "", "My merge", Some(BuiltinPrompt::Merge)),
            p("e", "", "Second merge", Some(BuiltinPrompt::Merge)),
            p("f", "", "", Some(BuiltinPrompt::Rebase)),
            p("a", "Same id", "x", None),
        ];
        assert!(sanitize(&mut list));
        let names: Vec<(&str, &str)> = list.iter().map(|x| (x.name.as_str(), x.body.as_str())).collect();
        assert_eq!(names, vec![("Review", "Check {{branch}}"), ("", "My merge"), ("Same id", "x")]);
        assert_ne!(list[0].id, list[2].id, "ids are unique");
        assert!(!sanitize(&mut list), "a clean list stays as it is");
    }

    #[test]
    fn cuts_long_names_and_bodies() {
        let mut list = vec![p("a", &"n".repeat(100), &"b".repeat(BODY_LIMIT + 10), None)];
        sanitize(&mut list);
        assert_eq!((list[0].name.chars().count(), list[0].body.chars().count()), (NAME_LIMIT, BODY_LIMIT));
    }
}

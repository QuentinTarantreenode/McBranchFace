use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
#[cfg(test)]
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum Theme {
    /// Follows the light or dark setting of the operating system, also when it changes.
    System,
    #[default]
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum Perspective {
    /// What there is to do, across all repos; where the app starts.
    #[default]
    Dashboard,
    Cleanup,
    Git,
}

/// UI language; `Auto` follows the system language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum Language {
    #[default]
    Auto,
    De,
    En,
}

/// Which branches the cleanup perspective lists: local gone branches or branches on the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum CleanupScope {
    #[default]
    Local,
    Online,
}

/// For the enums of the config: a value this version does not know (written by a newer one) reads as
/// the default, instead of making the whole file unreadable.
mod lenient {
    use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(value: &T, s: S) -> Result<S::Ok, S::Error> {
        value.serialize(s)
    }

    pub fn deserialize<'de, T: DeserializeOwned + Default, D: Deserializer<'de>>(d: D) -> Result<T, D::Error> {
        let value = serde_json::Value::deserialize(d)?;
        Ok(serde_json::from_value(value).unwrap_or_default())
    }
}

/// Layout state the user expects to find again on the next start.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct UiPrefs {
    #[serde(with = "lenient")]
    #[cfg_attr(test, ts(as = "Perspective"))]
    pub perspective: Perspective,
    pub sidebar_collapsed: bool,
    pub detail_collapsed: bool,
    pub sidebar_width: u32,
    pub detail_width: u32,
    pub always_on_top: bool,
    #[serde(with = "lenient")]
    #[cfg_attr(test, ts(as = "CleanupScope"))]
    pub cleanup_scope: CleanupScope,
    /// Root folders whose group is folded in the sidebar.
    pub collapsed_roots: Vec<String>,
    /// Grouping of the cleanup table.
    #[serde(with = "lenient")]
    #[cfg_attr(test, ts(as = "TableGroup"))]
    pub table_group: TableGroup,
    /// Folded groups of the table, by group key.
    pub collapsed_groups: Vec<String>,
    /// Order, width and visibility of the table columns, per scope.
    pub table_layout: TableLayout,
    /// Size the user gave a resizable dialog, by dialog id.
    pub dialog_sizes: BTreeMap<String, DialogSize>,
    /// Zoom of the whole interface in percent, one of `SCALES`.
    pub scale: u32,
    /// Diffs side by side instead of one column.
    pub diff_split: bool,
    /// The local list shows only branches whose upstream the server deleted.
    pub orphaned_only: bool,
    /// Repo groups folded in the sidebar, by group id.
    pub collapsed_repo_groups: Vec<String>,
    /// Share of the repo name in a repo group row, in percent; the branch takes the rest.
    pub group_split: u32,
    /// The changes of all repos in the Git perspective, one block per repo, instead of the open one's.
    pub git_changes_all: bool,
    /// Over all repos: their blocks under the folder they sit in.
    pub git_changes_by_folder: bool,
    /// Folded groups of the lists that have no field of their own, by list and group id.
    pub collapsed: BTreeMap<String, Vec<String>>,
    /// The changed files of a status group under the directories they sit in.
    pub git_changes_tree: bool,
    /// How the branch list of the Git perspective is grouped: "None", "Prefix", "Worktree", "Upstream", "Author".
    pub git_branch_group: String,
    /// Animations: "system" follows the operating system, "on" always, "off" never.
    pub motion: String,
    /// Says what the app does right now: in the top bar and on the element it works on.
    /// Says in the top bar what is asked right now and where. Off unless switched on: showing every call
    /// costs more than many of the calls themselves.
    pub activity_shown: bool,
    /// The pull requests the dashboard lists: "mine" (mine and those waiting for my review) or "all".
    pub dashboard_prs: String,
    /// Steps of the dashboard put aside, by key, with the state they were put aside in: a changed state
    /// brings them back.
    pub dashboard_dismissed: BTreeMap<String, String>,
    /// A changed file in a working copy reads its status again.
    pub watch_files: bool,
    /// A changed branch, HEAD or ref reassesses the repo.
    pub watch_refs: bool,
    /// Least seconds between two reassessments of one repo from the watcher; the last request wins.
    pub refs_gap_seconds: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub struct DialogSize {
    pub width: u32,
    pub height: u32,
}

/// The interface sizes on offer; larger steps would push the tables into their compact forms.
pub const SCALES: [u32; 3] = [100, 115, 130];
const DIALOG_WIDTH: (u32, u32) = (320, 4000);
const DIALOG_HEIGHT: (u32, u32) = (200, 3000);
const MAX_DIALOGS: usize = 16;

fn sanitize_dialogs(map: &mut BTreeMap<String, DialogSize>) -> bool {
    let before = map.clone();
    map.retain(|id, _| !id.is_empty() && id.len() <= 32);
    while map.len() > MAX_DIALOGS {
        let last = map.keys().next_back().cloned();
        last.map(|k| map.remove(&k));
    }
    for s in map.values_mut() {
        s.width = s.width.clamp(DIALOG_WIDTH.0, DIALOG_WIDTH.1);
        s.height = s.height.clamp(DIALOG_HEIGHT.0, DIALOG_HEIGHT.1);
    }
    *map != before
}

const MAX_FOLD_LISTS: usize = 16;
const MAX_FOLDED: usize = 500;

fn sanitize_collapsed(map: &mut BTreeMap<String, Vec<String>>) -> bool {
    let before = map.clone();
    map.retain(|id, list| !id.is_empty() && id.len() <= 32 && !list.is_empty());
    while map.len() > MAX_FOLD_LISTS {
        let last = map.keys().next_back().cloned();
        last.map(|k| map.remove(&k));
    }
    for list in map.values_mut() {
        list.sort();
        list.dedup();
        list.truncate(MAX_FOLDED);
    }
    *map != before
}

/// The nearest offered size, so a hand-edited value never yields an odd zoom.
fn nearest_scale(v: u32) -> u32 {
    *SCALES.iter().min_by_key(|s| s.abs_diff(v)).unwrap_or(&115)
}

/// The palette of identities: `id-0` … `id-11`, each defined for light and dark (app.css).
const IDENTITY_COLORS: u8 = 12;
const MAX_SHORT: usize = 4;
const MAX_IDENTITIES: usize = 512;

fn valid_color(c: &str) -> bool {
    c.strip_prefix("id-").and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| n < IDENTITY_COLORS)
}

/// The colour and short sign the user gave a folder, a repository or a repo group. Either may be left
/// out; the folder's computed sign and colour stand in. Keys: `folder:<path>`, `repo:<identity>`,
/// `group:<id>`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct ObjectIdentity {
    pub short: Option<String>,
    pub color: Option<String>,
}

/// Trims the sign to what a badge holds, drops colours outside the palette and entries left empty.
fn sanitize_identities(map: &mut BTreeMap<String, ObjectIdentity>) -> bool {
    let before = map.clone();
    for id in map.values_mut() {
        id.short = id.short.as_deref().map(|s| s.trim().chars().filter(|c| !c.is_whitespace()).take(MAX_SHORT).collect::<String>()).filter(|s| !s.is_empty());
        id.color = id.color.take().filter(|c| valid_color(c));
    }
    map.retain(|k, id| k.contains(':') && (id.short.is_some() || id.color.is_some()));
    while map.len() > MAX_IDENTITIES {
        let last = map.keys().next_back().cloned().unwrap_or_default();
        map.remove(&last);
    }
    *map != before
}

/// Column layout of the cleanup table. Column ids belong to the frontend; unknown ones are
/// dropped there, so an older or newer version never breaks the table.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct TableLayout {
    pub local: Vec<ColumnPref>,
    pub online: Vec<ColumnPref>,
    /// The branch list of the Git perspective.
    pub branches: Vec<ColumnPref>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ColumnPref {
    pub id: String,
    pub width: u32,
    pub visible: bool,
}

const COLUMN_WIDTH: (u32, u32) = (40, 4000);
const MAX_COLUMNS: usize = 16;

/// Unique, short ids and widths in range; true when something had to change.
fn sanitize_columns(list: &mut Vec<ColumnPref>) -> bool {
    let before = list.clone();
    let mut seen = std::collections::HashSet::new();
    list.retain(|c| !c.id.is_empty() && c.id.len() <= 24 && seen.insert(c.id.clone()));
    list.truncate(MAX_COLUMNS);
    for c in list.iter_mut() {
        c.width = c.width.clamp(COLUMN_WIDTH.0, COLUMN_WIDTH.1);
    }
    *list != before
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum TableGroup {
    #[default]
    None,
    Folder,
    Repo,
    Prefix,
    /// The same branch name across repositories, e.g. one feature worked on in several of them.
    Name,
    Verdict,
    Author,
}

/// Window behaviour and start with the operating system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct WindowPrefs {
    /// Closing the window keeps the app running in the tray (background scan, notifications).
    pub close_to_tray: bool,
    pub minimize_to_tray: bool,
    pub autostart: bool,
    /// With autostart: start in the tray instead of opening the window.
    pub start_hidden: bool,
}

impl Default for WindowPrefs {
    fn default() -> Self {
        Self { close_to_tray: true, minimize_to_tray: false, autostart: false, start_hidden: true }
    }
}

impl Default for UiPrefs {
    fn default() -> Self {
        Self {
            perspective: Perspective::default(),
            sidebar_collapsed: false,
            detail_collapsed: false,
            sidebar_width: 248,
            detail_width: 380,
            always_on_top: false,
            cleanup_scope: CleanupScope::Local,
            collapsed_roots: Vec::new(),
            table_group: TableGroup::None,
            collapsed_groups: Vec::new(),
            table_layout: TableLayout::default(),
            dialog_sizes: BTreeMap::new(),
            scale: 115,
            diff_split: false,
            orphaned_only: true,
            collapsed_repo_groups: Vec::new(),
            group_split: 50,
            git_changes_all: false,
            git_changes_by_folder: false,
            collapsed: BTreeMap::new(),
            git_changes_tree: false,
            git_branch_group: "None".into(),
            motion: "on".into(),
            activity_shown: false,
            dashboard_prs: "mine".into(),
            dashboard_dismissed: BTreeMap::new(),
            watch_files: true,
            watch_refs: true,
            refs_gap_seconds: 30,
        }
    }
}

/// Working copies the user put together to act on at once. By path, not identity: a switch or a push
/// works on one folder, and one repo may be in several groups.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct RepoGroup {
    pub id: String,
    pub name: String,
    pub paths: Vec<String>,
}

const MAX_GROUPS: usize = 64;
const MAX_GROUP_PATHS: usize = 256;
const MAX_GROUP_NAME: usize = 60;

/// One entry per group id and per folder in a group, however the path was spelled.
fn sanitize_groups(groups: &mut Vec<RepoGroup>) -> bool {
    let before = groups.clone();
    let mut ids = std::collections::HashSet::new();
    groups.retain(|g| !g.id.is_empty() && g.id.len() <= 64 && ids.insert(g.id.clone()));
    groups.truncate(MAX_GROUPS);
    for g in groups.iter_mut() {
        g.name = g.name.trim().chars().take(MAX_GROUP_NAME).collect();
        let mut seen = std::collections::HashSet::new();
        g.paths.retain(|p| !p.trim().is_empty() && seen.insert(crate::paths::path_key(p)));
        g.paths.truncate(MAX_GROUP_PATHS);
    }
    *groups != before
}

/// A branch (or, without `branch`, a whole repository) that must never be deleted.
/// Keyed by repository identity, so it holds for every working copy of that repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct Lock {
    pub identity: String,
    pub branch: Option<String>,
}

/// Where an ignore applies: the local gone branch, the branch on the server, or both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum IgnoreScope {
    Local,
    Online,
    /// Also what an unknown scope reads as: an ignore only silences alerts, it protects nothing.
    #[default]
    Both,
}

/// A stale branch the user does not want to be told about (bell, notification) — until `until`.
/// Unlike a lock it protects nothing: the branch stays visible and deletable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct Ignore {
    pub identity: String,
    pub branch: String,
    #[serde(with = "lenient")]
    #[cfg_attr(test, ts(as = "IgnoreScope"))]
    pub scope: IgnoreScope,
    /// Unix seconds; None = until the user removes it.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub until: Option<i64>,
}

/// A note and tags on a repository (key: identity) or a branch (key: `identity::branch`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct Annotation {
    pub note: String,
    pub tags: Vec<String>,
}

pub const NOTE_LIMIT: usize = 2000;
const TAG_LIMIT: usize = 40;

pub fn annotation_key(identity: &str, branch: Option<&str>) -> String {
    match branch {
        Some(b) => format!("{identity}::{b}"),
        None => identity.to_string(),
    }
}

/// What counts towards the bell, and whether a new finding raises a system notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct AlertPrefs {
    pub enabled: bool,
    pub notify: bool,
    pub local_safe: bool,
    pub local_review: bool,
    pub online_merged: bool,
    pub online_inactive: bool,
    /// Never pushed, unsafe and quiet for over a month: work that exists only here and was forgotten.
    pub local_forgotten: bool,
}

impl Default for AlertPrefs {
    fn default() -> Self {
        Self { enabled: true, notify: true, local_safe: true, local_review: true, online_merged: true, online_inactive: false, local_forgotten: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, ts(export))]
pub struct Config {
    /// Form of the file; a version that changes what a field means raises it.
    #[cfg_attr(test, ts(skip))]
    pub schema_version: u32,
    pub roots: Vec<String>,
    pub scan_depth: u32,
    /// Local branch names matching these globs are never offered for deletion.
    pub protected_patterns: Vec<String>,
    /// The default patterns this config has been given. A default added in a later version joins
    /// once; one the user removed stays removed. Empty in files written before it existed.
    #[serde(default)]
    pub protected_defaults_known: Vec<String>,
    /// Repo path → remote-tracking ref used as merge target, e.g. `refs/remotes/origin/develop`.
    pub default_branch_overrides: BTreeMap<String, String>,
    /// Candidates tried in order when `origin/HEAD` is not set.
    pub default_branch_candidates: Vec<String>,
    pub my_emails: Vec<String>,
    pub fetch_on_scan: bool,
    pub use_providers: bool,
    pub concurrency: u32,
    #[serde(with = "lenient")]
    #[cfg_attr(test, ts(as = "Theme"))]
    pub theme: Theme,
    pub ui: UiPrefs,
    /// Background refresh every N minutes; 0 = off.
    pub auto_fetch_minutes: u32,
    #[serde(with = "lenient")]
    #[cfg_attr(test, ts(as = "Language"))]
    pub language: Language,
    pub locks: Vec<Lock>,
    pub alerts: AlertPrefs,
    /// An unmerged branch on the server without commits for this many days counts as inactive.
    pub stale_days: u32,
    /// Also assess the branches on the server.
    pub scan_online: bool,
    /// Repository identities whose server branches are not assessed (large repositories).
    pub online_excluded: Vec<String>,
    pub ignores: Vec<Ignore>,
    pub annotations: BTreeMap<String, Annotation>,
    /// Light check of the server heads every N minutes (no data transferred); 0 = off.
    pub server_check_minutes: u32,
    /// Writes every external command with its duration to diagnostics.log.
    pub diagnostics: bool,
    pub window: WindowPrefs,
    /// The user's own commands on repositories and branches.
    pub commands: Vec<crate::custom::CustomCommand>,
    /// Prompt templates for an AI assistant: edited built-in ones and the user's own.
    pub prompts: Vec<crate::prompts::PromptTemplate>,
    /// Read from older files only: moved into `identities` as `repo:<identity>`.
    pub repo_colors: BTreeMap<String, String>,
    pub repo_groups: Vec<RepoGroup>,
    /// Colour and short sign of folders, repositories and repo groups (see `ObjectIdentity`).
    pub identities: BTreeMap<String, ObjectIdentity>,
    /// Fields of a newer version: kept, so a save by this one does not drop them.
    #[serde(flatten)]
    #[cfg_attr(test, ts(skip))]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Raised when a field changes its meaning; files without the field are of this first form.
pub const SCHEMA_VERSION: u32 = 1;

/// Long-lived branches: the integration line and the environment branches deployed from it, which
/// are merged by nature and must not be offered for deletion.
const PROTECTED_DEFAULTS: [&str; 10] =
    ["main", "master", "develop", "release/*", "releases/*", "dev", "test", "prod", "staging", "production"];
/// What a config without `protectedDefaultsKnown` was given: its file predates that field.
const PROTECTED_DEFAULTS_BEFORE_KNOWN: [&str; 5] = ["main", "master", "develop", "release/*", "releases/*"];

impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            roots: Vec::new(),
            scan_depth: 4,
            protected_patterns: PROTECTED_DEFAULTS.map(String::from).to_vec(),
            protected_defaults_known: PROTECTED_DEFAULTS.map(String::from).to_vec(),
            default_branch_overrides: BTreeMap::new(),
            default_branch_candidates: ["main", "master", "develop"].map(String::from).to_vec(),
            my_emails: Vec::new(),
            fetch_on_scan: true,
            use_providers: true,
            concurrency: 6,
            theme: Theme::default(),
            ui: UiPrefs::default(),
            auto_fetch_minutes: 30,
            language: Language::Auto,
            locks: Vec::new(),
            alerts: AlertPrefs::default(),
            stale_days: 30,
            scan_online: true,
            online_excluded: Vec::new(),
            ignores: Vec::new(),
            annotations: BTreeMap::new(),
            server_check_minutes: 5,
            diagnostics: false,
            window: WindowPrefs::default(),
            commands: Vec::new(),
            prompts: Vec::new(),
            repo_colors: BTreeMap::new(),
            repo_groups: Vec::new(),
            identities: BTreeMap::new(),
            extra: serde_json::Map::new(),
        }
    }
}

impl Config {
    pub fn is_protected(&self, branch: &str) -> bool {
        self.protected_patterns.iter().any(|p| glob_match(p.trim(), branch))
    }

    /// Adds the default patterns this config has not been given yet; returns whether it changed.
    pub fn offer_new_protected_defaults(&mut self) -> bool {
        if self.protected_defaults_known.is_empty() {
            self.protected_defaults_known = PROTECTED_DEFAULTS_BEFORE_KNOWN.map(String::from).to_vec();
        }
        let mut changed = false;
        for d in PROTECTED_DEFAULTS {
            if self.protected_defaults_known.iter().any(|k| k == d) {
                continue;
            }
            self.protected_defaults_known.push(d.to_string());
            if !self.protected_patterns.iter().any(|p| p.trim() == d) {
                self.protected_patterns.push(d.to_string());
            }
            changed = true;
        }
        changed
    }

    pub fn is_my_email(&self, email: &str) -> bool {
        self.my_emails.iter().any(|m| m.trim().eq_ignore_ascii_case(email.trim()))
    }

    /// A repository lock covers all of its branches. Branch names compare as on the server (see
    /// `same_branch`): a lock must never miss the branch it was meant for.
    pub fn is_locked(&self, identity: &str, branch: &str) -> bool {
        self.locks.iter().any(|l| l.identity == identity && l.branch.as_deref().is_none_or(|b| same_branch(b, branch)))
    }

    /// Clamps numbers into their valid range and returns the names of the fields that changed,
    /// so an imported or hand-edited file never runs with values the UI could not produce.
    pub fn sanitize(&mut self) -> Vec<String> {
        let mut changed = Vec::new();
        let mut clamp = |name: &str, v: &mut u32, min: u32, max: u32| {
            let c = (*v).clamp(min, max);
            if c != *v {
                *v = c;
                changed.push(name.to_string());
            }
        };
        clamp("scanDepth", &mut self.scan_depth, 1, 8);
        clamp("concurrency", &mut self.concurrency, 1, 32);
        clamp("autoFetchMinutes", &mut self.auto_fetch_minutes, 0, 1440);
        clamp("staleDays", &mut self.stale_days, 1, 3650);
        clamp("serverCheckMinutes", &mut self.server_check_minutes, 0, 1440);
        if crate::custom::sanitize(&mut self.commands) {
            changed.push("commands".into());
        }
        if crate::prompts::sanitize(&mut self.prompts) {
            changed.push("prompts".into());
        }
        let before = self.roots.len();
        self.roots.retain(|r| !r.trim().is_empty());
        // The first mention wins; case and separators do not make a different folder on Windows.
        let mut seen = std::collections::HashSet::new();
        self.roots.retain(|r| seen.insert(crate::paths::path_key(r)));
        if self.roots.len() != before {
            changed.push("roots".into());
        }
        let before = self.annotations.clone();
        for a in self.annotations.values_mut() {
            *a = normalize_annotation(std::mem::take(a));
        }
        self.annotations.retain(|_, a| !a.note.is_empty() || !a.tags.is_empty());
        if self.annotations != before {
            changed.push("annotations".into());
        }
        let layout = &mut self.ui.table_layout;
        if sanitize_columns(&mut layout.local) | sanitize_columns(&mut layout.online) | sanitize_columns(&mut layout.branches) {
            changed.push("ui.tableLayout".into());
        }
        if sanitize_collapsed(&mut self.ui.collapsed) {
            changed.push("ui.collapsed".into());
        }
        if sanitize_dialogs(&mut self.ui.dialog_sizes) {
            changed.push("ui.dialogSizes".into());
        }
        let scale = nearest_scale(self.ui.scale);
        if scale != self.ui.scale {
            self.ui.scale = scale;
            changed.push("ui.scale".into());
        }
        // The colour of a repository moved into its identity; an identity set already wins.
        if !self.repo_colors.is_empty() {
            for (id, color) in std::mem::take(&mut self.repo_colors) {
                if !id.is_empty() {
                    self.identities.entry(format!("repo:{id}")).or_default().color.get_or_insert(color);
                }
            }
            changed.push("repoColors".into());
        }
        if sanitize_identities(&mut self.identities) {
            changed.push("identities".into());
        }
        if sanitize_groups(&mut self.repo_groups) {
            changed.push("repoGroups".into());
        }
        changed
    }

    /// Whether a branch is ignored for alerts right now. Expired ignores simply stop counting.
    pub fn is_ignored(&self, identity: &str, branch: &str, online: bool, now: i64) -> bool {
        self.ignores.iter().any(|i| {
            i.identity == identity
                && i.branch == branch
                && match i.scope {
                    IgnoreScope::Both => true,
                    IgnoreScope::Local => !online,
                    IgnoreScope::Online => online,
                }
                && i.until.is_none_or(|u| u > now)
        })
    }

    pub fn annotation(&self, identity: &str, branch: Option<&str>) -> Annotation {
        self.annotations.get(&annotation_key(identity, branch)).cloned().unwrap_or_default()
    }
}

/// Tags trimmed, without the leading `#`, unique (case-insensitive, first spelling wins), bounded;
/// the note trimmed and cut at the limit on a character boundary.
pub fn normalize_annotation(a: Annotation) -> Annotation {
    let mut seen = std::collections::HashSet::new();
    let tags = a
        .tags
        .into_iter()
        .map(|t| t.trim().trim_start_matches('#').trim().chars().take(TAG_LIMIT).collect::<String>())
        .filter(|t| !t.is_empty() && seen.insert(t.to_lowercase()))
        .collect();
    let note: String = a.note.trim().chars().take(NOTE_LIMIT).collect();
    Annotation { note, tags }
}

/// Branch names without regard to case. Azure DevOps treats `Release/5.2` and `release/5.2` as one
/// branch; a protection or lock that misses a spelling would let the branch into a delete.
fn same_branch(a: &str, b: &str) -> bool {
    a.chars().flat_map(char::to_lowercase).eq(b.chars().flat_map(char::to_lowercase))
}

/// Branch-name globs: `*` and `?` stay within one path segment, `**` crosses segments. Case is
/// ignored for the reason of `same_branch`: a pattern matches more spellings, never fewer.
/// Small on purpose — a full glob crate costs binary size for a handful of patterns.
pub fn glob_match(pattern: &str, text: &str) -> bool {
    // By character, so `?` is one "ü", not one of its bytes. Each (pattern, text) position is
    // decided once: plain backtracking is exponential for patterns with several stars.
    struct M {
        p: Vec<char>,
        t: Vec<char>,
        memo: Vec<Option<bool>>,
    }
    impl M {
        fn go(&mut self, pi: usize, ti: usize) -> bool {
            let slot = pi * (self.t.len() + 1) + ti;
            if let Some(v) = self.memo[slot] {
                return v;
            }
            let v = match self.p.get(pi) {
                None => ti == self.t.len(),
                Some('*') if self.p.get(pi + 1) == Some(&'*') => (ti..=self.t.len()).any(|i| self.go(pi + 2, i)),
                Some('*') => {
                    let seg = self.t[ti..].iter().position(|&c| c == '/').map_or(self.t.len(), |n| ti + n);
                    (ti..=seg).any(|i| self.go(pi + 1, i))
                }
                Some('?') => self.t.get(ti).is_some_and(|&c| c != '/') && self.go(pi + 1, ti + 1),
                Some(&c) => self.t.get(ti).is_some_and(|&t| t == c || t.to_lowercase().eq(c.to_lowercase())) && self.go(pi + 1, ti + 1),
            };
            self.memo[slot] = Some(v);
            v
        }
    }
    if pattern.is_empty() {
        return false;
    }
    let (p, t): (Vec<char>, Vec<char>) = (pattern.chars().collect(), text.chars().collect());
    let memo = vec![None; (p.len() + 1) * (t.len() + 1)];
    M { p, t, memo }.go(0, 0)
}

/// Where config, caches, journal and logs live. MCBRANCHFACE_DATA_DIR points it elsewhere, so tests
/// and demo runs never touch the user's own data.
pub fn app_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("MCBRANCHFACE_DATA_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("McBranchFace")
}

fn config_path() -> PathBuf {
    app_dir().join("config.json")
}

/// Something the user must know about the start, e.g. a config file that could not be read.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(tag = "code", content = "p")]
#[cfg_attr(test, ts(export))]
pub enum StartupIssue {
    /// The file was unreadable; it was moved aside so the next save does not destroy it.
    ConfigCorrupt { backup: String, detail: String },
    /// The file exists but could not be read (locked, no permission); the app runs on defaults and
    /// does not save over it in this run.
    ConfigUnreadable { path: String, detail: String },
    /// The app data folder cannot be written; the app works, but nothing is remembered.
    AppDirReadOnly { path: String, detail: String },
    /// The previous run ended in a crash; its log was kept under `log`.
    LastCrash { log: String, message: String },
    /// Worktree folders an earlier run renamed for a moment (to see whether a program holds a file in
    /// them) and could not name back; the start could not either. Until the user renames them, git and
    /// the app miss these worktrees.
    ProbeLeftovers { folders: Vec<ProbeLeftover> },
}

/// A worktree folder under its probe name, and the name it needs back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ProbeLeftover {
    pub path: String,
    pub original: String,
}

const CRASH_LOG: &str = "crash.log";

/// Release builds abort on a panic; the hook leaves a line behind so the next start can say so.
pub fn install_crash_log() {
    let path = app_dir().join(CRASH_LOG);
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let at = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        let _ = std::fs::create_dir_all(app_dir())
            .and_then(|_| std::fs::write(&path, format!("{} {msg} ({at})\n", crate::git::snapshot::now())));
        default(info);
    }));
}

/// Reports a crash log once: it is renamed, so the next start is quiet again.
pub fn take_crash_report() -> Option<StartupIssue> {
    take_crash_report_in(&app_dir())
}

pub fn take_crash_report_in(dir: &Path) -> Option<StartupIssue> {
    let path = dir.join(CRASH_LOG);
    let text = std::fs::read_to_string(&path).ok()?;
    let kept = dir.join(format!("crash-{}.log", crate::git::snapshot::now()));
    let log = if std::fs::rename(&path, &kept).is_ok() { kept } else { path };
    let message = text.lines().next().unwrap_or("").split_once(' ').map(|(_, m)| m.to_string()).unwrap_or_default();
    Some(StartupIssue::LastCrash { log: log.to_string_lossy().to_string(), message })
}

pub fn load() -> (Config, Option<StartupIssue>) {
    load_from(&config_path())
}

/// Config files that exist but could not be read, nor moved aside: until a load succeeds, a save would
/// replace the user's settings with the defaults the app runs on meanwhile.
static SAVE_BLOCKED: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());

fn block_saving(path: &Path, blocked: bool) {
    let mut list = SAVE_BLOCKED.lock().unwrap_or_else(|p| p.into_inner());
    list.retain(|p| p != path);
    if blocked {
        list.push(path.to_path_buf());
    }
}

fn saving_blocked(path: &Path) -> bool {
    SAVE_BLOCKED.lock().unwrap_or_else(|p| p.into_inner()).iter().any(|p| p == path)
}

pub fn load_from(path: &Path) -> (Config, Option<StartupIssue>) {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            block_saving(path, false);
            return (Config::default(), None);
        }
        Err(e) => {
            block_saving(path, true);
            let issue = StartupIssue::ConfigUnreadable { path: path.to_string_lossy().to_string(), detail: e.to_string() };
            return (Config::default(), Some(issue));
        }
    };
    match serde_json::from_str::<Config>(&text) {
        Ok(mut c) => {
            block_saving(path, false);
            c.sanitize();
            // Not written back: the next save stores both lists, and until then every load comes to the same.
            c.offer_new_protected_defaults();
            (c, None)
        }
        Err(e) => {
            let backup = path.with_file_name(format!("config.corrupt-{}.json", crate::git::snapshot::now()));
            let moved = std::fs::rename(path, &backup);
            // Still in place: a save would overwrite the only copy.
            block_saving(path, moved.is_err());
            let backup = if moved.is_ok() { backup.to_string_lossy().to_string() } else { String::new() };
            (Config::default(), Some(StartupIssue::ConfigCorrupt { backup, detail: e.to_string() }))
        }
    }
}

pub fn save(config: &Config) -> Result<()> {
    save_to(&config_path(), config)
}

/// Written to a temporary file first: a crash or full disk mid-write must not leave a torn config.
pub fn save_to(path: &Path, config: &Config) -> Result<()> {
    if saving_blocked(path) {
        anyhow::bail!("{} could not be read at the start; it is not overwritten", path.display());
    }
    std::fs::create_dir_all(path.parent().context("config path has no parent")?)?;
    let json = serde_json::to_string_pretty(config)?;
    write_atomic(path, json.as_bytes()).with_context(|| format!("cannot write {}", path.display()))
}

/// Replaces `path` through `<name>.tmp` next to it. The temporary file reaches the disk before the
/// rename: otherwise a power loss right after it can leave the new name pointing at an empty file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let Some(name) = path.file_name() else {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, format!("'{}' names no file", path.display())));
    };
    let mut name = name.to_os_string();
    name.push(".tmp");
    let tmp = path.with_file_name(name);
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&tmp, path)
}

pub fn check_app_dir() -> Option<StartupIssue> {
    let dir = app_dir();
    let probe = dir.join(".write-probe");
    let r = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&probe, b"")).and_then(|_| std::fs::remove_file(&probe));
    r.err().map(|e| StartupIssue::AppDirReadOnly { path: dir.to_string_lossy().to_string(), detail: e.to_string() })
}

/// Envelope of an exported config, so an unrelated JSON file is recognised as such on import.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportFile {
    app: String,
    format: u32,
    config: Config,
}

const EXPORT_APP: &str = "McBranchFace";
const EXPORT_FORMAT: u32 = 1;

pub fn export_to(path: &Path, config: &Config) -> Result<()> {
    let file = ExportFile { app: EXPORT_APP.into(), format: EXPORT_FORMAT, config: config.clone() };
    std::fs::write(path, serde_json::to_string_pretty(&file)?).with_context(|| format!("cannot write {}", path.display()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[cfg_attr(test, ts(export))]
pub enum ImportFailureKind {
    Unreadable,
    InvalidJson,
    NotAConfig,
    NewerFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ImportFailure {
    pub kind: ImportFailureKind,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ImportPreview {
    pub config: Config,
    /// Fields whose values were out of range and were clamped.
    pub adjusted: Vec<String>,
}

/// Reads an exported file without applying it; the UI shows the preview and saves on confirmation.
pub fn import_from(path: &Path) -> Result<ImportPreview, ImportFailure> {
    let fail = |kind, detail: String| ImportFailure { kind, detail };
    let text = std::fs::read_to_string(path).map_err(|e| fail(ImportFailureKind::Unreadable, e.to_string()))?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| fail(ImportFailureKind::InvalidJson, e.to_string()))?;
    if value.get("app").and_then(|a| a.as_str()) != Some(EXPORT_APP) {
        return Err(fail(ImportFailureKind::NotAConfig, String::new()));
    }
    let format = value.get("format").and_then(|f| f.as_u64()).unwrap_or(0);
    if format > EXPORT_FORMAT as u64 {
        return Err(fail(ImportFailureKind::NewerFormat, format!("format {format}")));
    }
    let file: ExportFile = serde_json::from_value(value).map_err(|e| fail(ImportFailureKind::InvalidJson, e.to_string()))?;
    let mut config = file.config;
    let adjusted = config.sanitize();
    Ok(ImportPreview { config, adjusted })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_data_folder_defaults_to_the_local_app_data() {
        if std::env::var_os("MCBRANCHFACE_DATA_DIR").is_none() {
            assert!(app_dir().ends_with("McBranchFace"));
            assert!(config_path().ends_with("config.json"));
        }
    }

    #[test]
    fn environment_branches_are_protected_and_a_removed_default_stays_removed() {
        let c = Config::default();
        assert!(["dev", "test", "prod", "main"].iter().all(|b| c.is_protected(b)));
        assert!(!c.is_protected("feature/x"));

        // A file from before the known list: the new defaults join once, beside the user's own edits.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{ "protectedPatterns": ["main", "keep/*"] }"#).unwrap();
        let (mut old, _) = load_from(&path);
        assert_eq!(old.protected_patterns, ["main", "keep/*", "dev", "test", "prod", "staging", "production"]);
        assert!(!old.is_protected("master"), "a default the user had removed before stays removed");

        // Removed again by the user and saved: the next load leaves it out.
        old.protected_patterns.retain(|p| p != "test");
        save_to(&path, &old).unwrap();
        let (again, _) = load_from(&path);
        assert!(!again.is_protected("test") && again.is_protected("prod"));
    }

    #[test]
    fn empty_and_repeated_roots_are_dropped_and_reported() {
        let mut c = Config { roots: vec!["C:/a".into(), "C:/a".into(), "  ".into()], ..Config::default() };
        assert!(c.sanitize().contains(&"roots".to_string()));
        assert_eq!(c.roots, vec!["C:/a".to_string()]);
    }

    // Windows spelling: case and separator do not make a different folder there, but do on other systems.
    #[cfg(windows)]
    #[test]
    fn repo_groups_keep_one_entry_per_id_and_folder() {
        let mut c = Config::default();
        let g = |id: &str, name: &str, paths: &[&str]| RepoGroup { id: id.into(), name: name.into(), paths: paths.iter().map(|p| p.to_string()).collect() };
        c.repo_groups = vec![g("a", "  Core  ", &[r"C:\ws\core", "c:/ws/core/", r"C:\ws\app", " "]), g("a", "Twin", &[]), g("", "No id", &[]), g("b", "Empty", &[])];
        let changed = c.sanitize();
        assert!(changed.contains(&"repoGroups".to_string()));
        assert_eq!(c.repo_groups, vec![g("a", "Core", &[r"C:\ws\core", r"C:\ws\app"]), g("b", "Empty", &[])]);
    }

    #[test]
    fn a_config_from_before_repo_groups_has_none() {
        let c: Config = serde_json::from_str(r#"{"roots": ["C:/ws"]}"#).unwrap();
        assert!(c.repo_groups.is_empty());
        assert!(c.ui.collapsed_repo_groups.is_empty());
    }

    #[test]
    fn dialog_sizes_scale_and_repo_colors_are_kept_in_range() {
        let mut c = Config::default();
        assert_eq!(c.ui.scale, 115, "the default is the larger interface");
        c.ui.dialog_sizes.insert("settings".into(), DialogSize { width: 10, height: 99_999 });
        c.ui.dialog_sizes.insert("x".repeat(40), DialogSize { width: 500, height: 400 });
        c.ui.scale = 121;
        c.repo_colors.insert("id:a".into(), "id-3".into());
        c.repo_colors.insert("id:b".into(), "red".into());
        c.repo_colors.insert("id:c".into(), "id-12".into());
        let changed = c.sanitize();
        for key in ["ui.dialogSizes", "ui.scale", "repoColors", "identities"] {
            assert!(changed.contains(&key.to_string()), "{key}");
        }
        assert_eq!(c.ui.dialog_sizes.get("settings"), Some(&DialogSize { width: 320, height: 3000 }));
        assert!(!c.ui.dialog_sizes.contains_key(&"x".repeat(40)));
        assert_eq!(c.ui.scale, 115);
        // The old repo colours live on as identities; what is not in the palette is gone.
        assert!(c.repo_colors.is_empty());
        assert_eq!(c.identities.keys().collect::<Vec<_>>(), ["repo:id:a"]);
        assert_eq!(c.identities["repo:id:a"].color.as_deref(), Some("id-3"));
        // A hand-edited file with many entries is cut to a bounded number.
        for i in 0..20 {
            c.ui.dialog_sizes.insert(format!("d{i:02}"), DialogSize { width: 500, height: 400 });
        }
        c.sanitize();
        assert_eq!(c.ui.dialog_sizes.len(), 16);
    }

    #[cfg(windows)]
    #[test]
    fn a_root_listed_twice_anywhere_is_kept_once_in_its_first_place() {
        // Windows paths: case and separator do not make a different folder.
        let mut c = Config { roots: vec!["C:/a".into(), "C:/b".into(), "c:\\A\\".into(), "C:/b".into()], ..Config::default() };
        assert!(c.sanitize().contains(&"roots".to_string()));
        assert_eq!(c.roots, vec!["C:/a".to_string(), "C:/b".to_string()]);
    }

    #[test]
    fn table_columns_are_unique_in_range_and_reported() {
        let col = |id: &str, width: u32| ColumnPref { id: id.into(), width, visible: true };
        let mut c = Config::default();
        c.ui.table_layout.local = vec![col("branch", 10), col("repo", 140), col("repo", 90), col("", 90), col(&"x".repeat(40), 90)];
        c.ui.table_layout.online = (0..20).map(|i| col(&format!("c{i}"), 9000)).collect();
        assert!(c.sanitize().contains(&"ui.tableLayout".to_string()));
        assert_eq!(c.ui.table_layout.local, vec![col("branch", 40), col("repo", 140)]);
        assert_eq!(c.ui.table_layout.online.len(), 16);
        assert!(c.ui.table_layout.online.iter().all(|x| x.width == 4000));
        assert!(!c.sanitize().contains(&"ui.tableLayout".to_string()), "a clean layout is left alone");
    }

    #[test]
    fn corrupt_config_is_moved_aside_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, "{ \"roots\": [ broken").unwrap();
        let (c, issue) = load_from(&path);
        assert!(c.roots.is_empty());
        let Some(StartupIssue::ConfigCorrupt { backup, .. }) = issue else { panic!("no issue reported") };
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), "{ \"roots\": [ broken", "original content kept");
        assert!(!path.exists(), "a save may now create a fresh file without destroying the original");
    }

    #[test]
    fn a_config_that_cannot_be_read_is_never_saved_over() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        // There, but not readable: a folder in its place fails like a locked or forbidden file.
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("keep.txt"), "the user's data").unwrap();
        let (c, issue) = load_from(&path);
        assert!(matches!(issue, Some(StartupIssue::ConfigUnreadable { .. })), "{issue:?}");
        assert!(save_to(&path, &c).is_err(), "defaults must not replace what could not be read");
        assert!(path.join("keep.txt").exists());

        // Readable again (here: gone): a successful load lifts the block.
        std::fs::remove_dir_all(&path).unwrap();
        let (c, issue) = load_from(&path);
        assert!(issue.is_none());
        save_to(&path, &c).unwrap();
    }

    #[test]
    fn values_and_fields_of_a_newer_version_neither_break_the_config_nor_get_lost() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let newer = r#"{
            "schemaVersion": 1, "roots": ["C:/r"], "theme": "Neon", "language": "Fr",
            "ui": { "perspective": "Timeline", "tableGroup": "Owner", "cleanupScope": "Both", "scale": 130 },
            "ignores": [{ "identity": "a", "branch": "x", "scope": "Team", "until": null }],
            "futureField": { "on": true }
        }"#;
        std::fs::write(&path, newer).unwrap();
        let (c, issue) = load_from(&path);
        assert!(issue.is_none(), "{issue:?}");
        assert_eq!(c.roots, ["C:/r"]);
        assert_eq!((c.theme, c.language), (Theme::Dark, Language::Auto));
        assert_eq!((c.ui.perspective, c.ui.table_group, c.ui.cleanup_scope, c.ui.scale), (Perspective::Dashboard, TableGroup::None, CleanupScope::Local, 130));
        assert_eq!(c.ignores[0].scope, IgnoreScope::Both);

        save_to(&path, &c).unwrap();
        let saved: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["futureField"]["on"], true, "kept for the newer version");
        assert_eq!(saved["schemaVersion"], SCHEMA_VERSION);
    }

    #[test]
    fn the_defaults_of_the_enums_are_the_ones_a_new_config_gets() {
        let c = Config::default();
        assert_eq!(c.theme, Theme::default());
        assert_eq!(c.ui.perspective, Perspective::default());
        assert_eq!(c.ui.table_group, TableGroup::default());
        assert_eq!(c.ui.cleanup_scope, CleanupScope::default());
    }

    #[test]
    fn older_config_files_get_defaults_for_new_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{ "roots": ["C:/r"], "scanDepth": 99 }"#).unwrap();
        let (c, issue) = load_from(&path);
        assert!(issue.is_none());
        assert_eq!(c.roots, vec!["C:/r".to_string()]);
        assert_eq!(c.scan_depth, 8, "clamped");
        assert!(c.alerts.enabled, "new fields default on");
        assert_eq!(c.stale_days, 30);
    }

    #[test]
    fn export_import_round_trip_and_rejections() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("export.json");
        let mut c = Config { roots: vec!["C:/a".into()], ..Config::default() };
        c.locks.push(Lock { identity: "github.com/o/r".into(), branch: Some("keep".into()) });
        c.prompts.push(crate::prompts::PromptTemplate { id: "p1".into(), name: "Review".into(), body: "Check {{branch}}".into(), ..Default::default() });
        export_to(&file, &c).unwrap();
        let p = import_from(&file).unwrap();
        assert_eq!(p.config.roots, c.roots);
        assert_eq!(p.config.locks, c.locks);
        assert_eq!(p.config.prompts, c.prompts, "prompt templates travel with the settings");
        assert!(p.adjusted.is_empty());

        std::fs::write(&file, r#"{ "roots": [] }"#).unwrap();
        assert_eq!(import_from(&file).unwrap_err().kind, ImportFailureKind::NotAConfig);
        std::fs::write(&file, "nope").unwrap();
        assert_eq!(import_from(&file).unwrap_err().kind, ImportFailureKind::InvalidJson);
        std::fs::write(&file, r#"{ "app": "McBranchFace", "format": 9, "config": {} }"#).unwrap();
        assert_eq!(import_from(&file).unwrap_err().kind, ImportFailureKind::NewerFormat);
        std::fs::write(&file, r#"{ "app": "McBranchFace", "format": 1, "config": { "concurrency": 0 } }"#).unwrap();
        assert_eq!(import_from(&file).unwrap().adjusted, vec!["concurrency".to_string()]);
    }

    #[test]
    fn a_crash_log_is_reported_once() {
        let dir = tempfile::tempdir().unwrap();
        assert!(take_crash_report_in(dir.path()).is_none());
        std::fs::write(dir.path().join(CRASH_LOG), "1700000000 index out of bounds (src/x.rs:3)\n").unwrap();
        let Some(StartupIssue::LastCrash { log, message }) = take_crash_report_in(dir.path()) else { panic!("not reported") };
        assert_eq!(message, "index out of bounds (src/x.rs:3)");
        assert!(std::path::Path::new(&log).exists(), "kept for the user");
        assert!(take_crash_report_in(dir.path()).is_none(), "only once");
    }

    #[test]
    fn ignores_apply_by_scope_and_expire() {
        let mut c = Config::default();
        c.ignores.push(Ignore { identity: "a".into(), branch: "x".into(), scope: IgnoreScope::Local, until: None });
        c.ignores.push(Ignore { identity: "a".into(), branch: "y".into(), scope: IgnoreScope::Both, until: Some(100) });
        c.ignores.push(Ignore { identity: "a".into(), branch: "z".into(), scope: IgnoreScope::Online, until: None });
        assert!(c.is_ignored("a", "x", false, 0));
        assert!(!c.is_ignored("a", "x", true, 0), "local only");
        assert!(c.is_ignored("a", "y", true, 99));
        assert!(!c.is_ignored("a", "y", true, 100), "expired at its end");
        assert!(c.is_ignored("a", "z", true, 0));
        assert!(!c.is_ignored("a", "z", false, 0), "online only");
        assert!(!c.is_ignored("b", "x", false, 0), "other repository");
    }

    #[test]
    fn annotations_are_normalized_and_empty_ones_dropped() {
        let long = "n".repeat(NOTE_LIMIT + 10);
        let a = normalize_annotation(Annotation { note: format!("  {long}  "), tags: vec![" #Release ".into(), "release".into(), "".into(), "QA".into()] });
        assert_eq!(a.tags, ["Release", "QA"], "trimmed, hash removed, unique ignoring case");
        assert_eq!(a.note.chars().count(), NOTE_LIMIT);
        let umlaut = normalize_annotation(Annotation { note: "ä".repeat(NOTE_LIMIT + 1), tags: vec![] });
        assert_eq!(umlaut.note.chars().count(), NOTE_LIMIT, "cut on a character boundary");

        let mut c = Config::default();
        c.annotations.insert(annotation_key("id", Some("b")), Annotation { note: "  ".into(), tags: vec![" ".into()] });
        c.annotations.insert(annotation_key("id", None), Annotation { note: "repo note".into(), tags: vec![] });
        assert_eq!(c.sanitize(), vec!["annotations".to_string()]);
        assert_eq!(c.annotations.len(), 1, "empty annotation removed");
        assert_eq!(c.annotation("id", None).note, "repo note");
        assert_eq!(c.annotation("id", Some("missing")), Annotation::default());
    }

    #[test]
    fn locks_cover_branch_or_whole_repo() {
        let mut c = Config::default();
        c.locks.push(Lock { identity: "a".into(), branch: Some("x".into()) });
        c.locks.push(Lock { identity: "b".into(), branch: None });
        assert!(c.is_locked("a", "x"));
        assert!(!c.is_locked("a", "y"));
        assert!(c.is_locked("b", "anything"));
        assert!(!c.is_locked("c", "x"));
        assert!(c.is_locked("a", "X"), "the server treats branch names case-insensitively");
    }

    #[test]
    fn protection_ignores_case_like_the_server() {
        let c = Config { protected_patterns: vec!["main".into(), "develop".into(), "release/*".into(), "team/Release/**".into()], ..Config::default() };
        for b in ["Main", "MAIN", "Develop", "Release/5.2", "RELEASE/x", "team/release/a/b", "team/RELEASE/x"] {
            assert!(c.is_protected(b), "{b}");
        }
        assert!(!c.is_protected("Release/5/2"), "a star still stays within one segment");
        assert!(!c.is_protected("feature/main"));
        assert!(glob_match("feature/?", "FEATURE/Ä"));
        assert!(glob_match("ÄRGER/*", "ärger/x"));
    }

    #[test]
    fn glob_semantics() {
        assert!(glob_match("main", "main"));
        assert!(!glob_match("main", "main2"));
        assert!(glob_match("release/*", "release/2.4"));
        assert!(!glob_match("release/*", "release/2/hotfix"));
        assert!(glob_match("release/**", "release/2/hotfix"));
        assert!(glob_match("team/release/*/main", "team/release/Contoso/main"));
        assert!(glob_match("feature/?", "feature/a"));
        assert!(!glob_match("feature/?", "feature/ab"));
        assert!(glob_match("*", "anything"));
        assert!(!glob_match("*", "a/b"));
        assert!(!glob_match("", "main"));
    }

    #[test]
    fn glob_question_mark_is_one_character_and_many_stars_stay_fast() {
        assert!(glob_match("feature/?", "feature/ü"));
        assert!(glob_match("f?x/**", "fäx/a/b"));
        let started = std::time::Instant::now();
        let text = "a".repeat(30);
        assert!(!glob_match("*a*a*a*a*a*a*a*a*a*b", &text));
        assert!(!glob_match("**a**a**a**a**a**a**a**a**b", &text));
        assert!(started.elapsed() < std::time::Duration::from_millis(100), "{:?}", started.elapsed());
    }
}

#[cfg(test)]
mod identity_tests {
    use super::*;

    #[test]
    fn identities_keep_a_short_sign_and_a_palette_colour_and_nothing_empty() {
        let mut c = Config::default();
        let id = |short: Option<&str>, color: Option<&str>| ObjectIdentity { short: short.map(String::from), color: color.map(String::from) };
        c.identities.insert("folder:C:/ws".into(), id(Some(" core x long "), Some("id-11")));
        c.identities.insert("group:g1".into(), id(Some("BE"), Some("blue")));
        c.identities.insert("repo:id:r".into(), id(Some("   "), None));
        c.identities.insert("nokind".into(), id(Some("X"), None));
        assert!(c.sanitize().contains(&"identities".to_string()));
        assert_eq!(c.identities["folder:C:/ws"], id(Some("core"), Some("id-11")));
        assert_eq!(c.identities["group:g1"], id(Some("BE"), None));
        assert_eq!(c.identities.len(), 2, "empty and unkeyed entries are dropped");
        assert!(!c.sanitize().contains(&"identities".to_string()), "a clean map stays as it is");
    }
}

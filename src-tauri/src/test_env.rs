//! Tests run git in temporary repositories. The machine's git config (line ending conversion, the
//! default branch name, identity, signing) must not change what they see, so every test binary
//! reads one fixed config instead. Runs before main: set before any test thread spawns git.
//! Test builds only: the app inherits the user's git config as it is.

#[ctor::ctor]
unsafe fn isolate_git_config() {
    std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
    std::env::set_var("GIT_CONFIG_GLOBAL", concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/gitconfig"));
}

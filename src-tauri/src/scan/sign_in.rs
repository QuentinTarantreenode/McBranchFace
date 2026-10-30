//! Signing in per server within one scan. With an expired token every repository on a server fails
//! alike, and where the credential manager may ask, it asked once per repository fetched in parallel.
//! So the first call to a server goes alone; when the server refuses its credentials, the other
//! repositories on it are not asked again in this scan.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::OwnedMutexGuard;

use crate::model::FailureKind;

pub(crate) enum Answer {
    /// No call to the server finished yet.
    Unknown,
    /// The server took the credentials, or could not be reached: further calls go in parallel.
    Open,
    /// The server refused the credentials of this repository.
    Refused { repo: String },
}

#[derive(Default)]
pub(crate) struct SignIns(Mutex<HashMap<String, Arc<tokio::sync::Mutex<Answer>>>>);

pub(crate) enum Entry {
    /// The first call to the server: the others wait until it is settled.
    First(OwnedMutexGuard<Answer>),
    Go,
    /// The server refused the credentials of this repository earlier in the scan.
    Refused(String),
}

impl SignIns {
    /// `server` None (a folder on disk) asks nobody and always goes.
    pub async fn enter(&self, server: Option<&str>) -> Entry {
        let Some(server) = server else { return Entry::Go };
        let slot = self.0.lock().unwrap_or_else(|p| p.into_inner()).entry(server.to_string()).or_insert_with(|| Arc::new(tokio::sync::Mutex::new(Answer::Unknown))).clone();
        let answer = slot.lock_owned().await;
        match &*answer {
            Answer::Unknown => Entry::First(answer),
            Answer::Open => Entry::Go,
            Answer::Refused { repo } => Entry::Refused(repo.clone()),
        }
    }
}

impl Entry {
    /// The outcome of the first call decides for the server; later ones do not: once the server took
    /// the credentials, a refusal concerns that one repository.
    pub fn settle(self, repo: &str, kind: Option<FailureKind>) {
        if let Entry::First(mut answer) = self {
            *answer = match kind {
                Some(FailureKind::AuthRequired) => Answer::Refused { repo: repo.to_string() },
                _ => Answer::Open,
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn a_refused_first_sign_in_stops_the_server_for_the_scan() {
        let s = Arc::new(SignIns::default());
        let first = s.enter(Some("https://dev.azure.com/org")).await;
        assert!(matches!(first, Entry::First(_)));
        let waiting = tokio::spawn({
            let s = s.clone();
            async move { matches!(s.enter(Some("https://dev.azure.com/org")).await, Entry::Refused(r) if r == "C:/ws/a") }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!waiting.is_finished(), "the second call waits for the first");
        assert!(matches!(s.enter(Some("github.com")).await, Entry::First(_)), "another server is not held up");
        first.settle("C:/ws/a", Some(FailureKind::AuthRequired));
        assert!(waiting.await.unwrap(), "and is not made at all");
    }

    #[tokio::test]
    async fn after_an_accepted_sign_in_every_call_goes_and_a_refusal_concerns_one_repository() {
        let s = SignIns::default();
        s.enter(Some("github.com")).await.settle("C:/ws/a", None);
        let later = s.enter(Some("github.com")).await;
        assert!(matches!(later, Entry::Go));
        later.settle("C:/ws/b", Some(FailureKind::AuthRequired));
        assert!(matches!(s.enter(Some("github.com")).await, Entry::Go));
        assert!(matches!(s.enter(None).await, Entry::Go), "a folder on disk");
        s.enter(Some("offline.example")).await.settle("C:/ws/c", Some(FailureKind::Network));
        assert!(matches!(s.enter(Some("offline.example")).await, Entry::Go), "unreached is no refusal");
    }
}

//! Stopping a running scan from the window.

use std::sync::atomic::{AtomicBool, Ordering};

use tokio::sync::Notify;

/// Set once, seen by every waiter, also by one that starts waiting afterwards.
#[derive(Default)]
pub struct Cancel {
    set: AtomicBool,
    notify: Notify,
}

impl Cancel {
    pub fn cancel(&self) {
        self.set.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.set.load(Ordering::SeqCst)
    }

    /// Returns once `cancel` was called.
    pub async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            // Registered before the flag is read: a cancel in between still wakes this waiter.
            notified.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Duration;

    #[tokio::test]
    async fn a_cancel_reaches_waiters_before_and_after_it() {
        let c = Arc::new(Cancel::default());
        let early = tokio::spawn({
            let c = c.clone();
            async move { c.cancelled().await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        c.cancel();
        assert!(tokio::time::timeout(Duration::from_secs(1), early).await.is_ok());
        assert!(tokio::time::timeout(Duration::from_millis(50), c.cancelled()).await.is_ok(), "a late waiter sees it too");
    }
}

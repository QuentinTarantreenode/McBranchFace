//! How many git and provider processes the app's background work runs at once. The scan, single
//! rescans, online refreshes, the server check and the commit search share it: the frontend fires
//! them side by side, and each with a bound of its own made hundreds of processes together.

use std::sync::{Arc, Mutex};

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub struct Budget {
    permits: Arc<Semaphore>,
    size: Mutex<usize>,
}

impl Budget {
    pub fn new(size: usize) -> Self {
        let size = size.max(1);
        Self { permits: Arc::new(Semaphore::new(size)), size: Mutex::new(size) }
    }

    /// One process slot, held until dropped.
    pub async fn acquire(&self) -> OwnedSemaphorePermit {
        self.permits.clone().acquire_owned().await.expect("the budget's semaphore is never closed")
    }

    /// A slot if one is free right now.
    pub fn try_acquire(&self) -> Option<OwnedSemaphorePermit> {
        self.permits.clone().try_acquire_owned().ok()
    }

    /// Follows the setting. Slots in use when it shrinks are taken out as they come back.
    pub fn resize(&self, size: usize) {
        let size = size.max(1);
        let mut current = self.size.lock().unwrap_or_else(|p| p.into_inner());
        if size > *current {
            self.permits.add_permits(size - *current);
        } else if size < *current {
            let excess = *current - size;
            let gone = self.permits.forget_permits(excess);
            if gone < excess {
                let permits = self.permits.clone();
                let rest = (excess - gone) as u32;
                tokio::spawn(async move {
                    if let Ok(p) = permits.acquire_many_owned(rest).await {
                        p.forget();
                    }
                });
            }
        }
        *current = size;
    }

    #[cfg(test)]
    fn available(&self) -> usize {
        self.permits.available_permits()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_budget_follows_the_setting_also_while_slots_are_in_use() {
        let b = Budget::new(3);
        let held = b.acquire().await;
        b.resize(5);
        assert_eq!(b.available(), 4);
        b.resize(1);
        assert_eq!(b.available(), 0, "the free slots go at once");
        assert!(b.try_acquire().is_none());
        drop(held);
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(b.available(), 1, "the slot in use went back to the new size, not beyond");
        b.resize(0);
        assert_eq!(b.available(), 1, "never below one");
    }
}

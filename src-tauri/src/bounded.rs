use std::future::Future;

use futures::stream::{self, StreamExt};

/// Runs `f` for every item, at most `limit` at a time, results in the order of `items`. With many
/// repositories "all at once" means hundreds of git processes, and servers throttle the calls.
/// A slow item holds no free slot: the next one starts as soon as any finishes.
pub async fn bounded<I, T, F, Fut>(items: I, limit: usize, mut f: F) -> Vec<T>
where
    I: IntoIterator,
    F: FnMut(I::Item) -> Fut,
    Fut: Future<Output = T>,
{
    let futures: Vec<_> = items.into_iter().enumerate().map(|(i, item)| {
        let fut = f(item);
        async move { (i, fut.await) }
    }).collect();
    let mut done: Vec<(usize, T)> = stream::iter(futures).buffer_unordered(limit.max(1)).collect().await;
    done.sort_by_key(|(i, _)| *i);
    done.into_iter().map(|(_, t)| t).collect()
}

#[cfg(test)]
mod tests {
    use super::bounded;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[tokio::test]
    async fn never_more_than_the_limit_at_once_and_results_in_order() {
        let running = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let out = bounded(0..20u64, 3, |i| {
            let (running, peak) = (&running, &peak);
            async move {
                let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                // Later items finish first: the order must still be the input's.
                tokio::time::sleep(Duration::from_millis(20 - i)).await;
                running.fetch_sub(1, Ordering::SeqCst);
                i * 2
            }
        })
        .await;
        assert_eq!(out, (0..20).map(|i| i * 2).collect::<Vec<_>>());
        assert_eq!(peak.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn a_slow_item_does_not_hold_up_the_ones_behind_it() {
        let started = std::time::Instant::now();
        let order = std::sync::Mutex::new(Vec::new());
        // The first takes 300 ms; the five quick ones must run beside it in the other slot.
        bounded(0..6u64, 2, |i| {
            let order = &order;
            async move {
                tokio::time::sleep(Duration::from_millis(if i == 0 { 300 } else { 20 })).await;
                order.lock().unwrap().push(i);
            }
        })
        .await;
        assert_eq!(order.lock().unwrap().last(), Some(&0), "{:?}", order.lock().unwrap());
        assert!(started.elapsed() < Duration::from_millis(450), "took {:?}", started.elapsed());
    }

    #[tokio::test]
    async fn a_limit_of_zero_still_runs_one_at_a_time() {
        let out = bounded(["a", "b"], 0, |s| async move { s.len() }).await;
        assert_eq!(out, [1, 1]);
    }
}

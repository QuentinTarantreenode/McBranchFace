import { onDestroy, untrack } from "svelte";

/**
 * True only once `flag` has been true for `ms`: loads faster than that show no skeleton at all,
 * so a quick refresh never flickers. Call during component initialisation.
 */
export function delayed(flag: () => boolean, ms = 150) {
  let value = $state(false);
  $effect(() => {
    if (!flag()) {
      value = false;
      return;
    }
    const t = setTimeout(() => (value = true), ms);
    return () => clearTimeout(t);
  });
  return {
    get value() {
      return value;
    },
  };
}

/**
 * Hands the value of `read` to `run` once it has rested for `ms`: typing stays instant, the work
 * follows the pause. Only `read` is tracked; `run` may read and write whatever it likes. `flush`: a
 * value still waiting when the component goes (another view) is handed over then, not dropped.
 * Call during component initialisation.
 */
export function debounced<T>(read: () => T, ms: number, run: (value: T) => void, opts: { flush?: boolean } = {}) {
  let waiting: { value: T } | null = null;
  $effect(() => {
    const value = read();
    waiting = { value };
    const timer = setTimeout(() => {
      waiting = null;
      run(value);
    }, ms);
    return () => clearTimeout(timer);
  });
  if (opts.flush)
    onDestroy(() => {
      const last = waiting;
      waiting = null;
      if (last) untrack(() => run(last.value));
    });
}

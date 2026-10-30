/**
 * Runs `fn` for every item, at most `limit` at a time. Each call is a git process or more: with many
 * repos, all at once would start hundreds of them. A failing item does not stop the others; what failed
 * comes back, so the caller decides whether that is worth saying.
 */
export async function pooled<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<unknown>): Promise<{ item: T; error: unknown }[]> {
  let next = 0;
  const failed: { item: T; error: unknown }[] = [];
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item).catch((error: unknown) => failed.push({ item, error }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return failed;
}

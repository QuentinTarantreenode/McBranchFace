// Marks of the start for the measurement (scripts/perf-start.mjs): each once, costing next to nothing.
const done = new Set<string>();

export function mark(name: string) {
  if (done.has(name)) return;
  done.add(name);
  performance.mark(`mbf:${name}`);
}

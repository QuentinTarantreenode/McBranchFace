import { i18n, t } from "./i18n/index.svelte";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

const formatters = new Map<string, Intl.RelativeTimeFormat>();
function rtf() {
  let f = formatters.get(i18n.locale);
  if (!f) formatters.set(i18n.locale, (f = new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" })));
  return f;
}

export function relativeTime(unixSeconds: number, now = Date.now() / 1000): string {
  const diff = unixSeconds - now;
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) return rtf().format(Math.round(diff / secs), unit);
  }
  return t.time.justNow;
}

export function absoluteTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(i18n.locale, { dateStyle: "medium", timeStyle: "short" });
}

export function dateOnly(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(i18n.locale, { dateStyle: "medium" });
}

export const shortSha = (sha: string) => sha.slice(0, 8);

export const shortRef = (ref: string) => ref.replace(/^refs\/(remotes|heads)\//, "");

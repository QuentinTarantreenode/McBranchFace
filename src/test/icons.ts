// Stand-in for the icon package in component tests: every named icon renders an empty svg, so a
// test does not load and transform thousands of icon modules.
import Icon from "./Icon.svelte";

// "then" must stay undefined, or the module would be taken for a promise.
export const iconModule = () =>
  new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : k === "then" || typeof k === "symbol" ? undefined : Icon),
    has: (_, k) => k !== "then",
  });

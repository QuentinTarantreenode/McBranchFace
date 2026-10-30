/**
 * Moves a floating panel to the app root. Opened from inside a contained element (a sidebar card
 * with content-visibility), a fixed panel would be placed and clipped by that card. The app root,
 * not the body: Svelte delegates events to the element it was mounted on.
 */
export function portal(node: HTMLElement) {
  (document.getElementById("app") ?? document.body).appendChild(node);
  return { destroy: () => node.remove() };
}

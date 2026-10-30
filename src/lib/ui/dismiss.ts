// One signal that closes every open popover for what happens outside the page: a press on the window's
// title bar or frame, moving or resizing the window. The page sees none of it on its own; each popover
// still closes on its own clicks, Esc and blur.
import { listen } from "@tauri-apps/api/event";

type Handler = () => void;
const handlers = new Set<Handler>();
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  const fire = () => [...handlers].forEach((h) => h());
  // Outside the app (tests, audit) there is no window to listen to.
  void listen("window-chrome-pressed", fire).catch(() => {});
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      void w.onMoved(fire).catch(() => {});
      void w.onResized(fire).catch(() => {});
    })
    .catch(() => {});
}

/** Calls `handler` when the window outside the page is pressed, moved or resized; returns the unsubscribe. */
export function onDismiss(handler: Handler): () => void {
  wire();
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** For tests: what a press on the title bar does. */
export function dismissAll() {
  [...handlers].forEach((h) => h());
}

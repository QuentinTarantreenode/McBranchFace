import { invoke } from "./invoke";

// The window calls the app makes, without the full window API: that module is ~20 KB of the
// start bundle for show, theme and always-on-top. The app has exactly one window.
const label = "main";

export const appWindow = {
  show: () => invoke<void>("plugin:window|show", { label }),
  /** null: follow the system. */
  setTheme: (value: "dark" | "light" | null) => invoke<void>("plugin:window|set_theme", { label, value }),
  setAlwaysOnTop: (value: boolean) => invoke<void>("plugin:window|set_always_on_top", { label, value }),
  setZoom: (value: number) => invoke<void>("plugin:webview|set_webview_zoom", { label, value }),
  setMinSize: (width: number, height: number) => invoke<void>("plugin:window|set_min_size", { label, value: { Logical: { width, height } } }),
};

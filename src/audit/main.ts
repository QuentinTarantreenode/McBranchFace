// Entry of the audit build (vite build --mode audit): the app on a simulated backend with demo data,
// for layout, tooltip and jank checks in a headless browser. Never part of the release bundle.
import { mount } from "svelte";
import "../app.css";
import { installBackend } from "../test/backend";
import { fixture } from "./fixture";

installBackend(fixture());
// Loaded after the backend is in place. Not awaited at the top: the app's chunk imports from this one,
// which must have finished evaluating by then.
void Promise.all([import("../App.svelte"), import("../lib/app/testHook.svelte")]).then(([{ default: App }, hook]) => {
  hook.install();
  mount(App, { target: document.getElementById("app")! });
});

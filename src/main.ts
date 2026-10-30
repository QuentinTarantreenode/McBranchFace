import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
// The handles the CDP-driven scripts use, in the dev and e2e builds (PROBED in lib/probe.ts; the audit build has an
// entry of its own). Written out rather than imported: only a condition Vite replaces in this file lets the release
// build drop the branch before it makes a chunk of the module.
if (import.meta.env.DEV || import.meta.env.MODE === "e2e") void import("./lib/app/testHook.svelte").then((m) => m.install());

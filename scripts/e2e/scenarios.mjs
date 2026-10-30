// Every scenario of the e2e run, in run order. Each one starts from a fresh copy of the demo workspace (or none)
// and a fresh page, and says what else it needs in `config`; none relies on what another one left behind.
//   { name, title, workspace?: "none", config?: Partial<Config>, windowsOnly?: true, run(t, ctx) }
import { APP } from "./scenarios/app.mjs";
import { CLEANUP } from "./scenarios/cleanup.mjs";
import { DASHBOARD } from "./scenarios/dashboard.mjs";
import { GIT } from "./scenarios/git.mjs";
import { SIDEBAR } from "./scenarios/sidebar.mjs";

export const SCENARIOS = [...CLEANUP, ...DASHBOARD, ...GIT, ...SIDEBAR, ...APP];

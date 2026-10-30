import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import svelteParser from "svelte-eslint-parser";
import mbf from "./index.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: svelteParser, ecmaVersion: 2022, sourceType: "module" } });
const rules = mbf.rules as Record<string, Parameters<typeof tester.run>[1]>;
const svelte = (code: string) => ({ code, filename: "x.svelte" });

tester.run("no-literal-ui-text", rules["no-literal-ui-text"], {
  valid: [svelte("<p>{t.a}</p>"), svelte('<b aria-label={t.x}>›</b>'), svelte("<code>git fetch</code>"), svelte("<span>McBranchFace</span>"), svelte('<i use:tooltip={t.tip}></i>')],
  invalid: [
    { ...svelte("<p>Breite ziehen</p>"), errors: 1 },
    { ...svelte('<b aria-label="Close">x</b>'), errors: 2 },
    { ...svelte('<i use:tooltip={"Breite ziehen · Pfeiltasten"}></i>'), errors: 1 },
    { ...svelte('<VirtualList label="Commits and more" />'), errors: 1 },
  ],
});

tester.run("no-break-all", rules["no-break-all"], {
  valid: [svelte('<p class="truncate">{x}</p>')],
  invalid: [
    { ...svelte('<p class="font-mono break-all">{x}</p>'), errors: 1 },
    { ...svelte('<p class="[overflow-wrap:anywhere]">{x}</p>'), errors: 1 },
  ],
});

tester.run("no-native-title", rules["no-native-title"], {
  valid: [svelte("<Modal title={t.x} />")],
  invalid: [{ ...svelte("<span title={x}>{x}</span>"), errors: 1 }],
});

tester.run("no-raw-color", rules["no-raw-color"], {
  valid: [svelte('<p class="text-muted shadow-[0_1px_2px_rgb(0_0_0/0.3)]"></p>')],
  invalid: [
    { ...svelte('<p class="text-[#ff0000]"></p>'), errors: 1 },
    { ...svelte('<p style="color: rgb(1, 2, 3)"></p>'), errors: 1 },
  ],
});

tester.run("raw-path-display", rules["raw-path-display"], {
  valid: [svelte("<p>{displayPath(root)}</p>"), svelte("<p>{p.dir}</p>"), svelte('<p title={b.repoPath}></p>')],
  invalid: [
    { ...svelte("<p>{root}</p>"), errors: 1 },
    { ...svelte("<p>{lb.worktree.path}</p>"), errors: 1 },
    { ...svelte("<p>{open.repoPath}</p>"), errors: 1 },
  ],
});

tester.run("tooltip-repeats-text", rules["tooltip-repeats-text"], {
  valid: [svelte("<span use:fullText={x}>{x}</span>"), svelte("<span use:tooltip={absoluteTime(t)}>{relativeTime(t)}</span>")],
  invalid: [{ ...svelte("<span use:tooltip={b.subject}>{b.subject}</span>"), errors: 1 }],
});

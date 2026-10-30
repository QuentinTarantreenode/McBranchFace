---
name: author-blind-review
description: >-
  Author-blind code review: a reviewer who knows ONLY the requirements, the scope of the change and a
  neutral brief about the system — not the derivation, not the debugging history, not the author's
  intent — looks for bugs as a neutral observer. Runs as a separate agent with a fresh context. Use
  when a contributor says "blind review", "author-blind review", "neutral review", "review without
  prior knowledge", "check it as an outsider", "fresh eyes on this code", "what would someone notice
  who only knows the requirement". Complements software-design and product-review: there the author
  reviews the work; here a stranger checks the implementation against the requirement.
---

# Author-blind review — the reviewer knows the requirement, not the author

You read your own change with your own reasoning in mind. That reasoning is the problem: it explains every
line, including the wrong one. This skill separates author and reviewer. The reviewer gets three things
and nothing else: **the requirements**, **the scope of the change**, **a neutral brief**. It looks for bugs
that someone notices who knows what the change is for, but not how it came about.

## Why an agent and not a self-review

The blindness is real only if the reviewer **cannot read** the history. So the review runs as a separate
agent with a fresh context (in Claude Code: the `Agent` tool with `general-purpose`; with other agents: a
new session that receives only the brief). The author writes the brief, starts the agent, waits, and then
judges every finding on its own — with evidence, never with "that is intended".

## What the reviewer gets — and what not

| Gets | Does NOT get |
|---|---|
| Requirements as acceptance criteria, from the user's view | the author's derivation ("because git does X here …") |
| Scope: repo, base ref, file list, how to pull the diff | the debugging history, discarded approaches, measurement series |
| Brief: what the system is, which components matter, where their sources are, how tests run | judgements ("is robust", "is tested") |
| Rules: read and measure only, change nothing, comments are claims | access to this conversation |

**The brief is neutral.** It states facts, not reasons. "Deleting a branch runs through `delete.rs`; the
backend locks per repository (`locks.rs`)" is a fact. "The journal path is safe because …" is a
justification and stays out. If you catch yourself justifying while writing the brief, delete the sentence.

**The reviewer sees the comments in the code** — they are part of it. The brief says explicitly: comments
are the author's claims and are checked, not believed.

## Prompt template for the agent

```
You are a neutral code reviewer. You know the requirements and the domain, but NOT how this change came
about. Look for bugs, gaps against the requirements, race conditions, regressions of existing behaviour,
and dead or misleading code.

## Requirements (acceptance criteria)
<numbered list, user's view, checkable>

## Scope
Repo: <path>   Base: <git ref, e.g. main or HEAD~3>
Files: <list>
Diff: git -C <repo> diff <base> -- <files>

## Brief (facts, no reasons)
<system, platform, components involved, where their sources are, how tests run, e.g.
 npm test · cd src-tauri && cargo test · node scripts/verify.mjs --only <step>>

## Rules
- Read and measure only. Change no file. Allowed: git diff/show/log, grep, reading sources, the test
  commands named above.
- Comments in the code are the author's claims. Check them against the code; a claim you cannot prove is
  a finding ("unproven"), not a fact.
- Every statement with file:line. Separate strictly "proven" (seen in the code or measured) from
  "suspected".
- Do NOT judge style. Only: bug, requirement gap, risk, misleading code.

## Result
Per finding: number · severity (bug | requirement gap | risk | note) · file:line · what is wrong ·
a concrete failure scenario (input/state -> wrong result) · how to verify it · proven/suspected.
Then: which requirement you could NOT check, and why. Then a one-line overall verdict.
No politeness, no summary of the diff.
```

## Procedure

1. **Write the brief** (author). Requirements come from the issue AND from the decisions made along the
   way — every decision is a requirement ("Escape closes in one press and leaves the value unchanged").
   The brief holds facts only. The scope is a git ref, so the reviewer pulls the diff itself.
2. **Start the agent** with the template and wait for it in the foreground: the next step needs the
   result. Do not pick a smaller model; a blind reviewer with less capacity finds less.
3. **Judge the findings** (author), one by one and in writing: **confirmed** (with a fix or a task) ·
   **refuted** (with evidence, `file:line` or a measurement — "it is intended" does not count) · **open**
   (not decidable without measuring; then measure, or name it as a limit). A refuted finding that rests on
   a misleading comment is still a finding: the comment gets fixed.
4. **Report:** a table of the findings with their judgement, what was changed because of them, what stays
   open. Pass on the substance of the agent's report, not its raw text.

## Traps

- **The brief gives the solution away.** Naming in the brief which mechanism takes effect puts the
  author's glasses on the reviewer. Only requirements and facts about the system.
- **Arguing findings away.** "That cannot happen in practice" is a guess. Measure it or keep it open.
- **Too small a reviewer.** Half the capacity gives half the certainty and full reassurance — the worst
  combination.
- **Taking the author's tests as proof.** The reviewer reads the tests and asks whether they could see the
  bug at all: would they be red without the fix (`software-design`, "Tests that prove something")?

---
name: product-review
description: >-
  Review a tool or feature as a whole, from four angles in a fixed order — the user's path (ux-flow),
  the measured visuals (ui-layout), the code (software-design), the architecture
  (software-architecture) — with an honest verdict ("am I satisfied?"), prioritised findings P1–P3,
  what is good and stays, and an order of implementation. Use when a contributor says "review this",
  "review the feature", "are you satisfied", "are you happy with the result", "is this good enough",
  "full review", "UI and code review", "UX/UI best practice", "is everything SSOT and SOLID",
  "acceptance", "check before release" — and unasked before reporting a self-built feature as done.
---

# Product review — the user first, then the pixels, then the code

A review that starts with the code finds code problems and misses that the primary task hides behind a
checkbox. That is why the order is fixed.

## Procedure

1. **Honest starting question.** What is proven (tests, real data, measurements), what is only claimed?
   The verdict opens the answer: satisfied / satisfied with X, not with Y. No "all good" when only the
   happy path was checked.
2. **User path** → `ux-flow`, first step: who, how often, the primary task and its share, exceptions, the
   end. Write it down numbered; everything after refers to it.
3. **UX findings** → the `ux-flow` rules, checked against that path.
4. **UI, measured** → `ui-layout`: compute the layout budget against the minimum window width, run the
   audit (`npm run audit`: both themes at 1100, 1280 and 1600 px), look at the screenshots. Then the
   visual check as a user: alignment, symmetry, empty areas, tooltips, redundancy, whether every area and
   button is understandable without hovering, implausible values in the picture. For consistency across
   all views, `ui-critique`. Fix, take the screenshots again. Collect facts instead of guessing:
   ```bash
   grep -ohE 'text-\[[0-9.]+px\]' -r src | sort | uniq -c | sort -rn   # type scale
   grep -rnE 'Record<\w+,' src                                           # SSOT for enums
   ```
5. **Code** → `software-design`: SSOT grep passes, SRP signals (length, parameters, lint `allow`), silent
   limits, heuristics with counterexamples, dead code, test gaps.
6. **Architecture** → `software-architecture`: layers (`src/lib/architecture.test.ts`), generated
   contracts, adapter robustness, destructive operations (verify → backup → act → journal → restore, and
   their order), the lock table, degradation, headless verification.
7. **Real data,** read-only where possible: `cargo run --example scan -- <root> --json` against a
   reference. Which verdicts would be wrong?

When an outside view on bugs is needed, add `author-blind-review`.

## Result format

```
Verdict — one paragraph: satisfied with what, not with what, what is proven.

## 1. How the user uses it          (numbered path, primary task with its share)
## 2. UI/UX findings
   P1 – breaks or slows the primary task   | # | Finding | Why it hurts | Proposal |
   P2 – grouping, overload                 | … |
   P3 – polish                              (list)
   What is good and stays                   (list)
## 3. Code review: SSOT and SOLID          (finding with file:line, grouped)
## 4. Architecture and correctness risks   (risk: what happens in the bad case)
## 5. Proposal                             (order of implementation, then ask what to implement)
```

Rules for the text: every finding with evidence (measurement, location, screenshot, count). Numbers only
when measured; otherwise mark them "computed" or "estimated". No more than needed: findings the user does
not feel and that carry no risk go to P3 or are dropped. Technical terms stay as they are in the code.

## After the review

The review changes nothing; it ends with the question what to implement. When implementing: in the
proposed order, and repeat the measurement of step 4 after each stage. A new lesson from the review goes
into the matching skill as a rule with a one-line why, not only into the conversation.

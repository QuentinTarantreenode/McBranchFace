---
name: ui-critique
description: >-
  Critique the McBranchFace UI as a whole from the user's seat: screenshots of every view in light and dark,
  consistency across views (same element, same shape, same meaning), every view against the rules of
  ui-layout and ux-flow and against a checklist of critiques that keep coming back, a verdict, and findings
  P1–P3 with a loss check ("does the fix take something away?"). Use when a contributor says "critique the
  ui", "ui critique", "is this consistent", "walk through the ui", "visual review", "user's view", "what
  bothers you about the ui", "does this look good", "polish pass" — and whenever someone criticises a surface
  ("I don't like this", "looks odd", "this must not happen", "not implemented", "blurry", "jumps", "too
  much", a screenshot with a complaint): then turn the complaint into a rule first. Neighbours: ui-layout
  (measuring, rules), ux-flow (the user's path), product-review (overall review including code).
---

# UI critique — see first, compare second, judge last

The audit measures spacing and contrast. It does not see that one thing has three faces in three places,
that a colour carries two meanings, or that a complaint was made before. This critique looks, compares across
views and checks against the critiques that keep coming back. Why: complaints fixed one at a time returned in
the next feature, somewhere else.

## Step 0 · A complaint becomes a rule (always first)
- When someone criticises a surface (in words or with a screenshot), every point becomes a checkable rule: the
  rule as one sentence, plus how to see it ("what in the screenshot or in the code shows it?").
- A general rule goes into ui-layout or ux-flow, a recurring trap into the checklist below, in the same change
  as the fix. If it can be measured, it also becomes an audit rule or a test, calibrated on a planted case.
- Only then implement. A complaint fixed only in the code comes back with the next feature.

## Step 1 · Load
Load ui-layout and ux-flow: their rules are the yardstick; the checklist below adds what keeps coming back.

## Step 2 · See: screenshots of every view
- `npm run audit -- --shots audit-shots`: every view of `scripts/ui-audit.mjs`, light and dark, at 1280 px
  (device scale 1.5), plus the audit's findings at 1100, 1280 and 1600 px. Other widths or states over CDP, as
  in ui-layout ("Against the running app"). Menus, dialogs, tooltips, empty, loading and failed states belong
  in it; a state without a view gets one.
- `npm run e2e` leaves a screenshot of every passed scenario: the real app instead of the simulated backend.
- **Look at the screenshots**; do not only read the number of findings. Zero findings means nothing
  measurable, not nothing wrong.
- Screenshots from the person who complains outrank your own: real data beats the fixture.

## Step 3 · Consistency: one inventory across all views
One line per kind of element: where does it occur, does it look the same everywhere, does it mean the same?

| Kind | Check |
|---|---|
| Buttons | same height per size, a verb as label, one primary button per area, one verb for one act everywhere |
| Icon buttons | visible edge, tooltip with a title, same size within a bar |
| Counts, badges | always framed (`mbf-count`, `StatusChip`), never bare digits; one number not twice in a view without reason |
| Chips, pills | same height, inner spacing at least 4 and 2 px, same colour = same meaning |
| Colours | one meaning each: accent = action and selection, status tones = status, identity = folder, repo, group |
| Edges | left = identity, selection = frame plus fill, structure neutral |
| Heads | same height; title, count and tools in the same order; a tooltip on the title |
| Lists, tables | a grid with a head, sortable, numbers right-aligned, cut text with its tooltip |
| Rows that lead on | whole row clickable, visible hover edge, chevron; an immediate action right, in a fixed column |
| Empty, loading | empty state as a full sentence, placeholder in the shape of the content, no unexplained empty area |
| Texts | short names, explanations as sentences, git terms kept, no implementation words |
| Floating things | tooltips and popovers sharp (whole device pixels), inside the window, off its edge |
| What runs | progress, errors and activity in one central place, shown only when switched on |

Report deviations as a table **Kind | views | deviation | target**.

## Step 4 · Every view
Per view: the seven questions of the visual check in ui-layout (calm, alignment, empty areas, help,
redundancy, obvious at once, plausible data). Then ux-flow: is the primary task the most visible action? Does
every number and every row lead somewhere? Does the view say what it shows and what a click does? Then each
item of the checklist: does it apply here, and is it kept?

## Checklist — critiques that keep coming back
Each item is a rule and its check. Fixed items stay: they are exactly the ones that return.

1. **Clickable looks clickable.** Check: every clickable element has an edge or a fill at rest.
2. **Explanations are sentences.** Check: tooltips, hints and empty states read as sentences, not as keywords
   after a dash.
3. **A row with several kinds of information is a table** with column heads, built on the existing grid
   (`gridModel`), not a second kind of list. Check, playing dumb: read each row aloud — what is it, where, how
   much, what should I do, what happens on a click? Each answer stands visibly in a named column; every number
   has a unit, every symbol a meaning in words; no row has two click targets without a difference in words.
4. **Same concept, same handling.** Check: folder and group side by side (head, menu, selection, batch
   actions) behave alike.
5. **Navigation never looks like an action.** Check: no view tab carries the primary button's colour; the
   active tab is anchored to the surface below it.
6. **A floating panel hides no tools and is a card,** not a frame in page colour. Check: the overlay starts
   below the toolbar; its edge is the card's shadow, not a wide border.
7. **What runs: source, operation, place — once, central, on request, no milliseconds.** Check: no element
   but the status slot shows run details; no "ms" in any text.
8. **Progress lies above everything at its edge.** Check: the scan bar is fully visible during a scan, not
   behind the tabs.
9. **Everything foldable folds both ways.** Check: a test or audit view opens and closes every fold once.
10. **What happens by itself can be looked up and switched off.** Check: every automatic trigger is logged and
    has a switch.
11. **What changes its width stands at the end of its row;** reading order is source, action, state. Check:
    nothing right of a width-changing element moves (audit `jump`).
12. **Zones of a bar are visibly separated.** Check: tabs and tools in the top bar are parted by a divider.
13. **A row that names something leads exactly there** (filtered, the reason as a chip), shows its details, and
    its tooltip says so. Check: click the row; the target shows exactly what the row named.
14. **Who is responsible is visible.** Check: a list of pull requests shows the author when it shows everyone's.
15. **Useful, not decorative.** Check: for every number, ask what I do with it and where it takes me.
16. **Floating things are sharp.** Check: tooltips at 125 % and 150 % scale; positions on device pixels, no
    `will-change: transform`.
17. **One edge, one meaning, and identity at every left edge,** inherited too (the folder's colour when the
    repo has none of its own). A fix for the special case only counts as not done. Check: cards, heads, group
    members and table rows of a repo without a colour of its own.
18. **Identity in a tree is one continuous line** over the node, from head to last child, never over icons.
    Check: the changes panel and every other tree; audit `overlap`.
19. **A button names verb and object;** whatever shows the hand cursor says in its tooltip what a click does.
    Check: no button is only a place ("In Git") or a bare verb ("Delete …"); audit `pointer`.
20. **The system names the app by its name,** and test or dev runs raise no visible system notifications.
    Check: a notification of the installed app shows its name; the e2e run sends none.

## Step 5 · The look is set
Identity colours (the `--id-*` palette; folder, repo, group and prefix colours; the tint of a card in its
colour) and surface shading (the tokens for ground, card, popover, segments, zebra) are the product's look,
not material for a critique. A finding about them is named, marked **Look change**, and implemented only when
explicitly asked for. Everything else (structure, shortening, texts, numbers, behaviour, consistency of shape)
is fixed without changing the look. Check: the diff of a critique fix leaves these tokens alone.

## Step 6 · Loss check — before every proposal
Every finding gets a column **Loss**: what would go (information, function, findability, keyboard path)? A fix
that takes something away is rephrased — bundle instead of dim, quieter instead of hidden, smaller instead of
removed — and never proposed silently. Why: asked which of its points would remove important functions or
information, one critique found that a quarter of them did.

## Step 7 · Result
1. **Verdict** in two or three sentences: does the surface carry the user, and what is the biggest problem?
2. **Consistency:** the table from step 3, deviations only.
3. **Findings:** **P | view | finding | rule (ui-layout, ux-flow or checklist item) | fix | loss**. P1 misleads
   or loses data, P2 inconsistent or unclear, P3 calm and polish.
4. **What is good and stays,** so a fix does not tear it down.
5. **Recurring:** checklist items violated again come first; they weigh double.
6. **Done / still to do.** Implement after the requester has chosen, unless they already said what to do.

## After implementing
Take the screenshots again and tick the findings off one by one. A rule that was missing goes into ui-layout,
ux-flow or the checklist in the same change.

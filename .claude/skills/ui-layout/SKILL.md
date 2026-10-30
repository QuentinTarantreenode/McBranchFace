---
name: ui-layout
description: >-
  Design and review the visual layout of the McBranchFace UI by measuring instead of judging by eye: layout
  budget against the minimum window width, type and spacing scales, design tokens from src/app.css, contrast
  in both themes, truncation and tooltips, surfaces, menus and popovers, tables and groups, loading states;
  screenshots at several widths in light and dark and the headless audit (npm run audit). Use when a
  contributor says "ui review", "layout", "spacing", "alignment", "overlaps", "cut off", "truncated", "narrow
  window", "responsive", "typography", "colors", "contrast", "dark mode", "light theme", "design tokens",
  "looks busy", "looks off", "tooltip", "menu", "popover", "audit finding", "ui-audit fails" — and without
  being asked before a UI change is reported as done. Neighbours: ux-flow (the user's path), ui-critique
  (critique of the whole UI), product-review (overall review including code).
---

# UI layout — measure, don't guess

The eye only checks the window width you happen to develop at. The classic failure: at 1440 px everything
looked fine; at the allowed minimum of 1100 px the branch column had 0 px left. The overlap had been visible in
the very first screenshot and was only widened away. So: compute the budget, run the audit, and look at
screenshots at several widths in both themes.

## Measuring

Required before "done" and in every UI review.

**Headless audit.** `npm run audit` (= `vite build --mode audit && node scripts/ui-audit.mjs`) builds
`audit.html`: the app on the simulated backend (`src/test/backend.ts`) with deterministic demo data
(`src/audit/fixture.ts`). `scripts/ui-audit.mjs` drives headless Chrome or Edge over CDP (`CHROME_PATH` picks
one), runs every entry of `views` in both themes at **1100, 1280 and 1600 px**, and fails on every finding
not listed in `scripts/audit/allow.json` (each entry with its reason). It is the `ui-audit` step of
`npm run verify`.

- A few views only: `npm run audit -- local,git-diff` (substring match on view names).
- Screenshots: `npm run audit -- <filter> --shots audit-shots` writes `<Theme>-<view>.png` per view at
  1280 px, device scale 1.5 (`/audit-shots` is git-ignored).
- Page scripts in `scripts/audit/`: `layout-audit.js` (every view, width and theme), `tooltip-audit.js`
  (1280, light), `naked-audit.js`, `pointer-audit.js`, `jank-probe.js` (views flagged `jank`). Beyond the
  views the runner checks that popovers close four ways, the top bar keeps its boxes across states, the
  detail pane's overlay mode, branch-name copy, menu latency while git is slow, and toggles in both states.
- **Every new surface or state gets a view** in `scripts/ui-audit.mjs`, with data that really shows the
  element (the first repo with changes and its first file, a branch with stash and worktree), a `teardown`
  that puts the state back, and `menu: true` when it opens a menu. Zero findings on a view that does not show
  the element prove nothing; look at its screenshot once.

| Kind | Meaning |
|---|---|
| `collapsed` | text squeezed below 24 px while it does not fit |
| `overlap` | two texts painted over each other (painted, clipped area; an opaque layer between them is no finding) |
| `truncated`, `cut-off` | ellipsis without the full text in a tooltip, or the tooltip the pointer reaches lacks it |
| `clipped` | text cut at a side by `overflow: hidden` without an ellipsis |
| `placeholder` | a placeholder wider than its field |
| `contrast` | below 4.5:1 (3:1 for large text), measured on the blended layers that are really painted |
| `faint` | a surface that differs less than 1.025:1 from what lies beneath it |
| `cramped`, `tight`, `edge` | text touches its chip; branch segments touch their control; a floating card touches the window |
| `segment` | a branch name squeezed until its last segment shows no letter |
| `busy`, `busy-content` | an enabled control, or known text, inside `aria-busy` |
| `selection` | a selected row or card without a fill of its own and a frame |
| `naked`, `pointer` | a count or sign without a surface; a hand cursor without a tip saying what a click does |
| `tooltip` | empty, too long, repeats the label, outside the window, breaks mid-word, mixed separators, typography |
| `jank`, `jump`, `pressed`, `popover`, `latency` | list scrolling, layout shift between states, toggle look, closing, menu delay |
| `setup`, `stalled`, `exception` | the view did not reach its state, hung, or the page logged an error |

**Against the running app.** Start it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
and use any CDP client, e.g. `Cdp` from `scripts/e2e/cdp.mjs`: `Cdp.open((await Cdp.target(9333))
.webSocketDebuggerUrl)`, then `evaluate(<a script from scripts/audit/>)`, `Emulation.setDeviceMetricsOverride`
for width and scale, and the `Page` screenshot command for the picture, as `size` and `shot` in
`scripts/ui-audit.mjs` do. Probed builds expose `window.__mbfStore` (`setTheme("Light" | "Dark")`,
`setUi(…)`, `selectKey(…)`) and `window.__mbfTest` (`idle()`, `when(…)`). Synthetic OS input does not reach
the WebView, and an OS screenshot of a WebView2 window started hidden shows only its title bar: use CDP.

**E2E.** `npm run e2e` keeps a screenshot of every passed scenario in `<work>/shots/` and a report per failed
one. Never run two e2e runs at once.

**What to cover.**
1. Widths 1100 (the minimum: `minWidth` in `src-tauri/tauri.conf.json`, `MIN_WINDOW` in `src/lib/scale.ts`),
   1280, 1600; both themes; device scale 1.25, 1.5 and 2 (borders, icons and text stay sharp); interface size
   100/115/130 %.
2. States: empty, loading, failed, many entries, long names, dialog open, detail chosen, menu and tooltip
   open, an active menu entry with a hint. Both languages: longer texts break other places.
3. Look at the pictures: the audit finds what is broken, only the eye judges weight, calm and rhythm.
4. Every distinct tooltip once (`catalog` of `tooltip-audit.js`). No helper opens a single one for a photo:
   hover it over CDP (`pointerenter` at its centre) and clip the screenshot to `[role=tooltip][data-open]`.

**Audit hygiene.**
- A new rule is calibrated on a planted case that must be red; `ui-audit.mjs` plants such cases before each
  run. Why: an early layout audit skipped 0-px-wide elements as invisible and so missed the squeezed column.
- A step that opens a menu closes it again; a step with real mouse input moves the pointer to an empty corner.
  Findings that appear only in a sequence of views are state left by an earlier view: narrow with a filter.
- A finding names where it lies (tooltip, dialog, menu, `nav`, `main`), or it gets blamed on the wrong surface.
- Inline JS passed through a POSIX shell loses half its backslashes: write paths with `/`.

## Rules

### Space and budget
- **Layout budget first.** Sum the fixed widths (sidebar, detail pane, fixed columns, gaps, padding) against
  the minimum window; the rest goes to the one flexible column, which has a `min-width` of its own. If it
  does not add up, a panel narrows (`clamp()`), collapses or becomes an overlay. The calculation stands as a
  comment next to the thresholds. Fixed columns get `shrink-0`, or flexbox squeezes them and head and rows
  drift apart.
- **The overlay threshold is computed, not fixed:** sidebar + table minimum + pane > window, with the widths
  as shown. Why: a fixed breakpoint gave the table less than its minimum as soon as a panel was dragged wider.
- **Resizers: the user decides the width.** No upper cap; only the room limits it (the main area keeps 360 px,
  a diff 320 px). Shown is `min(chosen, room)`; a narrow window never overwrites the saved choice. Double click
  resets, arrow keys move. A ratio between two columns is saved in percent with one edge for all rows. A
  limit that remains states its reason in the code.
- **Toolbars stay on one line:** `flex-nowrap` and a measured budget (`bind:clientWidth`) with steps (full
  chips, then dot and count with the label in the tooltip, then icon toggles) instead of `flex-wrap`, which
  made the bar two lines high at medium widths. A separate level (scope Local/Online) gets its own tab row.
- **A state never changes a width.** Labels are the same in every state; progress lives in a status slot with
  a fixed minimum width or in a spinning icon; active and inactive tabs share one font weight; counts that
  come and go are badges over the corner; numbers use `tabular-nums`. What still changes its width stands at
  the end of its row, so nothing beside it moves. Audit `jump`.
- **Side by side means equal:** both halves of a comparison are `minmax(0, 1fr)`, long lines truncated with
  the full text in the tooltip. A marker strip scales with the content when the content is shorter than the view.
- No horizontal scroll of the page.

### Scales and tokens
- **Type:** only the scale in `@theme` of `src/app.css` (`--text-xs` 11 · `sm` 12 · `base` 13 · `lg` 15 ·
  `xl` 20) and the utilities `t-title`, `t-section`, `t-meta`; system fonts, no web fonts. An arbitrary
  `text-[12.5px]` is a finding. Why: eleven sizes, some half a pixel apart, look restless without anyone
  saying why.
- **Spacing** on a 4-px scale, smaller inside a group than between groups; radii, shadows and line heights in
  two or three steps each. Chip heights in pixels (`h-[22px]`): rem classes on a 13-px root give odd heights.
- **Colours come from tokens only** (`--bg`, `--panel`, `--panel-2`, `--fg`, `--muted`, `--faint`,
  `--accent`, the status colours and their `*-ink`, `--popover*`, `--tooltip-*`, `--id-0` to `--id-11`,
  `--diff-*`, `--syn-*`); lint rule `mbf/no-raw-color`. Themes differ only by redefining tokens under
  `:root[data-theme="dark"]`. The theme attribute is always set from the config, so a `prefers-color-scheme`
  block would be dead code.
- **Base element rules live in `@layer base`.** Unlayered rules beat every Tailwind 4 utility, and
  `outline-none` stops working. In unlayered classes set `background-color`, not `background`: the shorthand
  clears the `background-image` of `surface-glow`.
- **Live values stay live:** relative times tick, counts follow the filter, progress is visible.

### Contrast and surfaces
- **Contrast** 4.5:1 for small text, 3:1 for large (≥ 18 px, or ≥ 14 px bold), in both themes, measured on
  what is painted: the audit blends translucent layers down to the first opaque one. 4.49 fails.
- **Text on its own tint gets an ink token** (`--safe-ink` …), chosen so it keeps 4.5:1 on the tint over
  panel, zebra row and selected row. Darkening the base colour instead would also darken dots, bars and icons.
  Tinted pills mix their text towards `--fg` in `color-mix`. Fix contrast at the token, not at each place.
- **Change a surface, recompute every layer on it** (hover, active row, tiles) against the weakest text that
  can stand there. Why: lightening the menus left the hint text of an active entry below 4.5:1, and only an
  audit view with an active entry showing a hint found it.
- **One surface system:** ground `--bg`; cards `--panel` with border, radius and 12 px gap; floating layers
  `--popover`. Toolbars lie on the ground above their card; table, detail and the Git tabs are one card each.
  Why: everything on one level, separated only by 1-px lines, read as loud. Inputs are white with a strong
  border in light and sunk in dark; a light-grey field vanishes on `--panel-2`.
- **Floating layers are lighter in dark**, not only shadowed: a shadow barely shows on a dark ground.
  `.mbf-popover` sets the surface and re-points `--panel`, `--panel-2` and `--hover` inside it, so sticky
  headers, tiles and the active row follow.
- **Tables lie on `--panel`;** the zebra row `--row-alt` is a shallow step, hover and selection are clearly
  stronger, the header is opaque `--panel-2`. One separator kind per list: zebra or lines, never both; space
  between groups instead of another line. Virtual lists alternate by index, DOM lists use the `zebra` utility.
- **`surface-glow`** only on large calm surfaces (sidebar, detail head, dialog head, onboarding): it gives
  same-coloured areas a direction. Never on rows, small cards or buttons.
- **Colour only with meaning.** Filled is what asks for an action; age, a merged PR or a neutral count stay
  neutral; one colour carries one meaning in the whole app. A colour or pill whose meaning is written nowhere
  is decoration, even when it means something. Red only for danger (something is lost, or others
  are affected for good), amber for "decide consciously", neutral for information. Deleting is never green:
  pastel red for a safe delete, full red for force and server deletes.

### Controls
- **Everything clickable looks like a control:** a visible edge in `--line-strong` (`--line` is invisible on
  white) or a fill. Ghost means no fill, not no border. Nothing reveals only on hover that it can be clicked.
  Why: labels, icons and a switch without an edge were taken for text.

| Element | Recognised by |
|---|---|
| Input | sunk surface, visible border, label above, focus ring, error state (red border, reason below, `aria-invalid`) |
| Button | filled (primary, danger) or outlined (secondary, ghost); hover and pressed state; a verb as text |
| Icon button | square, with border, hover surface, always tooltip and `aria-label` |
| Toggle | on = accent border, fill and icon; size and icon unchanged (audit `pressed`) |
| Sortable column head | sort sign also at rest, hover surface |
| Clickable row | hover surface, `cursor: pointer`, selection as fill plus frame |
| Static text | neither border nor hover, never in button colours |

- **Use the kit in `src/lib/ui/`** (`Button`, `IconButton`, `Input`, `Checkbox`, `Switch`, `Segmented`,
  `FilterSegments`, `StatusChip`, `MetaChip`, `Panel`, `Modal`, `EmptyState`, `VirtualList`, `Resizer`,
  `GroupHead`, `ToolGroup`, `ViewTabs`, `Skeleton`, `Part`, `BranchName`, `PathText`, `ContextMenu` …). A raw
  `<button class="…">` in a feature component is a finding; a class string repeated three times becomes a
  component (SSOT, see software-design).
- **Counts are framed chips with a symbol** (`StatusChip`, `mbf-count`), never bare digits or glyphs: a
  tooltip explains only to someone already hovering. The symbol is the same everywhere (table, Git head, help
  legend). Audit `naked`.
- **Text keeps its distance:** at least 4 px to the side and 2 px above and below inside a pill, badge or
  button (audit `cramped`); branch segments 2 px to their control's border (`tight`).
- **Checkbox and radio:** a two-column grid; the box sits in a cell exactly one text line high, the
  description below the label on the same left edge. No `mt-0.5` nudges. A row ignores clicks that come from
  `label, button`, so ticking does not select the row.
- **Different things, different shapes.** Never three git icons in one row; a detached HEAD is a word pill,
  not a branch icon. The help legend renders the real components beside their meaning.
- **A running action shows on its trigger:** the icon spins, the label stays readable.
- **Bold only for the core of a sentence** (number, target, state); never whole sentences or labels.
- **Focus:** visible ring. Svelte does not render `autofocus`, so `showModal()` ignores it: focus the
  `data-autofocus` element after opening; a dialog without one focuses itself (`tabindex=-1`). A dangerous
  confirmation (server delete, force) never autofocuses its button: Enter must not destroy anything.
- No button inside a button: a clickable card splits into a select button and rows of their own. No
  interactive elements inside `role="option"`/`listbox` (use a grid). A disabled button takes its tooltip on a
  wrapper (`disabled` fires no pointer events), or uses `aria-disabled` when it must explain itself.
- **Comfort that is expected:** side panels collapse (`Ctrl B`, `Ctrl J`) and resize, kept in the config
  rather than `localStorage`; detail sections fold, passed ones closed by default; search debounces about
  100 ms while the field itself reacts at once.

### Truncation, paths and names
- **Nothing is cut silently.** Every ellipsis has the full text in a tooltip, shown only while the text is cut
  (`data-tip="overflow"`, `scrollWidth > clientWidth`, built lazily). The tooltip the pointer reaches first
  carries it: a button with its own tip names the cut name as its title. `aria-label` is no tooltip.
- **Placeholders fit their field**, and a search field says what it searches ("Branch, commit, author, #PR",
  "Search repos"), never just "Search"; its `aria-label` is the same text. A list that can grow long has its
  search right above it.
- **Paths go through `displayPath()` / `<PathText>`** (lint `mbf/raw-path-display`): one separator kind, `~`
  for home, line breaks only after a separator (`<wbr>`), never `break-all` (lint `mbf/no-break-all`).
  Visible as folder name (`FolderName`), the full path in the tooltip. A label that tells copies apart takes
  the shortest distinguishing part within the group of equal names, never the full path.
- **Branch names are powerline segments** (`BranchName`, `RefName`): namespace muted, prefix in its colour, the
  rest one segment truncated once at its end. Refs inside sentences are segments too (rich text via
  `RichText`); `aria-label` carries the real name and copying yields it with `/`. In tooltips a chain wraps at
  segment boundaries before it splits a word.
- **No CSS `uppercase` on headings with data:** branch, repo and folder names are case-sensitive.
- **Empty values leave no separators:** `[a, b].filter(Boolean).join(" · ")`. What can get long (upstream,
  path) gets its own line instead of a trailing "·".

### Tooltips (`use:tooltip`, `src/lib/ui/tooltip.ts`)
- **One tooltip for the whole app,** at the cursor, without a second kind: no native `title` (lint
  `mbf/no-native-title`). With `beside` it stands next to the element or a container (menus), never over what
  it explains.
- **Only when needed:** icon-only controls, collapsed elements, cut text, or something to explain. Never repeat
  the visible label (lint `mbf/tooltip-repeats-text`); when an element turns compact, its label moves into the
  tooltip head. A control with a verb label needs no "click to …"; anything else with the hand cursor says
  what a click does, and gestures (double click, drag) go into the foot (`src/lib/ui/gestures.ts`).
- **Short and structured:** head (bold title, keys right) plus about twelve words; then cards per kind of
  content, typed values (`text`, `mono`, `path`, `url`, `count`, `branch`), label column at most 40 %. Each fact
  once: what the row shows is not repeated, the path stands only in the head, related paths are relative.
  Built with `textContent`, never `innerHTML` (lint `no-restricted-properties`).
- **Light in the light theme** (raised panel, border, shadow), and **sharp:** positioned on whole device pixels
  (`Math.round(v * devicePixelRatio) / devicePixelRatio`) without `will-change: transform`, or it blurs at 125
  and 150 % while the rest stays crisp. Clamped into the window; a `ResizeObserver` re-places it when content
  grows. Expensive content is lazy (`use:tooltip={() => …}`).
- **A git action's tooltip** gives its effect in one sentence, including what does not happen, and the exact
  command (`git pull --ff-only --no-rebase`).

### Menus, popovers, dialogs
- **One menu component** (`ContextMenu`) for right click and button dropdowns. Menus about an object open with a
  tile row of the most common actions (short names, or the tile cuts them), then labelled groups, destructive
  last and red. One line per entry; the explanation goes into the tooltip. Nothing twice; only what applies now;
  a disabled entry only when its reason helps. Pick lists (filter, group by) have no tiles.
- **Keys:** ↑↓ Home End Enter Esc, `Shift F10` and the context-menu key; a popover with a search field focuses
  it on open, and the active row follows mouse and keyboard alike. Submenus open on hover with intent
  (about 120 ms open, 250 ms close, the diagonal towards them keeps them open); → opens, ← or Esc closes the
  submenu only. Tests send real key presses to the focused menu, not events to `document`.
- **Every popover closes four ways:** a press beside it (heard on the window before any element sees it, since a
  handle that stops its `pointerdown` would hide it), Esc on the window, loss of the window focus (including
  clicks on the title bar, which the backend reports), and a second press on its trigger (the menu remembers
  its trigger, solved once in `openBelow`). Scrolling beneath closes it, scrolling inside does not. Audit
  `popover`.
- **Floating panels mount at the app root** (`src/lib/ui/portal.ts`): not inside a container with
  `content-visibility` or `contain` (it becomes the containing block and clips), not on `body` (Svelte 5
  delegates events at its mount element). A panel takes the side with more room, never grows taller than it,
  and re-places when its content loads.
- **Floating cards** (toasts, runs) keep at least 20 px to the window edge (`edge`); a stack ends below the
  top bar and scrolls; two floating surfaces in one corner stack instead of covering each other. The close
  button sits inside its card.
- **About ten options or more** (insertable variables): a menu with submenus and hint lines, not a chip wall.
- **Dialogs** open near the top and grow downwards, so a tab of another height does not make the head jump;
  the head drags, a corner handle resizes, the size is kept per dialog. Confirmations stay fixed.
- The browser's own context menu is off except in inputs and selectable text.

### Lists, tables, groups
- **Every list with more than one data column is a grid** with a column model (`src/lib/table/gridModel.ts`):
  head, rows, skeleton and group rows share one `grid-template-columns`; widths live in one place;
  `scrollbar-gutter: stable`; checkbox left and actions right are fixed, exactly one column is flexible. Head:
  resize at its edge, drag to move, menu to sort, filter with counts, group, hide. `flex` with fixed `w-[…]`
  widths is a finding. Why: widths kept in three places let one column run into the next.
- **Lists that can pass ~200 rows are virtual** (`VirtualList`, fixed row height). Each row places itself by
  index (`top = index × height`), never a shared `translateY` container; `start` is clamped, `overflow-anchor:
  none`. On regroup or refresh the top row stays by key; scrolling into view happens only when the selected
  key changes. Unchanged data keeps its object identity, or a periodic tick rebuilds the list. While scrolling
  `data-scrolling` switches pointer events off and tooltips close. Proven by `jank-probe.js`, red before a fix
  and green after.
- **Groups:** one `GroupHead` with three levels (L1 own surface `--group-bg`, L2 medium, L3 small and muted);
  children render inside the head's wrapper, so folding hides every subgroup; each level indents with a guide
  line (`.mbf-guide`); nested sticky heads stack. A group reads as one block (the same neutral bar on head and
  rows). A group of one is no group: singles are collected in a last group. Grouped by X, the row does not show
  X again; a state that holds for every row is no column but a sentence at the tab; the same badge on every
  row is a subheading. Test with data that really shares the feature.
- **Diffs** have opaque tokens per theme (`--diff-*`): the gutter of a changed line stronger than the line, the
  word mark stronger still. Syntax colours are `syn-*` classes, never `{@html}`. Lines are `white-space: pre`
  and written without line breaks in the template, or its indentation shows as text.
- **One edge, one meaning:** the left edge belongs to identity (3 px), selection is fill plus frame
  (`.mbf-selected`, `.mbf-selected-card`, `.mbf-current` for the one in front). `bg-hover` as selection is a
  finding. Audit `selection`.
- **Identity:** folders, repos and groups carry a short sign and a colour (`RootBadge`, `--id-*`), the same
  wherever the object is named. Colour alone never tells things apart. In a tree, identity is one continuous
  line over the whole node, never a stroke per row, and never over icons or text.
- **Tiles** (`auto-fill minmax(300px, 1fr)`) align at the top (`items-start`) instead of stretching to the
  tallest; head with icon, title with tooltip, count and at most one open action; rows with several values
  are grids, so numbers and buttons line up.
- **No empty area beside "nothing here":** the list takes the full width, or the area says in one sentence what
  will appear there.

### Loading, motion, performance
- **Loading** (nothing there yet): a skeleton in the shape of the content, shown only after about 150 ms
  (`delayed()`), so fast answers never flash. Only the missing part carries `aria-busy`; it holds no enabled
  control and opens no context menu (audit `busy`, `busy-content`). Failed is not loading: say so, or it
  shimmers forever. A card fed by several sources splits into `Part`s that arrive on their own.
  Shimmer moves by `transform`, never `background-position`; the surface is mixed from `--fg` for both themes.
- **Refreshing** (content there, fresher coming): content stays readable and usable; a quiet shimmer and a thin
  accent strip (`.mbf-refreshing`). No dimming: dimmed reads as disabled. **Working** (an operation runs in
  this repo): visible, locked with `aria-disabled` and a tooltip naming the operation; only that repo's elements.
- **Reduced motion means `transition: none`,** not a 0.01 ms duration: with `transition-property: all` that
  animates every layout change one frame late.
- **Many events, 60 fps:** batch writes per frame (`requestAnimationFrame`, plus a timer because a hidden window
  gets no frames); `content-visibility: auto` with `contain-intrinsic-size` on long non-virtual lists;
  per-row lookups become a `$derived` map. Profile before changing; `npm run perf` holds the budgets.
- **Dragging:** pointer events, not HTML5 drag and drop (the native file drop blocks it in the WebView);
  `preventDefault` on `pointerdown`, no `dragstart`, `select-none`; the window listens from the press on. The
  gesture shows before and during: grab cursor, a label at the pointer, an insertion line or a lit target.
  Drop zones are always there, so nothing shifts when a drag starts. Handles show a short stroke at rest.
  Every drag has a menu path and an undo.

### Window and frame
- **The title bar follows the theme:** the window starts hidden, the backend sets the theme, the frontend shows
  the window after the first frame; a backend fallback shows it after a few seconds anyway. The window's
  background is the app's, so there is no white flash. No second logo inside the window. Interface size
  100/115/130 % via the WebView zoom; the minimum window grows along, never past 90 % of the screen.
- **Main views are tabs** (`ViewTabs`) anchored to the surface below, never a segment in the primary colour:
  the primary colour belongs to the main action. A window-wide mode shows its active part in the accent;
  filters inside a list stay neutral.
- **Bars are named groups** (`ToolGroup` with `aria-label`): filter ("what") and view ("how") apart; zones of a
  bar are separated by a divider, not only by space.
- **Detail pane:** state top left with the close button on the same line; actions in labelled rows; a state
  stands under the button that sets it; sections in one order for every variant (a variant leaves out, never
  reorders); one card style; one left edge. Floating over a narrow table, only the card floats, starting at
  the list, and covers no toolbar control.

## Visual check

The audit measures, this check looks. On fresh screenshots of every main view, light and dark, answer per view:
1. **Calm:** quiet surfaces, one accent per area, no colour with two meanings (view vs. action).
2. **Alignment:** columns, numbers and buttons line up across rows and tiles; equal margins and heights.
3. **Empty areas:** any surface without content or explanation? Tiles stretched without content?
4. **Help:** every area title and text-less icon has a tooltip; none repeats the visible text or runs long.
5. **Redundancy:** the same action twice side by side? Two areas showing the same number?
6. **Obvious at once:** without hovering, is it clear what each area shows (title, count, empty state as a
   sentence) and what each button does (a verb as its label)?
7. **Plausible data:** nonsense shows only in the picture ("57 years ago" from an empty timestamp, a "hash"
   that is a branch name). Fix it at the source, in the code or in the demo data.

## While building
Tokens first, then base components, then screens; the layout budget as a comment beside the column
definition; after every larger screen an audit view for it and a run at 1100 px.

## Review output
First the visual check on fresh screenshots, then a table **Finding | measured (width, theme, value,
screenshot) | proposal**, by priority: **P1** overlaps, is cut off or cannot be used at an allowed width;
**P2** grouping, inconsistency, contrast; **P3** polish. Every P1 comes with a measured value, never "looks
tight".

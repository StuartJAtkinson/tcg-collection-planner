# UX conventions

What the app actually does today, read off `index.html`. A reference, not a
queue: nothing here is a question. Anything this file claims should be checkable
by grepping for it — if a rule and the code disagree, the code is the fact and
this file is the bug.

## Tokens are declared, not typed

`index.html:53-78` is the token block, and it is the source of truth (the comment
above it says so). Every one of them is genuinely in use:

| token | what it is | uses |
|---|---|---|
| `CHIP_NEUTRAL` / `CHIP_PLUS` / `CHIP_MINUS` | pill, `rounded-full px-3 py-1 text-xs`; neutral outline / emerald tint / rose tint | 12 / 9 / 4 |
| `BTN_PRIMARY` / `BTN_SECONDARY` | filled emerald / outlined neutral, `px-3 py-1 text-xs` | 10 / 23 |
| `BTN_PRIMARY_LG` / `BTN_SECONDARY_LG` | the same pair one step up, `px-4 py-1.5 text-sm` | 2 / 2 |
| `BTN_DANGER` | filled rose, destructive only | 7 |
| `FIELD` | input/select, `rounded border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm` | 14 |
| `PANEL` | `rounded-xl border-neutral-800 bg-neutral-900/50` | 18 |
| `SUBBAR` | the second fixed row, `shrink-0 border-b-neutral-800 bg-neutral-900/60` (`:68`) | 4 |
| `NUM_LABEL` | the 10px caption, `font-semibold uppercase tracking-wide text-neutral-600` (`:73`) | 15 |
| `STEPPER` | the numeric input beside it | 4 |

Everything is dark-mode-only Tailwind neutrals: `neutral-950` is the page,
`neutral-900` a raised surface, `neutral-800` a border, `neutral-100` body text.
There is no light theme and no CSS variable layer.

## What each accent means

Colour carries meaning here; it is not decoration.

- **emerald** — on, selected, held, present. The active nav tab's underline, a
  set chip you own, a source already downloaded.
- **amber** — attention, or "not the default": a non-English language pip, a
  non-plain finish, the unresolved-import count in the nav, the grouping zone of
  the sort bar.
- **rose** — negative. `CHIP_MINUS`, `BTN_DANGER` and the error panel
  (`index.html:3069`). One hue for the whole negative surface; there is no
  `red-*` UI token (the `red-500` at `:169` is the Pokéball graphic).
- **sky** — data that is not on local disk or did not come from a vendor: the
  download plan's byte counts, fields that only exist because you imported them.
- **fuchsia** — one badge, one meaning: the app substituted something (a printed
  scan shown where there is no frame to draw).

## Type and spacing

Labels are a three-step hierarchy, all `font-semibold uppercase tracking-wide`:

| size | colour | role |
|---|---|---|
| `text-[10px]` | `neutral-600` | table column headers, stat captions — always via `NUM_LABEL` |
| `text-[11px]` | `neutral-500` | field and group labels |
| `text-xs` | `neutral-400`–`500` | section and panel titles (`Band`, `:1326`) |

One step above them and outside the uppercase run: `SectionHeader` (`:1317`) is
an `h2` at `text-lg font-semibold text-neutral-300` over a
`border-b border-neutral-800`. It is the only heading larger than `text-xs`.

Form-field labels are the exception to the uppercase rule: `NumberField`
(`:1408`) labels its inputs in sentence case at `text-sm text-neutral-400`. An
uppercase caption names a *section or column*; a sentence-case label names a
*field*.

Table rows and fields are `px-2 py-1.5`; fixed bars are `px-4 py-2`; panels and
cards are `p-4`. Gaps are `gap-2`/`gap-3`/`gap-4`, margins `mb-1`/`mb-2`/`mb-3`.
Numbers always carry `tabular-nums`, and counts abbreviate above 10,000 via
`num()` (`index.html:78`), so "107.5k" not "107,565".

## Terminology

The four routes are **Printings, Binders, Decks, Search** (`NAV`,
`index.html:3012`), plus **Config** and **io**. `io` is the route id only — its
nav item, its band and its page title all read **Import** (`:3040`, `:6910`);
nothing on screen ever says "io". A *printing* is a card as
Wizards published it; a *binder* and a *deck* are containers you own; *holdings*
are your copies. The distinction is enforced, not stylistic: the binder layout
is offered on Binders only and the deck layout on Decks only
(`VIEWS`, `index.html:3638`), because a set is a catalogue and a binder is
property, and drawing one as the other was the confusion the app was rebuilt to
remove.

Button labels are sentence case: "Open boosters", "Import a file", "Add cards",
"Clear holdings".

A data variable takes one of three routes, and each has exactly one name:
**None**, **API** (a live call, nothing stored) and **Downloaded** (a pack fetched
once). *Downloaded* replaced three names for the same thing — "On-disk" in the
schema header, "on disk" in the plan, "local" on the button — and `check.mjs`
asserts the column by it.

## Control placement

- One fixed header (`index.html:3019`), then one fixed sub-header per page, then
  the scrolling body (`Frame`, `:3083`; `<main>` is `px-6 py-5`). Both header
  rows are fixed height; the app owns the viewport and does not scroll as a
  document. Search keeps the bar even though it has nothing to select, and io
  keeps one naming the chosen file, so the second row never appears and
  disappears as you move between pages.
- A selected tab is `border-b-2 border-emerald-500 text-white`; an unselected one
  is `border-transparent` with a `hover:text-white`. Same rule for the top nav
  (`:3026`) and for Config's sub-tabs (`:7101`).
  Import and the cog (`:3040`, `:3049`) follow it too: they used to mark
  themselves with an emerald pill and ring, which put two "you are here"
  treatments in one bar and made the two least important controls the loudest
  things on it. There is one treatment now.
- An empty or placeholder box is a dashed outline, not a filled panel:
  `rounded-lg border border-dashed border-neutral-800`, centred text, a
  `text-sm text-neutral-400` line over a `text-[11px] text-neutral-600` one, and
  the actions that would fill it underneath (`:3132`).
- A destructive or reset affordance inside a dense row is bare lowercase text at
  `text-[10px]`, not a pill — `clear` on the error strip (`:3074`) and on the
  colour filter (`:3268`). Pills are for actions with room around them.
- Back sits at the **left** of a scoped page's sub-header; Close, Clear and any
  destructive button sit at the **right** on `ml-auto`.
- A selector expands over its page and collapses to the sub-header once you pick
  something; clicking the sub-header reopens it (`index.html:1282`).
- A count *badge* only appears when the count is non-zero — the amber pip on the
  nav's Import item (`:3040`) is gated on `UNRESOLVED.length`, because an empty
  badge asserts work that does not exist. The header's *stats* slot is the
  opposite and deliberately so: it always shows its number, zero included
  ("986 sets · 0% collected", "0 binders", "0 unresolved"), because a measured
  zero is the answer to the question the slot asks.

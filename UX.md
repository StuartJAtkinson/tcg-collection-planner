# UX conventions

What the app actually does today, read off `index.html`. A reference, not a
queue: nothing here is a question. Anything this file claims should be checkable
by grepping for it — if a rule and the code disagree, the code is the fact and
this file is the bug.

## Tokens are declared, not typed

`index.html:53-62` is the token block, and it is the source of truth (the comment
above it says so). Every one of them is genuinely in use:

| token | what it is | uses |
|---|---|---|
| `CHIP_NEUTRAL` / `CHIP_PLUS` / `CHIP_MINUS` | pill, `rounded-full px-3 py-1 text-xs`; neutral outline / emerald tint / rose tint | 12 / 9 / 4 |
| `BTN_PRIMARY` / `BTN_SECONDARY` | filled emerald / outlined neutral, `px-3 py-1 text-xs` | 10 / 23 |
| `BTN_PRIMARY_LG` / `BTN_SECONDARY_LG` | the same pair one step up, `px-4 py-1.5 text-sm` | 2 / 2 |
| `BTN_DANGER` | filled dark red, destructive only | 7 |
| `FIELD` | input/select, `rounded border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm` | 14 |
| `PANEL` | `rounded-xl border-neutral-800 bg-neutral-900/50` | 18 |
| `STEPPER`, `NUM_LABEL` | the numeric input and its caption (`index.html:3771`) | 4 / 4 |

Everything is dark-mode-only Tailwind neutrals: `neutral-950` is the page,
`neutral-900` a raised surface, `neutral-800` a border, `neutral-100` body text.
There is no light theme and no CSS variable layer.

## What each accent means

Colour carries meaning here; it is not decoration.

- **emerald** — on, selected, held, present. The active nav tab's underline, a
  set chip you own, a source already on disk.
- **amber** — attention, or "not the default": a non-English language pip, a
  non-plain finish, the unresolved-import count in the nav, the grouping zone of
  the sort bar.
- **rose** — negative. `CHIP_MINUS` and the error panel (`index.html:3044`).
- **sky** — data that is not on local disk or did not come from a vendor: the
  download plan's byte counts, fields that only exist because you imported them.
- **fuchsia** — one badge, one meaning: the app substituted something (a printed
  scan shown where there is no frame to draw).

## Type and spacing

Labels are a three-step hierarchy, all `font-semibold uppercase tracking-wide`:

| size | colour | role |
|---|---|---|
| `text-[10px]` | `neutral-600` | table column headers, stat captions |
| `text-[11px]` | `neutral-500` | field and group labels |
| `text-xs` | `neutral-400`–`500` | section and panel titles |

Table rows and fields are `px-2 py-1.5`; fixed bars are `px-4 py-2`; panels and
cards are `p-4`. Gaps are `gap-2`/`gap-3`/`gap-4`, margins `mb-1`/`mb-2`/`mb-3`.
Numbers always carry `tabular-nums`, and counts abbreviate above 10,000 via
`num()` (`index.html:66`), so "107.5k" not "107,565".

## Terminology

The four routes are **Printings, Binders, Decks, Search** (`NAV`,
`index.html:2993`), plus **Config** and **io**. A *printing* is a card as
Wizards published it; a *binder* and a *deck* are containers you own; *holdings*
are your copies. The distinction is enforced, not stylistic: the binder layout
is offered on Binders only and the deck layout on Decks only
(`VIEWS`, `index.html:3610`), because a set is a catalogue and a binder is
property, and drawing one as the other was the confusion the app was rebuilt to
remove.

Button labels are sentence case: "Open boosters", "Import a file", "Add cards".

## Control placement

- One fixed header (`index.html:3000`), then one fixed sub-header per page, then
  the scrolling body. Both header rows are fixed height; the app owns the
  viewport and does not scroll as a document.
- A selected tab is `border-b-2 border-emerald-500 text-white`; an unselected one
  is `border-transparent` with a `hover:text-white`. Same rule for the top nav
  and for Config's sub-tabs.
- Back sits at the **left** of a scoped page's sub-header; Close, Clear and any
  destructive button sit at the **right** on `ml-auto`.
- A selector expands over its page and collapses to the sub-header once you pick
  something; clicking the sub-header reopens it (`index.html:3177`).
- A count badge only appears when the count is non-zero — an empty badge asserts
  work that does not exist.

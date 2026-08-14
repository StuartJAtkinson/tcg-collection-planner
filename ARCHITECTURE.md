# Card Collector v2 — App Architecture

*2026-08-06 — the app-layer companion to [REDESIGN.md](REDESIGN.md).*

REDESIGN.md settled the **data**: catalogue-first Postgres, facets, containers. It said
nothing about the app, and it shows — fifteen pages each invented their own controls. This
document settles the app: **one cache, binder/deck files, one page, one control kit,
one game registry.**

No new features. Everything below is either deletion, or moving something that already
exists behind one name.

---

## 0. The governing model — split by disposability

*Added 2026-08-07.* Everything below is a consequence of one distinction:

```
  TWO SOURCES        Scryfall default_cards  ·  MTGJSON AllPrintings + AllPrices
        │ pull — importer only, never at request time
        ▼
  CACHE              everything about cards. Regenerable. Disposable.
                     cards · sets · card_facets · prices · mtg_card_printings
        │ join on the identity key
        ▼
  FILES              binder + deck files. The only thing that is actually yours.
                     identity key (set · language · collector no · finish) + qty
        │ filter + sort
        ▼
  PAGES              each one a hardcoded (game, scope) filter over that join
```

**The cache can be deleted at any time and rebuilt from the two sources. The files can
never be regenerated.** That is the whole architecture. Today both live in the same
Postgres database and nothing in the code marks which is which — `cards` and `holdings`
sit side by side, so a bad `db:push` is indistinguishable from a cache rebuild until it
has eaten the collection.

**A binder or a deck is a list of identity keys and quantities.** Not names, not oracle
text. `holdings` is already close: its PK is `(user, card_id, finish, container)` with a
`quantity` — `card_id` carries set + collector number, `finish` carries the variant. The
one thing missing is **language** — and seven of the nine import formats carry it
(`docs/import-formats.md`).

**Every page is a hardcoded filter.** Game → (set | binder | deck) → card anatomy. There
is no page that isn't that, which is why §3 collapsed to a single page.

### Files as the system of record

If binder/deck files are *literal* files rather than just rows, four things fall out for
free, and they're the things this project keeps re-deriving:

- **Export is `cp`.** The file already is the export — §5's "same map, backwards" stops
  being code.
- **Import is a file drop**, once mapped through the same alias table.
- **The collection survives the database.** Nuke Postgres, re-run the importers, reload
  the files.
- **Diffable and backup-able** by any ordinary means, git included.

The cost people expect — losing SQL joins for completion math and value rollups — doesn't
land at this scale. Keep Postgres as a **mirror**: files are written first, then loaded
into `holdings`, and the mirror is rebuildable from the files on demand. Every query in
`src/search.ts` keeps working untouched; what changes is which copy is authoritative.

> ponytail: mirror rather than migrate. Rewriting every completion/value query to scan
> files would be a week of work to make ~5,000 rows slower. Write-through to a rebuildable
> mirror is a few hundred lines and touches no existing query.

---

## 1. What's actually there today

Worth stating plainly, because it changes what needs building. **Most of the framework
already exists and isn't being used.**

| Stage | Already exists as | Problem |
|---|---|---|
| Source | `SearchScope` — 5 variants, `src/search.ts:21` | Only `/search` uses it as a *choice*; other pages hardcode their scope |
| Filter | `SearchOpts` (flat) **and** `FilterExpr` (JSONB), `src/filterExpr.ts:15` | Two filter languages that can't express each other |
| Sort | `orderFragment` + `SORT_FIELDS` **and** `SEARCH_SORT` | Two whitelists, different column expressions for the same field names, one shared `SortBar` driving both |
| Group | `BinderBuilder` | Client-side only, one page |
| View | `CardSurface` → `MockCard` / `VanillaCard` | Good. The one genuinely unified piece |
| Export | — | Does not exist |
| Config | — | Does not exist |
| Import | `/resolve` | Works; just isn't named or shaped like a stage |

Plus `chip.ts` — a real canonical pill set whose own header says *"never concatenate utility
classes onto them at the call site"* — and a `FilterSidebar` with a documented
Display → Search → Slicers → Other order. Both good. Both routinely bypassed.

So this is not "build a framework". It's **adopt the framework that's here, delete the
divergent copies, and give the stages pages.**

---

## 2. The one correction to the proposed model

> *"Every stage accepts and returns exactly the same object."*

Don't do this. If Filter and Sort each take a card list and return a card list, filtering
and sorting happen in JavaScript over materialised rows — which discards every index
REDESIGN.md's entire premise rests on: `cards(set_id, sort_key)`, `card_facets(facet,
value)`, the `pg_trgm` GIN index on `cards.name`. That's the difference between the 38ms
set page you have and one that needs pagination to survive.

**Stages compile; they do not chain.** Each stage contributes a SQL fragment and *one*
query runs. `src/search.ts` already works exactly this way — `SearchScope` picks the FROM,
filters append WHERE fragments, `orderFragment` composes the ORDER BY.

The property you actually want survives untouched: **the URL is the pipeline object**, every
stage page edits one slice of it, and the same object compiles server-side. The UI *is* a
visual editor over the pipeline the backend executes. It just doesn't cost you the database
to get there.

---

## 3. The shared schema

One new file. Three functions.

```ts
// src/pipeline.ts
export type Pipeline = {
  source: SearchScope;          // exists — src/search.ts:21
  filter: Filter;               // merge of SearchOpts + FilterExpr
  sort:   SortTerm[];           // exists — SortBar's "name.a,rarity.d" wire format
  group:  GroupSpec | null;     // exists client-side — BinderBuilder's fields + page breaks
  view:   ViewSpec;             // grid | print | binder | deck | single (+ cols/rows)
  export: ExportSpec | null;    // new
};

parse(sp: URLSearchParams): Pipeline      // URL → pipeline
toQuery(p: Pipeline): URLSearchParams     // pipeline → URL
run(p: Pipeline): Promise<Result>         // → { cards, groups, total, sql, ms }
```

`run()` wraps today's `search()`. It returns `sql` and `ms` alongside the rows — which is
why the debug panel in §6 costs about twenty lines rather than an instrumentation project.

**Every page's state is a `Pipeline`. Every page's URL is that pipeline serialised.** That
one sentence is the architecture; the rest is applying it.

---

## 4. The pages — one shape, four tabs

*Revised twice on 2026-08-07. First draft made each of config/source/filter/sort/import/
group/view/export its own route — a misreading: those are the **order of functions in a
layout**, not eight screens. Second draft split each scope into an index page and a detail
page, which gave the app two different page shapes and made the browse tabs hide their nav.
Both are superseded by the model below.*

| Surface | What it is |
|---|---|
| **Card Collector main** | the only screen without a game. Pick Magic or Pokémon; that choice locks for the session. Reached by clicking the logo. |
| **⚙ Config** | top-**right**. Sources, identity, the import/export column map, defaults, debug. The only rich page. Two columns: data on the left, behaviour on the right. |
| **Printings / Binders / Decks / Search** | **the same page.** See below. |
| **Import/Export** | one alias table, not nine parsers; the same map runs both directions. |

### One page shape, everywhere

```
┌ top bar   logo · Printings Binders Decks Import/Export Search · stats · ⚙ ┐
├ SELECTOR  expanded: the list  ─or─  collapsed: "Foundations (FDN) 281 cards ▾"
├ FILTER (sidebar) │ SORT + DISPLAY
│                  │ VIEW — results
│                  │ EXPORT
```

The four browse tabs differ in **exactly one thing**: what the selector lists. Printings
lists sets (the `scryfall.com/sets` shape — sub-sets indented via `sets.parent_code`, fixed
order by `block_code` + release date, newest first, **no search over sets**). Binders lists
binders, Decks lists decks. **Search lists nothing, because it *is* all cards.**

- Nothing picked → the selector is **expanded** and the filter/sort/view below operate on
  everything in scope.
- Pick one → it **collapses to a subheader** carrying the name and its numbers, and the
  top-bar stats swap to that thing's own.
- Click the subheader → it **reopens**. `Clear` drops back to everything.
- The selection is remembered **per tab**, so moving between tabs keeps your place.

This is what makes filter, sort and display available on *every* page, and it means the nav
tabs never have to hide to make room.

### Game is chosen once, then locked

Game and scope are **functionally filters** — the coarsest two — but neither is a
free-floating control:

- **Game** is picked on the main and then fixed. Its logo sits top-left and is the only way
  back to change it. There is no game switcher anywhere else; picking a game *resets* filter,
  sort and display rather than carrying them over (MTG's colours mean nothing in Pokémon).
- **Scope** is the tab plus its selection. The route owns the tab; the selection is state
  within it. Anything that sets scope without changing the route is inert — the router
  re-derives it on the next render.

**Nothing is preselected past the main.** No filter ticked, `sort: []`, `view: null`. A page
that arrives pre-filtered is a page lying about what you asked for. The display picker has a
genuine empty state; with no sort there is no grouping, so results render as one unheaded run.

### Card anatomy comes from the game registry

Not from the page — that is the entire "ready for another TCG" claim, and it's the thing to
assert rather than trust. MTG gets type/subtype/colours/mana value/power/toughness/rarity/
keywords; Pokémon gets type(energy)/card type/stage/HP/retreat cost/its own rarity ladder.
Sort fields differ the same way (`mana`,`colour` vs `hp`,`type`). The selector, break and the
five display types are universal.

`docs/card-anatomy.md` maps every anatomy element to how it's stored and whether it's
actually searchable. Eight of the drawn filter groups have no backend yet.

The card page reads the same registry, so a new TCG gets its card view for free — MTG shows
power/toughness/artist, Pokémon shows HP/stage/retreat cost/illustrator, from one loop over
`GAMES[g].anatomy`.

### The card page has to work before the card is known

An import is flat text — a decklist line, a typed shelf, an export from another tool. Until
that line is matched to a printing the only facts in existence are the ones in the line, so
the card page has **two states in one layout**:

| | Unmatched | Matched |
|---|---|---|
| Frame | the same frame, fed only the name | the printing, with its identity key |
| Anatomy | every field drawn, every value `—` | filled from the catalogue |
| Middle band | **candidates** — what the line could mean, each with Match | **printings** — all of them, the held one marked |
| Source line | shown verbatim with its parsed tokens | still shown, still verbatim |
| Holdings | listed | listed |
| Image slot | frame only — nothing to photograph yet | **Frame ⇄ Photo**, in place |

Nothing moves between the two states, which is what makes it legible what matching actually
bought you.

**A card's only required field is its name.** Set, number, language, finish, cost, type,
rarity, artist, art — all of it is unknown until the line is matched, and `/resolve` proves
it by drawing the frame from a scanned line before any of that exists. So every slot on the
frame degrades on its own, and degrades to *empty*, never to a default: a frame that says
"Common" because rarity was missing reads as a fact and is a lie. The draft's harness pins
this — `MockCard({ n })` must render without leaking `undefined`, `NaN`, or an invented
rarity/finish.

**The image slot is where `/preview` went.** That page existed only because nothing in the
app ever drew the frame beside the real card, so there was no way to see whether the frame
was faithful. That is a question about one card, and this is the page for one card: the two
representations share the slot and a toggle flips between them. It stops being a QA tool and
becomes what a collector actually wants — *is this the printing I'm holding?* Frame is always
available because it is drawn from what the catalogue knows; Photo needs a printing, so it is
offered only once matched. The source line is never rewritten: it is evidence, and a re-import has to be
able to reproduce the same decision. Holdings appear in both because they're the
irreplaceable half — they survive a re-import, the catalogue doesn't.

### Rows

| Where | Rows keyed by |
|---|---|
| Search, Printings, an unselected tab | card |
| **inside one binder or one deck** | **identity key** — set · language · collector number · finish · qty |

*Binders filter too.* The earlier rule was "a binder is a list, not a query" — no filter.
Built, that read as broken rather than principled, so it was reversed on 2026-08-07.

### Sort, and the break

Sort is universal and the layout interprets it. Click a field to add it (numbered), click
again to flip asc/desc, again to remove; drag to reorder. **`BREAK` is an element in that
same list** — everything left of it is the grouping, and each layout renders a break its
own way:

| Layout | A break is |
|---|---|
| grid | a new row, with the grouping as a header |
| compact / text | a rule |
| binder | a new page, headed by the grouping |
| deck | a new section |

## 5. The control kit — every control exactly once

The goal from the brief, made concrete. Left column is what's in the repo today.

| Control | Today | After |
|---|---|---|
| Game selector | **3 implementations**, 2 pages missing it entirely | `<GameTabs>` |
| Filter chips | `FilterSidebar.ChipGroup` + `ChipFormSection` + `TriStateChipGroup` | one `<ChipGroup>`, tri-state as a mode |
| Apply button | `FilterApply` (emerald filled) + `ChipFormSection`'s (neutral outline) + 4 bare `BTN_SECONDARY` submits | one `<ApplyBar>` |
| Number / range field | 3 hand-rolled (binder `pct`, binder `cols×rows`, search `cmc` min/max) | `<NumberField>` / `<RangeField>` |
| Page title | **2 styles** — 11 pages emerald-underlined `text-xl`, 3 detail pages plain `text-2xl` | `<PageShell>` |
| Breadcrumb | 5 ad-hoc formats, 6 pages have none | `PageShell` slot |
| Section header | 1 standard + 3 divergent | `<SectionHeader>` |
| Card grid | `minmax(150px)` ×3, `minmax(168px)` ×1 | `<CardGrid>` |
| Set tile | 3 copies + 2 row variants | `<SetTile>` / `<SetRow>` |
| Completion bar | 4 hand-rolled (one stacked) | `<CompletionBar>` |
| Stat block | 3 unrelated shapes | `<Stats>` |
| Empty state | 6 phrasings, 6 styles | `<Empty>` |
| Money | **4 conventions** — `.toFixed(2)`, `.toFixed(0)`, `toLocaleString`, mixed | `fmtMoney()` |
| Game name + icon | `mtg → 'Magic'` inline ×6 (2 pages read `games.name` from the DB instead); `invert` class ×6 | registry (§5) |

Every one of these is *deletion plus one import*. There is no new abstraction in this table
— `chip.ts` already proved the pattern; these are the fourteen controls that never got the
same treatment.

This closes **11 open items and both "Needs input" items** in ISSUES.md wholesale. The two
Needs-input questions resolve themselves as side effects: one canonical `<ApplyBar>` means
there's no second Apply style to choose between, and one `fmtMoney()` means the aggregate
formatting question is answered once instead of four times.

---

## 6. The game registry — the plugin seam

```ts
// src/games/mtg.ts  — one file per game, one export
export const mtg: Game = {
  id: 'mtg', name: 'Magic',
  iconClass: 'invert',                       // kills the `game === 'mtg' ? 'invert' : ''` ×6
  facets:      [...],                        // which slicers /filter offers
  sortFields:  {...},                        // the merged sort whitelist
  viewKinds:   ['grid', 'print', 'binder'],
  setBuckets:  [...],                        // was MTG_BUCKETS
  deckSetTypes:[...],                        // was MTG_DECK_TYPES
  formats:     [...],                        // was FORMATS.mtg
  importer:    importMtg,
};

// src/games/index.ts
export const registry = { mtg };
export const enabled = () => ...             // was ENABLED_GAMES
```

The app stops asking `if (game === 'mtg')` — there are **10 such branches today** — and asks
`registry.get(game).facets` instead. Deletes `ENABLED_GAMES`, `MTG_BUCKETS`,
`MTG_DECK_TYPES`, `FORMATS`, `POKEMON_AIM`, `HIDDEN_TYPES`.

**One file per game, not four.** The proposed `schema.ts` / `importer.ts` / `registry.ts` /
`facets.ts` split is the right shape for five games and pure ceremony for one. Split it when
a second game actually lands — the export shape above is what makes that a mechanical move.

Justification for building this seam now with only MTG enabled: it isn't speculative, it's
subtractive. It exists to delete 10 existing branches and 6 duplicated constants. A second
TCG becoming cheap is a side effect, not the reason.

---

## 7. Config and debug

**`/config`** — the one rich page. Bands:

| Band | Exposes | Kills |
|---|---|---|
| Games | enable/disable per game | `ENABLED_GAMES` (`src/games.ts:5`) |
| Identity | current user | `'stuart'` hardcoded in **14 places** |
| Defaults | binder threshold `60`, pockets `3×3`, search page `60`, binder cap `5000`, download cache `20h` | 5 buried constants |
| Prefs | the remembered-filter cookies | `pref_game` (live) and `pref_kind` (**dead** — `middleware.ts:9` still writes it, `/g/[game]:40` stopped reading it) |
| Registry | read-only dump of each game's contribution | — |
| Debug | the pipeline inspector | — |

Storage: a `settings` table, single row. Not env vars — the entire point is that they're
visible and editable in the UI.

**Debug** — `?debug=1` renders one band on any stage page:

```
source   {type:'set', setId:'con'}
filter   rarity=[rare]  colour=[+WU]
sort     [name.a, rarity.d]
view     grid
─────────────────────────────────────
select c.id, c.name … where c.set_id = $1
145 rows · 38ms
```

`run()` already returns `sql` and `ms`. This is a component, not a subsystem. It's also the
thing that keeps the migration honest: a page that hasn't been converted has nothing to show
in the drawer, so "which pages are actually on the pipeline" stops being a matter of trust.

---

## 8. Phases

### Phase 0 — unbreak (blocker, do first)

`npm run build` **fails right now.** Next 16 can't detect `typescript@7.0.2` (the native
port), auto-installs, then dies with `The "id" argument must be of type string`. Behind that
sit **7 real `tsc` errors**:

- 3× `CardTile` / `CardSurface` props are a lie — `MockCardSource`'s 12 required fields are
  never passed, and `CardSurface` casts `as any` internally to hide it
- `/set/[id]:177` passes a `search` prop `FilterSidebar` doesn't have → **the set page has no
  name box**, yet still filters on `?q=` (`/set/[id]:88`). A dead feature reachable only by
  hand-editing the URL. `FilterSidebar`'s own header comment documents the slot as step 2 —
  restore it
- `src/search.ts:65` reads `opts.combos`, which isn't on `SearchOpts` — dead legacy fallback
- `src/import/sets.ts:61` wrong arity (the `/value:63` unsound cast went with the page)

**Why this is phase 0 and not phase 6:** refactoring fifteen pages against a compiler that
doesn't run is how you get ISSUES.md line 5 again — the one-line `ComboSlicer` regression
that type-checking would have caught and that instead surfaced as a runtime crash. At
fifteen-page scale that's not one bug, it's a week.

### Phase 1 — schema + registry, zero visual change

`src/pipeline.ts` and `src/games/*`. Reconcile the two sort whitelists and the two filter
languages. Prove it by rewriting `/search` against the pipeline and diffing the rendered
HTML — it should be byte-identical.

### Phase 2 — shell + control kit

`<PageShell>` plus the fourteen controls in §4. Delete every divergent copy. Almost entirely
deletion; closes 13 ISSUES.md items.

### Phase 3 — the eight stage pages

Order: `source` → `filter` → `sort` → `view` → `export` → `group` → `import` → `config`.
`/import` is a rename of `/resolve` plus the shell. `/config` is last because it needs the
registry from phase 1 and the debug hook from `run()`.

### Phase 4 — fold the section pages onto the pipeline

`/set/[id]` (231 lines → ~60), `/g/[game]`, `/binders/[id]`, `/decks/[id]` become **seeds**:
they build a `Pipeline` and hand off to `/view`.

**Every page in the app is now a card query.** `/advisor` (sets ranked by dual completion)
and `/value` (a time series over holdings) were the two that weren't, and both are cut — the
focus is recording what you own, not advising on it or pricing it. That removes the standing
argument for per-caller branches in the pipeline: if a future page isn't a card query, it gets
the shell and the control kit and its own body, and the pipeline stays generic.

### Phase 5 — saved pipelines

`saved_pipelines(id, name, query)`. The URL already *is* the pipeline, so save is an INSERT
of a string and load is a redirect. ~30 lines, and only because phases 1–4 did the work.

---

## 9. Deliberately not building

- **Per-game `schema.ts`/`importer.ts`/`facets.ts`/`registry.ts`** — one `games/mtg.ts` until
  a second game exists.
- **Pipeline stages as composable node objects with a shared `run()` interface** — one
  compile step (§1). Add node objects if a stage ever needs to run *between* two queries;
  none does today.
- **A drag-the-nodes canvas editor** — URL + eight pages is the same expressive power with
  none of the client state synchronisation.
- **Export formats beyond csv / txt / json / print** — add on demand.
- **Auth / multi-user** — the Identity band in `/config` exists to delete 14 hardcoded
  `'stuart'` literals, not to introduce accounts. REDESIGN.md's "no auth in phase 1" stands.

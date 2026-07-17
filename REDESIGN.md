# Card Collector v2 — Redesign Document

*2026-07-14 — plan for a new app built alongside the current fork. Master set FIRST.*

## Why rebuild

The current app has the right pieces but the wrong spine:

1. **Inventory-first, catalogue bolted on.** The DB only knows cards you own; the master-set view has to fetch the catalogue from external APIs *at request time*. When pokemontcg.io hiccups (often), pages 500.
2. **One game baked in.** Pokémon assumptions live in the schema (`reverseHolo`, `priceType`, TCGPlayer price shapes). MTG was grafted on via adapters; every new game multiplies branches.
3. **No queryable card properties.** Cards are display blobs. "Group sets by year" or "filter by colour" means re-fetching and re-shaping API data per page — nothing is indexed.

v2 inverts this: **the catalogue is the database.** Every card ever printed sits in local tables, imported in bulk on a schedule. Your collection is a thin overlay. External APIs are touched only by the importer, never by a page load.

---

## The core question: relational vs JSON key:value

**Answer: relational — with a JSON escape hatch. PostgreSQL gives you both in one table.**

Your instinct is right that this is the crux. The reasoning:

- **Grouping and sorting are relational operations.** "Sets by release year", "cards by rarity", "completion % per set", "total value of missing cards" are `GROUP BY` / `ORDER BY` / `JOIN` queries over indexed columns. In a document store (like the current MongoDB) each of those is app code looping over blobs — which is exactly why the current app can't do any of them.
- **But cards are NOT all the same shape.** A universal core exists (see anatomy below), and it becomes real columns. The game-specific remainder (mana cost, HP, ink colour) goes in one `JSONB` column — queryable and indexable in Postgres, but never forcing a schema migration when you add a game.
- **Catalogue/inventory separation is a foreign key.** One shared immutable catalogue, per-user holdings pointing at it. Mongo pushed the current app to copy catalogue data into every owned card; that's why it drifts and can't do master sets natively.

> Rule of thumb: **if you ever want to sort, group, filter, or sum by it → column. If you only display it → JSONB.**

---

## Anatomy of a card

Not every property is universal — but the universal set is bigger than it looks, and the non-universal ones follow a pattern.

### Tier 1 — universal (real columns, every game has these)

| Property | Notes |
|---|---|
| `game` | mtg, pokemon, lorcana, … |
| `set` | code, name, release date, series/block, card count, icon |
| `collector_number` | display string, e.g. "184★" |
| `sort_key` | numeric extracted from collector_number — the binder order |
| `name` | |
| `rarity_raw` | the game's own word: "Mythic", "Rare Holo VSTAR" |
| `rarity_tier` | normalized 1–5 rank so rarity sorts cross-game |
| `image_small` / `image_large` | URL (hotlink Scryfall; cache others) |
| `finishes` | which physical variants exist: normal, foil, reverse-holo, 1st ed |
| `artist` | universal in practice |
| `prices` | per finish, USD base, timestamped (separate table — it's a time series) |

### Tier 2 — universal *concept*, game-specific *vocabulary* (the facet system)

Every TCG has a small "colour-like" classification and a "type-like" classification:

| Concept | MTG | Pokémon | Lorcana |
|---|---|---|---|
| **Aspect** (colour) | W/U/B/R/G colours + combos | Energy type (Fire, Water…) | Ink (Amber, Ruby…) |
| **Kind** (card class) | Creature / Instant / Land… | Pokémon / Trainer / Energy | Character / Song / Item |
| **Cost** | Mana value | Retreat/attack cost | Ink cost |

These become rows in a **facets table**, not columns:

```
card_facets(card_id, facet, value)
  ('abc123', 'color',       'W')
  ('abc123', 'color',       'U')
  ('abc123', 'color_combo', 'WU')      -- pre-computed, sorted → groupable
  ('abc123', 'kind',        'Creature')
```

A tiny per-game **facet registry** tells the UI which facets exist, their labels, and their sort order. Result: **"group by / sort by / filter by anything" is one generic query**, and adding a game adds registry rows, not code paths. This is the direct answer to "sorted by any property, including colour, colour combo, rarity."

### Tier 3 — game-specific detail (JSONB `attrs`, display only)

Oracle text, power/toughness, HP, attacks, weaknesses, flavour text, legalities. Shown on the card page, never grouped by. If one ever needs grouping, promote it to a facet — one importer line.

---

## Schema sketch

```sql
games    (id text pk, name text)
sets     (id text pk, game_id fk, code text, name text,
          release_date date, series text, card_count int, icon_url text)
cards    (id text pk, game_id fk, set_id fk,
          name text, collector_number text, sort_key numeric,
          rarity_raw text, rarity_tier smallint,
          image_small text, image_large text, artist text,
          finishes text[], attrs jsonb)
card_facets (card_id fk, facet text, value text)          -- + index (facet, value)
prices   (card_id fk, finish text, usd numeric, as_of date)

-- inventory overlay (single user to start; user_id column from day 1 anyway)
holdings   (id pk, user_id fk, card_id fk, finish text,
            quantity int, condition text, paid numeric, container_id fk null)
containers (id pk, user_id fk, name text, kind text,   -- binder | deck | graded | box
            pocket_layout smallint null)                -- legacy 9/12; becomes cols+rows (1-12 each) in 3b to match the binder view

-- Slot model (decided 2026-07-14): ONE SLOT PER CARD — any owned finish satisfies it, so
-- completion = distinct cards owned / cards in set, wherever the card lives (a card in a
-- deck or out for grading still counts as collected). holdings.finish records which
-- variants you own; a variant binder ("Foil Set X") is just another container made later.
-- (code still says `binders` — the rename to containers lands with phase 3)
```

- Master set page = `cards WHERE set_id = ? ORDER BY sort_key` LEFT JOIN holdings. Empty slots are just rows with no holding — free.
- Completion = one aggregate. Cost-to-complete = join missing cards to latest prices. Sets-by-year = `GROUP BY date_part('year', release_date)`. All index-backed, all fast, all offline.
- Indexes: `cards(set_id, sort_key)`, `card_facets(facet, value)`, `pg_trgm` on `cards.name` for fuzzy search. No search engine needed at this scale (~100k cards total).

---

## Data sources (importer, not runtime)

| Game | Source | Form |
|---|---|---|
| MTG | **Scryfall bulk data** (`/bulk-data`, `default_cards`) | one JSON file, refreshed daily, no key, images hotlinkable |
| Pokémon | **pokemon-tcg-data** GitHub repo (same data behind pokemontcg.io) | JSON files per set — no flaky API at all |
| Prices | Scryfall bulk (MTG); pokemontcg.io API for Pokémon prices only | nightly job appends to `prices` |
| Price history + vendor SKUs (phase 5–6) | **MTGJSON** (`AllPrices`, identifier maps) | ~90-day multi-vendor history incl. buylist (TCGplayer, Card Kingdom, Cardmarket); vendor product ids for the basket optimiser; joins to our cards on `scryfallId` |

Importer = plain TypeScript scripts run by cron/Task Scheduler (or a docker-compose one-shot). Idempotent upserts. The web app never calls an external card API.

Prices are stored native per vendor/currency (no conversions at rest); a tiny daily `fx_rates` table converts any price to any display currency at query time — one conversion function covers every vendor, GBP as the default display.

---

## Recommended stack

| Layer | Pick | Why |
|---|---|---|
| Database | **PostgreSQL 17** (Docker) | the argument above; already familiar from your homelab |
| ORM / migrations | **Drizzle** | typed SQL that stays SQL; migrations from the schema file |
| App | **Next.js 15 + TypeScript** (single full-stack app, App Router) | server components suit a read-heavy catalogue; one deployable; biggest ecosystem for the hard UI bits |
| Grid UI | plain server-rendered grid + native lazy images | group/sort/filter live in SQL, so no client table state exists; TanStack Virtual only if a monster set (SLD, ~2.5k cards) proves slow |
| Styling | Tailwind | fast, no design system to invent |
| Auth | **none in phase 1** (localhost, single user) | add Keycloak/Auth.js only if it ever leaves the homelab |
| Deploy | docker-compose: `postgres` + `app` + one-shot `importer` | fits the homelab; Traefik can front it later |

**Framework decided 2026-07-14: Next.js.** (SvelteKit was the considered alternative; the schema is the architecture, so this stays swappable in principle.)

---

## Pages (master set first)

1. **Master Sets** (home): all sets as cards with completion bars. Top-level nav: **Game → set kind → release year**. MTG kinds (revised 2026-07-15): **Core & Reprints** (core + masters/FTV/spellbook — reprint products are "kind of core again"), **Expansions**, **Crossovers** (non-Magic IPs / Universes Beyond, via `sets.crossover` — derived at import from the triangle security stamp for the 2022–24 era plus `promo_types: ['universesbeyond']` for the 2025+ UB Standard sets, which dropped the triangle), Draft & Supplemental, Secret Lair & Boxes, Promos; token/memorabilia/minigame hidden. **Deck-shaped products (commander/duel_deck/precons) are excluded here — they live on /decks.** Pokémon kinds (revised 2026-07-15) are `series` for the **main sets only**, plus one trailing **Promos** bucket — the Main-vs-Promo split mirrors MTG. pokemon-tcg-data has no set-type field, so `set_type` is derived at import from strong signals: 'promo' = Black Star Promos per era + POP/NP organized-play packs + McDonald's/Futsal/Best of Game giveaways; 'deck' = Trainer Kits and Starter Sets (boxed half-deck products → they live on /decks with MTG's precons, and get their own "Trainer kits" Collection Aim toggle on the advisor, default off like precons). Genuinely-collectible oddballs in series "Other" (Southern Islands, Legendary Collection, Rumble) stay main. Game-mode view: which sets are legal in which format — Pokémon per-set legalities from source, MTG aggregated from card legalities.
1b. **Decks** (`/decks`, added 2026-07-15): mirrors Collections for decks — and is deliberately **not game-split**: one page for all play decks with **game dividers** (the app's two primary sections are *Collections*, game-split with ownership + binder organisation, and *Decks*). Wizards' preconstructed products (set_type commander/duel_deck/planechase/archenemy/starter/arsenal/premium_deck) are the "fixed" buyable deck lists — the master reference, with completion bars and crossover badges — while the user's own decks (containers, kind='deck', imported from Collectr portfolio names; many started from a precon then modified) sit alongside as selections, each linking to a `/decks/[id]` contents page. A deck's game divider is derived from its cards' majority game, never hand-tagged. Cards in decks always still count as collected. Home page (Collections) shows the **physical count split**: x in collection binders, y in decks.
2. **Set checklist**: every card in binder order, owned lit / missing greyed with price. Filter bar restricted to the measured-universal properties: rarity, kind, colour / colour-combo (+ name search) — artist dropped 2026-07-15 (not a filter anyone browses by), format legality lives on the master-sets page. Views (reworked 2026-07-15): **Binder** (default) / Print / Grid. The binder renders as the physical book: pockets are a configurable **cols × rows** grid (each 1–12, 3×3 default), pages paired into two-page spreads with the first spread being *blank cover + Page 1*, spreads flowing 1–n per screen row (a 2×3 binder fits ~4 spreads across; a 12-wide one scrolls horizontally), pocket/card size fixed regardless of layout, and empty dashed pockets filling out the last page like a real sleeve sheet. **"Collected — For Play"** (Gatherer's all-printings concept, 2026-07-14): unowned prints get a dashed-amber "For Play" badge when any other printing sharing `cards.oracle_id` is owned — you have the card, just not this exact copy. Purely a display hint; never counts toward completion or cost-to-complete, which stay exact-print-only. mtg groups by Scryfall's true `oracle_id` (identical rules text across reprints); pokemon groups actual Pokémon cards by national Pokédex number (stable across 27 years of name-formatting drift, including multi-number Tag Team/fusion cards), falling back to normalized name only for Trainer/Energy cards, which carry no dex number.
3. **Card**: all printings across sets, holdings per finish, price history chart.
4. **Search**: name + facet filters, global across games.
5. Later: **analytics** (completion heatmaps, value over time, and the variant-density table — finishes/editions owned per set, most-first, to decide when a "Foil Set X" binder is worth making), **binder capacity advisor** (given a binder's pages × pockets, which sets fit per folder at one slot per card), **basket optimiser** (min total cost incl. shipping across sellers), **scanner** (elevated: primary intake is scan → match → holding, since the collection starts fresh with no migration), **3D/OpenGL binder view** — a folder rendered in-engine, pockets laid out spatially; cards render as standardized vector frames (MockCard's approach, proven in 3a.1: fonts + vector pips + colour identity, art as an optional lazy-loaded texture) so a 27–72-card binder page stays cheap to render and occlusion-cull, rather than a wall of raster textures. Dual/transform cards render both faces, rotated. The schema above already supports these — they're additive.

## Build order

| Phase | Deliverable | Proves |
|---|---|---|
| 1 | Postgres schema + MTG & Pokémon importers | catalogue is complete and queryable |
| 2 | Master Sets + Set checklist pages, group/sort/filter by facets | the headline feature, read-only |
| 3a | ✅ Click-to-own on the set checklist: per-finish toggle buttons write `holdings` directly via a server action; completion/cost-to-complete update live. `containers` table exists but has no UI yet (assignment is 3b). Fresh start — no migration from the old app | inventory overlay |
| 3a.1 | ✅ Bulk intake: Collectr CSV importer (`npm run import:collectr`, header-alias detection + fuzzy set matching) plus `/resolve` — a web tool that pairs each unmatched row's raw import data with ranked candidate cards, rendered as **MockCard**: a vector/font-only card face (title, cost pips, art *optional*, type line, rules text, flavor text, bottom info bar), no raster art required to render. Picking a candidate writes the holding and removes the row from the unmatched file (by position, not content — two identical scanned duplicates must resolve independently). First pass at the vector-card renderer intended for the future 3D/OpenGL binder view (`app/components/MockCard.tsx`, `cardToMockFaces.ts`) — art becomes a lazy-loaded texture layered on top of cheap, cullable vector/font geometry, not a rendering dependency | real-collection intake at scale |
| 3a.2 | ✅ Containers live (2026-07-15): holdings keyed (user, card, finish, container); Collectr Portfolio Name → container ('Main' → the `main` collection pool, everything else kind='deck'); `/decks` page (precon products + own decks); physical count split on home; MTG nav rework (Core & Reprints / Expansions / Crossovers via `sets.crossover`; precon set types moved to /decks) | decks as first-class physical locations |
| 3a.3 | ✅ `/advisor` (2026-07-15): nearest-complete-set ranking with dual completion — exact prints (emerald) vs for-play coverage (amber: any owned printing sharing `oracle_id` fills the slot), plus cost to buy only the slots no printing covers. **Collection Aim** (same day): multi-toggle of which set kinds count as collection goals — default Core & Reprints + Expansions + Crossovers; precon decks excluded by default (buyable products with few/no unique cards, like promos/draft — asides, not core collectable) but toggleable in. Display-only, like the For Play badge — real completion everywhere stays exact-print | "what should I finish next" |
| 3a.4 | ✅ Format rework (2026-07-15): binder view replaces 9/12-pocket (configurable cols×rows book spreads with cover offset, view order Binder/Print/Grid), Collections/Decks IA split in the nav, Decks page de-game-split with game dividers, `/decks/[id]` deck contents page, advisor Collection Aim, master-sets explicit none-state, artist filter dropped | the app reads like the shelf: collections and decks |
| 3a.5 | ✅ UI overhaul (2026-07-15): cover art (`sets.logo_url` — pokemon official logos, mtg highest-value-card fallback) on binder covers; nav = Search · Collections · Binders · Decks · Advisor with games as tabs under Collections; Import button + live unresolved-count badge; ⚙ settings dropdown for dev pages; Collections set view is Grid/Print only with read-only container-derived ownership; binder-book view moved to `/binders/[id]`; new `/search` and `/binders`; standardized `FilterSidebar` (Display → search → slicers → collapsible Other, sticky Apply, click-to-apply not live toggles, proper-case) on set + search pages; per-card ownership indicator strip (Σ total / set nf-f / deck nf-f / trade nf-f); holographic foil sheen (CSS `.foil`, pointer-tracked, no WebGL) on foil-owned cards | the daily-driver shape |
| 3b.1 | ✅ Unsorted-collection model + Create Binders (2026-07-15): imported "Main" pool is now the `unsorted` container ("Unsorted collection" — cards owned but not physically filed), not a fake binder. `/binders` gains: **Interpret portfolios** (reclassify each imported container deck/binder/unsorted via `setContainerKind`), and **Create Binders** — a completion frequency-analysis histogram + auto-detected "worthwhile floor" (largest owned-count gap in the lower 80%, so the top outlier doesn't dominate) + a % threshold (default 60); sets past both get a **Create binder** button (`createSetBinder` moves that set's unsorted holdings into a new `binder-<setid>` container). Verified: floor lands at ~20, 14 near-complete sets surface at 20%, the action files 91 Conflux cards then reverts cleanly | binders from the mash |
| 3b.2 | ✅ Functional-grouping binder builder (2026-07-17): `/binders/build` files the loose "rest" from Unsorted Collection. Sort fields are add/remove + drag-orderable — colour combination, rarity, type, mana value, alphabetical, set, collector number — with per-field page breaks and a live cols×rows physical-page preview. Confirmation creates the binder, persists its dimensions/rules/sparse slot positions, and moves only holdings still in the user's unsorted pool; deck cards cannot be captured. Later enrichment: an "ability colour" variable (colour from mana + ability costs + rules-text signals like "red permanent"/"for each coloured permanent", soft colours), a "types" array, and a "keyword abilities" array (incl. retro cards whose reminder-less text implies a keyword, e.g. old "can't be the target of spells" = hexproof) | organising the long tail |
| 3b.3 | Container CRUD proper (rename/delete, move individual holdings between containers, quantity/condition/paid editing) — unlocks manual ownership entry (Collections is intentionally read-only totals now) | organising what's owned |
| 4 | Card detail page, global search (pg_trgm), binder-per-container (containers get their own cols×rows and page assignment) | daily-driver complete — binder mode + print already landed in 3a.4 |
| 5 | Nightly price job + analytics | value tracking |
| 6 | Scanner (primary intake: scan → match → holding) / basket optimiser | the ambitious bits |

Phase 1–2 is a weekend-scale project because there is no auth, no writes, and no external API at runtime — just bulk JSON → Postgres → one grid component.

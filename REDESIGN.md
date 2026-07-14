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
            pocket_layout smallint null)                -- 9 or 12 for binders

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

1. **Master Sets** (home): all sets as cards with completion bars. Top-level nav: **Game → set kind → release year**. MTG kinds are curated buckets over `set_type` (Core, Expansions, then Masters / Commander / etc.; Secret Lair, promos and crossover/Universes-Beyond as asides; token/memorabilia/minigame hidden by default). Pokémon kinds are `series`. Sort by date, name, completion, value. Game-mode view: which sets are legal in which format — Pokémon per-set legalities from source (one importer line + `sets.legalities` column), MTG aggregated from card legalities. Crossover/UB flag: one importer line (Scryfall's triangle security stamp) when wanted.
2. **Set checklist**: every card in binder order, owned lit / missing greyed with price. Filter bar restricted to the measured-universal properties: rarity, kind, colour / colour-combo, artist, format legality (+ name search). Toggle: grid / 9-pocket / 12-pocket / print.
3. **Card**: all printings across sets, holdings per finish, price history chart.
4. **Search**: name + facet filters, global across games.
5. Later: **analytics** (completion heatmaps, value over time, and the variant-density table — finishes/editions owned per set, most-first, to decide when a "Foil Set X" binder is worth making), **binder capacity advisor** (given a binder's pages × pockets, which sets fit per folder at one slot per card), **basket optimiser** (min total cost incl. shipping across sellers), **scanner** (elevated: primary intake is scan → match → holding, since the collection starts fresh with no migration). The schema above already supports these — they're additive.

## Build order

| Phase | Deliverable | Proves |
|---|---|---|
| 1 | Postgres schema + MTG & Pokémon importers | catalogue is complete and queryable |
| 2 | Master Sets + Set checklist pages, group/sort/filter by facets | the headline feature, read-only |
| 3a | ✅ Click-to-own on the set checklist: per-finish toggle buttons write `holdings` directly via a server action; completion/cost-to-complete update live. `containers` table exists but has no UI yet (assignment is 3b). Fresh start — no migration from the old app | inventory overlay |
| 3b | Container CRUD (create binder/deck/graded box, move holdings into one), quantity/condition/paid editing | organising what's owned |
| 4 | Binder mode + print, card detail, search | daily-driver complete |
| 5 | Nightly price job + analytics | value tracking |
| 6 | Scanner (primary intake: scan → match → holding) / basket optimiser | the ambitious bits |

Phase 1–2 is a weekend-scale project because there is no auth, no writes, and no external API at runtime — just bulk JSON → Postgres → one grid component.

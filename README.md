# Card Collector v2

Catalogue-first TCG collection tracker. The plan lives in [REDESIGN.md](REDESIGN.md).
Phases 1–5 are live; the app is a single-user Next.js + Postgres catalogue with a
thin inventory overlay, container system, fuzzy search, and nightly price/value
analytics.

## What works

- **Postgres catalogue** (`src/db/schema.ts`) — Scryfall `default_cards` for MTG
  and the pokemon-tcg-data GitHub repo for Pokémon, both bulk-imported. The web
  app never calls an external card API at runtime; importers do, and only they.
- **Master Sets / Sets / Cards pages** — `/g/mtg` shows sets by release year with
  completion bars (Pokémon is hidden behind `ENABLED_GAMES` in `src/games.ts`
  until its import path is fully in place — catalogue data is untouched, so
  re-enabling is a one-line change); `/set/[id]` is the set checklist (Print /
  Grid views, filter bar, cost-to-complete — the physical binder-book view now
  lives per-container on `/binders/[id]`). `/card/[id]` is the Gatherer-style
  single card page (all printings, ownership per finish).
- **Containers** (`/binders`, `/decks`) — `containers` table holds binders and
  decks; the unfiled import pool lives in the `unsorted` container rather than a
  fake binder. Per-holding editor (move between containers, qty/condition/paid),
  rename/delete, create-binder from a near-complete set, functional-grouping
  binder builder, container delete.
- **Search** (`/search`) — pure facet/sort-driven search (no name text
  input — the global nav text input would duplicate the URL-driven filter
  bar). Filters: kind (tri-state, mtg + pokemon), colour combo (tri-state,
  pokemon only), mana-value range (mtg only). **Fuzzy name match** via
  `pg_trgm` (typos and partials rank results by similarity), infinite
  scroll, owned-indicators per oracle.
- **Advisor** (`/advisor`) — nearest-complete-set ranking with dual completion
  (exact prints vs for-play coverage via shared `oracle_id`), cost to fill the
  remaining slots, Collection Aim toggle for set kinds.
- **Import** (`/resolve`) — Collectr CSV → unmatched-resolver web page pairs
  each row with ranked candidate cards rendered as **MockCard** (vector/font-only
  card face, art optional). Pokémon's resolver handles the same flow.
- **Unmatched DB-backed** (`import_unmatched` table) — the lowest level of
  unsorted; re-entering Import shows the Run panel + whatever's still unresolved.
- **Nightly price job** — `npm run db:prices` streams Scryfall's `default_cards`
  JSONL, filters to card ids in the local catalogue, and upserts one row per
  `(card_id, finish, as_of=today)`. ~144k rows/run today. Re-uses the cached
  download; only re-downloads when Scryfall's `updated_at` actually moves. Run
  via cron / Windows Task Scheduler.
- **Collection value** (`/value`) — today's owned-portfolio USD total + per-game
  split + 90-day SVG sparkline from the `prices` time series. Holdings carry a
  `held_since` acquisition date (from the import CSV, or today for manual adds),
  so the series only counts a card on days you actually owned it.

## Run

```
npm install
npm run db:up        # postgres 17 in docker, localhost:5254
npm run db:push      # create/sync schema
npm run import       # ~500MB download first time, then a few minutes of inserts
npm run db:prices    # one-shot price refresh (same JSONL, only writes prices)
npm run dev          # app on http://localhost:5253
```

Ports 5253 (app) and 5254 (db) were chosen against the machine-wide registry in
`H:\GitHub\PORTS.md` — v1 card-collector owns 5252, map-merch owns 5432.
`DATABASE_URL` overrides the default `postgres://cards:cards@localhost:5254/cards`.
Re-running the import is idempotent; downloads cache in `data/` for 20h.

## Importing a Collectr export

[Collectr](https://getcollectr.com) is a mobile app for scanning/tracking a physical
card collection. To bring a Collectr collection in as holdings:

1. In the Collectr app: **Settings → Export → CSV** (this may be a Collectr+ /
   premium feature). Save the file somewhere reachable from this machine.
2. `npm run import:collectr -- path/to/export.csv`

The importer detects Collectr's column headers by alias (case-insensitive — "Card
Name", "Set", "Card Number", "Variant"/"Foil", "Condition", "Grading
Company"/"Grade", "Quantity", "Purchase Price" and close variants all match) and
prints exactly what it matched before touching the database. Cards it can't
confidently match against the local catalogue (unknown set name, ambiguous
name+set with no/bad collector number) are **not guessed** — they're staged to
the `import_unmatched` table with a reason, for manual review at `/resolve`.

Collectr's exact native CSV header text isn't publicly documented anywhere I
could verify, so if the "detected columns" printout is missing a field you know
your export has, tell me the exact header text and I'll add it as an alias —
safer than the importer silently guessing wrong.

**Quantities add on re-run** (so a second export with new cards merges
correctly) — don't run the same file twice, or clear `holdings` first if you
need a clean retry.

Real-world naming drift ("Universes Beyond: FINAL FANTASY" vs Scryfall's
"Final Fantasy", "10th Edition" vs "Tenth Edition") is handled by exact match
first, falling back to token-overlap fuzzy set matching (ordinal-word
normalization + light stemming) — verified against a real 2,796-row export at a
94.7% match rate on supported-game rows.

## Resolving unmatched rows

Open **http://localhost:5253/resolve** (also linked in the nav whenever the
`import_unmatched` table has rows). For each unresolved row it shows the raw
import data next to ranked candidate cards from the catalogue, each rendered as a
**MockCard** — a vector/font-only card face (title, mana/energy pips, art *if
available*, type line, rules text, flavor text) rather than a lookup of the
raster art, so it renders even for candidates with no cached image. Pick a
candidate (or "None of these / skip") per row and submit — resolved rows become
holdings and are removed from the unresolved pool; skipped rows stay for next
time. Rows are matched by position, not content, so two identical scanned
duplicates resolve independently.

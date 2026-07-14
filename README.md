# Card Collector v2

Catalogue-first TCG collection tracker. The plan lives in [REDESIGN.md](REDESIGN.md).

## Phase 1 — catalogue database

Postgres schema (Drizzle) + bulk importers: MTG from Scryfall bulk data, Pokémon from the
pokemon-tcg-data GitHub repo. No external API is ever called at runtime — importer only.

## Phase 2 — read-only UI (Next.js)

Master Sets (`/g/mtg`, `/g/pokemon`): Game → set kind → release year, completion bars,
format filter. Set checklist (`/set/[id]`): binder order, universal-prop filters
(rarity / kind / colour / artist / name), grid · 9-pocket · 12-pocket · print views,
cost-to-complete.

## Run

```
npm install
npm run db:up        # postgres 17 in docker, localhost:5254
npm run db:push      # create/sync schema
npm run import       # ~500MB download first time, then a few minutes of inserts
npm run verify       # sanity checks + sample queries
npm run dev          # app on http://localhost:5253
```

Ports 5253 (app) and 5254 (db) were chosen against the machine-wide registry in
`H:\GitHub\PORTS.md` — v1 card-collector owns 5252, map-merch owns 5432.
`DATABASE_URL` overrides the default `postgres://cards:cards@localhost:5254/cards`.
Re-running the import is idempotent; downloads cache in `data/` for 20h.
Pokémon prices arrive in phase 5 (nightly job) — the repo data has none.

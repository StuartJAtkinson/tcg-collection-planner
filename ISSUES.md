# Issues — Card Collector v2

## Open
- [ ] **Rename container** — inline-edit a binder/deck name on its detail page (`renameContainer` action) *(found 2026-07-18)*
- [ ] **Move holdings between containers** — per-holding control to reassign a card's container (to unsorted / any binder / any deck), quantity-merging on conflict *(found 2026-07-18)*
- [ ] **Edit holding quantity / condition / paid** — inline editing of a holding's fields where holdings are listed *(found 2026-07-18)*
- [ ] **Manual add-to-container** — add a catalogue card straight into a chosen container (unlocked by the edit path; Collections stays read-only totals) *(found 2026-07-18)*
- [ ] **Fuzzy search (pg_trgm)** — replace the ILIKE name scan with trigram similarity ranking so typos/partials rank sensibly *(found 2026-07-18)*

## Resolved
- [x] **Create binder / deck buttons** — "+ New binder" / "+ New deck" at the top of `/binders` and `/decks`; click reveals an inline name field (DeleteContainer-style popover), `createContainer` action inserts the empty container and jumps into it *(resolved 2026-07-18)*
- [x] **Hide Pokémon until MTG is in place** — single `ENABLED_GAMES = ['mtg']` flag (`src/games.ts`) applied to game tabs (`/g`), the binders/build/advisor game toggles, the decks precon query and global search; `/g/pokemon` now 404s. Catalogue data untouched — re-enable by adding 'pokemon'. Also fixed the layout Import badge to count DB `import_unmatched` (was reading dead `*-unmatched.csv`) *(resolved 2026-07-18)*
- [x] **In-app import with staged commit** — Import page now has a Source (Collectr) + file picker + Run; matches are staged to a temp batch and only written when you click Import on the locations step (binder/deck per portfolio, presumed by >100 cards), dropped if you leave. Parse/match extracted to `src/import/run.ts`, shared with the CLI *(resolved 2026-07-18)*
- [x] **Unmatched resolver DB-backed** — replaced the static `*-unmatched.csv` reader with an `import_unmatched` table (the "lowest level of unsorted"); re-entering Import shows the Run panel + whatever's still unresolved *(resolved 2026-07-18)*
- [x] **Functional-grouping binder builder** — `/binders/build` provides drag-orderable optional sort fields, per-group page breaks, configurable 1–12 × 1–12 pocket pages and a live physical preview; confirmation persists rules/layout/sparse positions and files only loose Unsorted Collection holdings *(resolved 2026-07-17)*
- [x] **Ownership sidebar redesign** — emoji, vertically-justified strip (🎴 total / set-symbol this printing / 🃏 in decks), ✨ twinkle for foils; now standard on set/card/search. Search collapses to one tile per functional card (by oracle) so multiples no longer duplicate — the sidebar shows how many you own *(resolved 2026-07-16)*
- [x] **Search infinite scroll** — extracted `searchCards` (src/search.ts) shared by page + `/api/search`; `SearchResults` client component pages 60 at a time via IntersectionObserver *(resolved 2026-07-16)*
- [x] **Single Card page** — `/card/[id]` Gatherer-style: all printings (by oracle_id) first, then MockCard + detail table + "you own" functional sidebar; card clicks everywhere now route here; extracted reusable `VanillaCard` + `OwnershipStrip` display components *(resolved 2026-07-16)*
- *(cleared 2026-07-15 — earlier resolved history lives in git log)*

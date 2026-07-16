# Issues — Card Collector v2

## Open

## Resolved
- [x] **Search infinite scroll** — extracted `searchCards` (src/search.ts) shared by page + `/api/search`; `SearchResults` client component pages 60 at a time via IntersectionObserver *(resolved 2026-07-16)*
- [x] **Single Card page** — `/card/[id]` Gatherer-style: all printings (by oracle_id) first, then MockCard + detail table + "you own" functional sidebar; card clicks everywhere now route here; extracted reusable `VanillaCard` + `OwnershipStrip` display components *(resolved 2026-07-16)*
- *(cleared 2026-07-15 — earlier resolved history lives in git log)*

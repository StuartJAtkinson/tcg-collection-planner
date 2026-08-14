# Catalogue sources — what to download, and is there an API?

Verified 2026-08-07 from the vendors themselves (`api.scryfall.com/bulk-data`,
`scryfall.com/docs/api/{images,rate-limits}`, `mtgjson.com/downloads/all-files`).

## Short answer

| | REST API? | Usable as a catalogue source? |
|---|---|---|
| **Scryfall** | **Yes** — `api.scryfall.com` | **No.** `/cards/search`, `/cards/named`, `/cards/collection` are all **2 requests/second**. Their docs are explicit: *"If you need to rapidly look up card names, prices, or resolve a large number of card images, you must use the bulk data files."* |
| **MTGJSON** | **No** — static files only | Files only, but they ship in many shapes including a ready-made Postgres dump. |

So: **bulk files for the catalogue, API only for interactive one-offs.** That's not a
limitation we're working around — it's what both vendors ask for.

One useful detail: **`*.scryfall.io` has no rate limit at all.** That's the origin for both
the bulk files and the card images, which is why hotlinking images is fine and endorsed.

## Scryfall bulk files (live sizes, 2026-08-07)

| File | Compressed | Contents |
|---|---|---|
| `oracle_cards` | 23 MB | one card per Oracle ID — no printings |
| `unique_artwork` | 36 MB | one card per distinct artwork |
| `default_cards` | **74 MB** | every card, English only |
| `all_cards` | **372 MB** | every card **in every language** ← **what we import today** |
| `rulings` | 5 MB | rulings, keyed by `oracle_id` |
| `art_tags` / `oracle_tags` | 12 / 6 MB | community Tagger tags |

> **`all_cards` is the only Scryfall file with languages.** `default_cards` is English-only.
> `src/import/mtg.ts:19` already made this switch — *"so the MTGJSON stream can cross-ref
> every printing (default_cards dropped ~9k foreign/promo entries that MTGJSON tracks)."*
> So the language data is **already being downloaded**; the gap is that `cards` has no
> `lang` column to put it in, and the binder identity key is set · **language** ·
> collector number · finish. The 372 MB is already being paid for — the column isn't.

## Which source feeds what

The importer is **MTGJSON-primary**: it streams `AllPrintings` and cross-references
Scryfall by `identifiers.scryfallId`. The schema is genuinely mixed.

| Table / columns | Scryfall | MTGJSON |
|---|---|---|
| `sets` — base | **`/sets` (live API)** | — |
| `sets` — block, parent, mtgo/arena code, foil/online-only, languages, translations | — | `AllPrintings` |
| `cards` — identity, images, artist | `all_cards` | — |
| `cards` — driver + crossover signal (`securityStamp`, `promoTypes`) | fallback | `AllPrintings` |
| `mtg_card_printings` — uuid, lang, finishes, promo types | — | `AllPrintings` |
| `prices` | `all_cards` | `AllPrices` |
| `card_facets` | derived | derived |

Note `sets` is **already** built from a live `api.scryfall.com/sets` call — the "live API"
path isn't hypothetical, it's in use for the one endpoint whose volume makes it viable
(~950 sets, paginated, well inside the 10/s limit). Switching *cards* to live would mean
~108k lookups at 2/s ≈ 15 hours, which is why the bulk file exists.

## MTGJSON

No API. But far more shapes than we use:

- **Formats**: `.json`, `.sql`, **`.psql`**, **`.sqlite`**, CSV directory, Parquet directory
  — each in bz2/gz/xz/zip. `AllPrintings.psql` is a Postgres dump, which could skip our
  importer for the catalogue entirely.
- **Subsets instead of everything**: `Standard`, `Pioneer`, `Modern`, `Legacy`, `Vintage`
  (+ their `*Atomic` variants) — a Standard-only catalogue is a fraction of AllPrintings.
- **Prices**: `AllPrices` (90-day history) vs **`AllPricesToday`** (today only). We only
  need the `prices` history (no page renders it today); the nightly job could take the small one.
- **`AllSetFiles`** — per-set files, for incremental updates after a set release.
- **`TcgplayerSkus`** — vendor SKUs, for the phase-6 basket optimiser.

## Card imagery

Sizes available per card via `image_uris`:

| Key | Dimensions | Format |
|---|---|---|
| `small` | 146 × 204 | JPG |
| `normal` | 488 × 680 | JPG |
| `large` | 672 × 936 | JPG |
| `png` | 744 × 1040 | PNG, transparent rounded corners |
| `border_crop` | 480 × 680 | JPG |
| `art_crop` | varies | JPG, art only |
| **`thumb`** | 146 × 204 | **WEBP — replaces `small`** |
| **`grid`** | 488 × 680 | **WEBP — replaces `normal`** |
| **`display`** | 672 × 936 | **WEBP — replaces `large`** |
| **`crop`** | 480 × 680 | **WEBP — replaces `border_crop`** |
| **`art`** | 626 × 457 | **WEBP — replaces `art_crop`** |

> We store `image_small`, `image_large` and `image_art_crop` — the JPG generation. Scryfall
> now documents the WebP set as replacing those. Same dimensions, smaller payload; worth
> switching, and it's an importer change plus three column values, not a schema change.

`image_status` per card is `missing` / `placeholder` / `lowres` / `highres_scan` — useful
for "don't cache art that's still low-res".

## Refresh cadence, per Scryfall's own guidance

- **Prices** update once per day. Fetching more often than 24h yields nothing new.
- **Gameplay data** (names, oracle text, mana costs) changes rarely — *"once per week or
  right after set releases would most likely be sufficient."*
- Cache anything you download for at least 24 hours.

Our importer already caches downloads for 20h (`src/import/util.ts:22`) and only
re-downloads when Scryfall's `updated_at` moves.

## Download vs stream

There is no rate-viable streaming API alternative — the bulk file has to be fetched. The
real choice is what happens to it afterwards:

- **Cache the download** (today): ~550 MB in `data/`, fast re-runs, survives a failed import.
- **Stream and discard**: pipe the gzip stream straight into Postgres and keep nothing.
  No disk cost, but every run re-downloads 372 MB + AllPrintings.

One caveat on caching `all_cards`: `buildScryfallIndex` loads it into an in-memory `Map`
(~250 MB resident) so the MTGJSON stream can look up by id. Caching the *file* doesn't
avoid that; only a keyed on-disk store would.

`src/import/prices.ts` already streams the JSONL rather than loading it into memory, so the
streaming half is done — this is purely about whether the compressed file is kept.

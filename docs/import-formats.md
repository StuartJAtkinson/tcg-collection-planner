# Collection export formats

Verified 2026-08-07. Source: **Archidekt's own client bundle** — the preset table its
importer at `archidekt.com/collections/import` uses
(`cdn.archidekt.com/_next/static/chunks/pages/_app-5035520bc5545af0.js`, the `presets`
object behind the "Use formatting from…" menu). Read in a browser at human pace; nothing
was uploaded or submitted.

## What this is, and what it isn't

Archidekt maps **by column position**, having skipped the header row. So this table gives
the exact **column order and semantic content** of each app's export — which is enough to
fingerprint a file by its column count and shape — but **not the literal header text**.

Our importer matches by header alias (`src/import/csv.ts`), which is more robust to column
reordering. The two approaches complement each other: alias-match first, and fall back to
positional fingerprinting when the headers are unfamiliar.

## Canonical fields

Archidekt's target vocabulary, which is near-identical to ours:

| Their field | Ours | UI label |
|---|---|---|
| `quantity` | `holdings.quantity` | Quantity |
| `oracleCard__name` | `cards.name` | Card name |
| `edition__editioncode` | `sets.code` | Edition code |
| `edition__editionname` | `sets.name` | Edition name |
| `collectorNumber` | `cards.collector_number` | Collector number |
| `modifier` | `holdings.finish` | Foil/Variant |
| `condition` | `holdings.condition` | Condition |
| `language` | **no column yet** — see below | Language |
| `uid` | external printing id | — |
| `tags` | `containers` (the grouping column) | — |
| `ignore` | dropped | Ignore |

> **Gap:** `language` has nowhere to live. `cards` has no `lang` column (Scryfall's
> `default_cards` is English-only); language exists only on `mtg_card_printings.lang`.
> `holdings`' PK is `(user, card_id, finish, container)`, so set + language + collector
> number is not representable today. Seven of the nine formats below carry a language
> column.

## Column order per source

`·` = ignored column.

| Source | Cols | Order |
|---|---|---|
| **Moxfield** | 13 | quantity · name · editioncode · condition · language · modifier · · · collectorNumber · · · |
| **Deckbox** | 19 | quantity · name · editionname · editioncode · collectorNumber · condition · language · modifier · · · · · · · · · tags · |
| **Dragonshield** | 12 | quantity · name · collectorNumber · editioncode · editionname · · modifier · condition · language · · · |
| **ManaBox** (single folder) | 15 | name · editioncode · editionname · collectorNumber · modifier · · quantity · · uid · · · · condition · language · |
| **ManaBox** (whole collection) | 17 | · · name · editioncode · editionname · collectorNumber · modifier · · quantity · · uid · · · · condition · language · |
| **Cardsphere** | 9 | quantity · · name · editionname · condition · language · modifier · · |
| **Delver Lens** | 5 | quantity · name · editionname · modifier · collectorNumber |
| **Helvault** | 16 | · collectorNumber · · · · · language · · name · · quantity · uid · editioncode · editionname · |
| **Lion's Eye** | 23 | name · editioncode · collectorNumber · language · quantity · · · uid · … · condition · · · tags |

Sample row Archidekt shows for Moxfield:
`2, Skip me, Sol Ring, C13, NM, EN, Normal, Skip me, Skip me, 120s, Skip me, Skip me, Skip me`

## Observations for our importer

- **Every format carries quantity + name.** Nothing else is universal.
- **Only 5 of 9 carry a collector number** (Moxfield, Deckbox, Dragonshield, ManaBox,
  Delver Lens, Helvault, Lion's Eye — Cardsphere and Delver Lens are the weak ones).
  Cardsphere has neither collector number nor edition code — name + edition *name* only,
  so it needs our fuzzy set matcher.
- **Set is identified inconsistently**: code only (Moxfield), name only (Cardsphere,
  Delver Lens), or both (Deckbox, Dragonshield, ManaBox, Helvault).
- **Only Deckbox and Lion's Eye carry a grouping column** (`tags`). Dragon Shield's
  "Folder Name" is not in Archidekt's map, so it either sits in an ignored slot or their
  preset predates it — worth checking against a real export.
- **`uid`** (ManaBox, Helvault, Lion's Eye) is the cheap win: an exact printing id, no
  matching required. Would hang off `mtg_card_printings`.

## Not covered

**Deckstats** and **Collectr** aren't in Archidekt's preset list, so nothing here is
verified for them. Collectr is already handled by `src/import/collectr.ts` via header
aliases. Deckstats remains unknown.

Moxfield, Scryfall and Deckbox all return HTTP 403 to non-browser fetchers, so their own
docs weren't reachable — this table came from Archidekt's implementation instead, which is
better evidence anyway: it's what a working importer actually does.

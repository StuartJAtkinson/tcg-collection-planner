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

Our importer matches by header alias (the alias table at the bottom of `index.html`),
which is more robust to column reordering. Header matching is the whole mechanism —
there is no positional fallback: the per-app column positions used to live in the
page, and when they went the table that documented a fallback went with them.

## Canonical fields

Archidekt's target vocabulary, which is near-identical to ours:

| Their field | Ours | UI label |
|---|---|---|
| `quantity` | per-container count | Quantity |
| `oracleCard__name` | card name | Card name |
| `edition__editioncode` | set code | Edition code |
| `edition__editionname` | set name | Edition name |
| `collectorNumber` | collector number | Collector number |
| `modifier` | finish (foil/normal) | Foil/Variant |
| `condition` | condition | Condition |
| `language` | language | Language |
| `tags` | containers (the grouping column) | — |
| `ignore` | dropped | Ignore |

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
  matching required.

## Measured against the importer, 2026-11-25

Every format's header line was put through `mapColumns` and a real row through
`readImport`, on the rebuilt 111,107-printing catalogue:

| Format | set code | number | language | finish | grouping | a row imports |
|---|---|---|---|---|---|---|
| **Moxfield** | ✓ | ✓ | ✓ | `Modifier` | — | cleanly |
| **ManaBox** | ✓ | ✓ | ✓ | `Modifier` | — | cleanly |
| **Deckbox** | ✓ | ✓ | ✓ | `Modifier` | `tags` | cleanly |
| **Dragonshield** | ✓ | ✓ | ✓ | `Modifier` | — | cleanly |
| **Helvault** | ✓ | ✓ | ✓ | — | `tags` | cleanly |
| **Lion's Eye** | ✓ | ✓ | ✓ | `Foil` | `tags` | cleanly |
| Cardsphere | — | — | ✓ | `Modifier` | — | ambiguous |
| Delver Lens | — | ✓ | — | `Modifier` | — | ambiguous |

**THE FINISH IS THE COLUMN THAT DECIDES.** Six of the nine write the finish as
**`Modifier`** — Moxfield, ManaBox, Deckbox, Dragonshield, Cardsphere, Delver Lens —
and `modifier` was not in the alias table, so those rows arrived with no finish at
all. It is invisible on a row with a collector number (the number pins the printing)
and decisive on a row without one, which is 936 of Collectr's 2,796 and a large
share of every other format: the row falls back to the name, both 8ED 256 and
8ED 256★ match, and the one thing that separates them was never read. Measured:
with the name alone, a ManaBox row is **ambiguous between 8ED/256 and 8ED/256★**;
with `Modifier` read, it is the star.

**THE `uid` IS THE ONLY EXACT KEY, AND IT IS NOT IN THE CATALOGUE'S KEY.** The
catalogue carries Scryfall's own id on every one of its 111,107 printings
(`art_id`), and it is unique — 8ED/256 and 8ED/256★ have different ids. So a `uid`
column that holds a Scryfall id would match exactly, with no name, no set-name
normalisation and no ambiguity. **It is not used today**: `resolveRow` matches on
set + number + language, and the alias table has no `uid` entry. The catalogue
does not carry `uid` in the import path either — `CANON` has no external id, and
`check.mjs` asserts that it has none, on the argument that "external ids identify
nothing this app needs — set, number and language do".

That argument was right about the id the app has and wrong about the id the
EXPORT carries: the export's `uid` is the one thing in the file that identifies a
printing outright. ManaBox, Helvault and Lion's Eye all carry it.


## Not covered

**Deckstats** and **Collectr** aren't in Archidekt's preset list, so nothing here is
verified for them. Collectr is already handled by `index.html`'s importer via header
aliases. Deckstats remains unknown.

Moxfield, Scryfall and Deckbox all return HTTP 403 to non-browser fetchers, so their own
docs weren't reachable — this table came from Archidekt's implementation instead, which is
better evidence anyway: it's what a working importer actually does.

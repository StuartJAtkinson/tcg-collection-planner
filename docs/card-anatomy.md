# Card anatomy — what a card has, and what you can actually search

Verified 2026-08-07 against `src/db/schema.ts`, `src/import/util.ts` (`mtgAttrsFor`,
`mtgFacetsFor`), `src/search.ts` and `src/sort.ts`.

## The short version

**Almost every field is already imported. Almost none of it is searchable.**

`cards.attrs` is a jsonb blob holding ~30 MTG fields — type line, subtypes, keywords,
power/toughness, loyalty, legalities, rulings, EDHREC rank, the lot. But the only
*indexed* things are three facet types and a handful of real columns:

| Layer | What's in it | Indexed? |
|---|---|---|
| `cards` columns | name, collector number, sort key, rarity tier, artist, finishes | yes |
| `card_facets` | **only** `color`, `color_combo`, `kind` | yes — `(facet, value)` |
| `cards.attrs` jsonb | everything else | **no** |

So a filter on subtype or keyword is a jsonb scan over 108k rows. That's the gap this
table is for: it separates *"we have the data"* from *"you can filter on it"*.

## The table

Legend — **Column** = real `cards` column · **Facet** = `card_facets` row, indexed ·
**attrs** = inside the jsonb blob, unindexed · **—** = not imported.

| Anatomy element | Stored as | In live search? | In the draft's filter? |
|---|---|---|---|
| Name | Column `name` | **yes** — `ilike` + pg_trgm fuzzy | yes (Name / text) |
| Oracle / rules text | attrs `oracle_text` | **yes** — `ilike`, unindexed | yes (same box) |
| Flavour text | attrs `flavor_text` | yes — `ilike`, unindexed | no |
| Type line | attrs `type_line` | yes — `ilike`, unindexed | via Type |
| **Kind** (Creature/Instant/…) | **Facet `kind`** | **yes** — tri-state include/exclude | yes (Type) |
| Supertypes (Legendary, Snow) | attrs `supertypes` | no | no |
| **Subtypes** (Human, Equipment) | attrs `subtypes` | **no** | **yes — draft only** |
| **Colour** | **Facet `color`** | via `color_combo` only | yes |
| **Colour combo** | **Facet `color_combo`** | **yes** — tri-state | yes (Exactly/Including/At most) |
| Colour identity | attrs `color_identity` | no | no — *commander decks need this* |
| Colour indicator | attrs `color_indicator` | no | no |
| Mana cost (the pips) | attrs `mana_cost` | no | no |
| **Mana value / cmc** | attrs `cmc` | **yes** — min/max, `(attrs->>'cmc')::numeric` | yes (range) |
| **Power** | attrs `power` | **no** | **yes — draft only** |
| **Toughness** | attrs `toughness` | **no** | **yes — draft only** |
| Loyalty | attrs `loyalty` | no | no |
| **Keywords** (Flying, Trample) | attrs `keywords` | **no** | **yes — draft only** |
| **Rarity** | Column `rarity_tier` (1–5) + `rarity_raw` | sort only, **no filter** | **yes — draft only** |
| Set | Column `set_id` | scope, not a filter | scope |
| Collector number | Column `collector_number` | no | sort only |
| **Language** | `mtg_card_printings.lang` | **no** | **yes — draft only** |
| **Finish** (nonfoil/foil/etched) | Column `finishes[]` | **no** | **yes — draft only** |
| Artist | Column `artist` | no | no |
| **Legalities** (Standard, Modern…) | attrs `legalities` | **no** | **yes — draft only** |
| Reserved list | attrs `is_reserved` | no | no |
| Promo types | attrs `promo_types` | no | no |
| Frame / border | attrs `frame`, `border_color` | no | no |
| Security stamp | attrs `security_stamp` | no | no |
| Rulings | attrs `rulings` | no | no |
| EDHREC rank | attrs `edhrec_rank` | no | no |
| Price | `prices.usd` | sort only | shown, not filtered |
| Owned / quantity | `holdings.quantity` | rolled up, not filtered | shown |

### Pokémon, for contrast

The same three facets carry different values — `color` is the energy type, `kind` is the
supertype (Pokémon / Trainer / Energy) — which is why the facet table is generic and the
labels come from the game registry (`src/import/pokemon.ts:26-28`).

| Anatomy element | Stored as | In the draft's filter? |
|---|---|---|
| Energy type | Facet `color` | yes (Type) |
| Card type (Pokémon/Trainer/Energy) | Facet `kind` | yes |
| Stage (Basic / 1 / 2 / V / ex) | attrs `subtypes` | yes |
| HP | attrs | yes (range) |
| Retreat cost | attrs | yes (range) |
| Attacks | attrs `attacks` | text search only |
| Legality (Standard/Expanded/Unlimited) | attrs `legalities` | yes |

## What this means

Three findings fall straight out of the table:

1. **Eight of the draft's filter groups have no backend** — subtype, power, toughness,
   keywords, rarity, language, finish, legality. They are drawn but not wired. Rarity is the odd one
   out: `rarity_tier` is a real indexed-ish column and is already sortable, so it's the
   cheapest of the seven to make real.
2. **Language is the worst gap**, because the binder identity key is set · **language** ·
   collector number · finish. The data exists in `mtg_card_printings.lang`, but `cards` has
   no `lang` column and `holdings`' PK doesn't include one. Already logged in `ISSUES.md`.
3. **Anything filterable at scale needs to become a facet or a column.** The facet table is
   already generic (`card_id, facet, value` with a `(facet, value)` index) — adding
   `subtype`, `keyword`, `rarity`, `finish` and `legality` as facet types is an importer
   change plus a backfill, not a schema change. That's the cheap path to making the drawn filters real.

Colour identity is worth calling out separately: it's imported and it's what commander deck
legality is actually built on, but nothing reads it. `color_combo` is *colours*, not colour
identity — they differ on any card with off-colour pips in its rules text.

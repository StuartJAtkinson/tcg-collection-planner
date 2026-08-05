import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
} from 'drizzle-orm/pg-core';

export const games = pgTable('games', {
  id: text('id').primaryKey(), // 'mtg', 'pokemon'
  name: text('name').notNull(),
});

export const sets = pgTable(
  'sets',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').notNull().references(() => games.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    releaseDate: date('release_date'),
    series: text('series'),
    setType: text('set_type'),
    cardCount: integer('card_count'),
    iconUrl: text('icon_url'),
    logoUrl: text('logo_url'), // set launch art: pokemon-tcg-data ships official logos; mtg has none (Scryfall has no set key-art)
    legalities: jsonb('legalities'), // {standard: 'Legal', …} — pokemon from source, mtg aggregated at import
    // non-Magic-IP crossover set (Universes Beyond etc.) — derived at import from Scryfall's
    // triangle security stamp on the set's cards, since Scryfall has no set-level UB field
    crossover: boolean('crossover').notNull().default(false),
    // MTGJSON-only enrichment fields populated by src/import/mtg.ts during the MTGJSON stream.
    // block/parent codes, MTGO/Arena shorthand aliases, online/foil-only flags, and the
    // language/translation metadata Scryfall doesn't expose at set level.
    blockCode: text('block_code'),
    parentCode: text('parent_code'),
    mtgoCode: text('mtgo_code'),
    arenaCode: text('arena_code'),
    isFoilOnly: boolean('is_foil_only'),
    isOnlineOnly: boolean('is_online_only'),
    languages: jsonb('languages'),
    translations: jsonb('translations'),
  },
  (t) => [index('sets_game_idx').on(t.gameId)],
);

export const cards = pgTable(
  'cards',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').notNull().references(() => games.id),
    setId: text('set_id').notNull().references(() => sets.id),
    name: text('name').notNull(),
    collectorNumber: text('collector_number').notNull(),
    sortKey: doublePrecision('sort_key').notNull(), // binder order
    rarityRaw: text('rarity_raw'),
    rarityTier: smallint('rarity_tier'), // 1–5, cross-game sortable
    imageSmall: text('image_small'),
    imageLarge: text('image_large'),
    imageArtCrop: text('image_art_crop'), // Scryfall art_crop: just the illustration, no frame — used for the MockCard art window and binder cover marquee so the frame doesn't bleed through transparent plates
    artist: text('artist'),
    finishes: text('finishes').array().notNull(),
    attrs: jsonb('attrs'), // tier 3: display-only, game-specific
    // groups every printing of "the same card" (Gatherer's all-printings concept): Scryfall's
    // oracle_id for mtg (identical rules text across reprints); pokemon groups by national
    // Pokédex number ("dex:6" etc, stable across name-formatting drift; "dex:6,654" for
    // multi-number fusion cards), falling back to normalized name for Trainer/Energy cards,
    // which have no dex number. Only ever drives a display hint, never completion math.
    oracleId: text('oracle_id'),
  },
  (t) => [
    index('cards_set_sort_idx').on(t.setId, t.sortKey),
    index('cards_name_idx').on(t.name),
    index('cards_oracle_idx').on(t.oracleId),
    // functional index for the exact-name candidate lookup on /resolve (lower(c.name) = ?)
    index('cards_lower_name_idx').on(sql`lower(${t.name})`),
    // pg_trgm GIN over name — backs fuzzy search (typos / partials) in src/search.ts.
    // Requires `create extension pg_trgm`; see src/db/index.ts.
    index('cards_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

export const cardFacets = pgTable(
  'card_facets',
  {
    cardId: text('card_id').notNull().references(() => cards.id),
    facet: text('facet').notNull(), // 'color' | 'color_combo' | 'kind'
    value: text('value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.facet, t.value] }),
    index('facets_facet_value_idx').on(t.facet, t.value),
  ],
);

export const prices = pgTable(
  'prices',
  {
    cardId: text('card_id').notNull().references(() => cards.id),
    finish: text('finish').notNull(),
    usd: numeric('usd', { precision: 12, scale: 2 }).notNull(),
    asOf: date('as_of').notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.finish, t.asOf] })],
);

// One row per MTGJSON uuid (MTGJSON's per-printing key). A single Scryfall card often
// corresponds to several MTGJSON printings — base, foil, promo, foreign-language — that
// share the same Scryfall `id` but differ in lang/finishes/promoTypes. The `cards` row
// stores the "primary" printing's attrs (English, nonfoil, base) while this table preserves
// every alternative printing so a future "Printings" UI can show finish/lang/promo variants
// without losing data. Populated by src/import/mtg.ts; not yet read by the app.
export const mtgCardPrintings = pgTable(
  'mtg_card_printings',
  {
    cardId: text('card_id').notNull().references(() => cards.id),
    mtgUuid: text('mtg_uuid').notNull(),
    lang: text('lang').notNull(),
    finishes: text('finishes').array().notNull(),
    promoTypes: text('promo_types').array(),
    isReserved: boolean('is_reserved'),
    frame: text('frame'),
    borderColor: text('border_color'),
    securityStamp: text('security_stamp'),
    artist: text('artist'),
    flavorText: text('flavor_text'),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.mtgUuid] }),
    index('mtg_printings_lang_idx').on(t.lang),
  ],
);

// inventory overlay — single user today, user_id column from day 1 per the plan.
// One slot per card: any owned finish satisfies completion, wherever the card physically
// lives — a card in a deck or out for grading still counts. Every holding lives in exactly
// one container ("where is it physically"); the default 'main' container is the general
// collection pool. Container kind never affects completion math, but drives the physical
// counts ("x in collection, y in decks") and the Decks page.
//
// From 2026-08-05: binders are pure filters of the non-deck collection, not containers
// that own holdings rows. A binder's contents are computed live from `filter jsonb`
// (`{set_ids, rarities, color_combos, cmcs}` array shape; compiled to SQL via
// src/filterExpr.ts). sort_config persists the binder's display order across pages.
//
// Deck containers gain `deck_source` ('manual'|'sealed'|'scratch') and an optional
// `source_sealed_id` FK to sealed_products (populated when an MTGJSON AllDeckFiles
// ingest lands).
export const containers = pgTable('containers', {
  id: text('id').primaryKey(), // slug, e.g. 'main', 'jeskaimonks' — text so imports are idempotent
  userId: text('user_id').notNull().default('stuart'),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('binder'), // collection | binder | deck | graded | box
  pocketLayout: smallint('pocket_layout'), // 9 or 12, binders only
  pocketCols: smallint('pocket_cols'),
  pocketRows: smallint('pocket_rows'),
  sortConfig: jsonb('sort_config'),
  // Binder: structured query (set_ids / rarities / color_combos / cmcs); null for non-binders.
  filter: jsonb('filter'),
  // Deck: how the deck was created. NULL on binders / collection / graded / box.
  deckSource: text('deck_source'),
  // Deck: optional FK to sealed_products when created from an MTGJSON sealed-product.
  sourceSealedId: text('source_sealed_id'),
});

// Sealed products (MTG theme decks / precons / starters / commander decks). Schema mirrors
// the MTGJSON Deck/SealedProduct data models; the populated payload lands via a future
// AllDeckFiles.tar.gz ingest (src/import/mtgDecks.ts, deferred). For v1 the table is
// empty and decks created via the "from sealed product" path populate themselves by
// pulling every card with set_id = set.id, then write holdings rows + deck_source='sealed'.
export const sealedProducts = pgTable('sealed_products', {
  id: text('id').primaryKey(), // MTGJSON sealedProduct uuid
  setId: text('set_id').references(() => sets.id),
  setCode: text('set_code').notNull(),
  name: text('name').notNull(),
  type: text('type'), // 'theme' | 'precon' | 'deck_of_the_day' | …
  releaseDate: date('release_date'),
  mainBoard: jsonb('main_board'),
  sideBoard: jsonb('side_board'),
  commander: jsonb('commander'),
  tokens: jsonb('tokens'),
  sealedProductUuids: text('sealed_product_uuids').array(),
  raw: jsonb('raw'),
});

// The "lowest level of unsorted": rows a Collectr import couldn't confidently place. Persisted
// (not a transient file) so re-entering the Import page always shows what's still unresolved.
// `fields` holds the parsed Collectr columns (name/set/number/variant/portfolio/…) needed to
// re-search the catalogue and, once a human picks the right card, write the holding.
export const importUnmatched = pgTable('import_unmatched', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: text('user_id').notNull().default('stuart'),
  fields: jsonb('fields').notNull(),
  reason: text('reason'),
});

export const holdings = pgTable(
  'holdings',
  {
    userId: text('user_id').notNull().default('stuart'),
    cardId: text('card_id').notNull().references(() => cards.id),
    finish: text('finish').notNull().default('normal'),
    containerId: text('container_id').notNull().default('main').references(() => containers.id),
    quantity: integer('quantity').notNull().default(1),
    condition: text('condition'),
    grade: text('grade'), // e.g. "PSA 10" — distinct from condition (raw NM/LP/…), set once slabbed
    paid: numeric('paid', { precision: 12, scale: 2 }),
    binderPosition: integer('binder_position'),
    // When did this slot show up? Defaults to NULL ("unknown / since the dawn of time") so
    // existing imports don't need a backfill; new entries use now(). The /value sparkline gates
    // each day on h.held_since <= p.as_of so a card acquired today doesn't pretend it was in
    // the collection last year. Nullable so older Collectr exports without a dateAdded column
    // aren't rejected; treat NULL as 'assume always owned' when filtering.
    heldSince: date('held_since'),
  },
  (t) => [
    // one row per (card, finish, container): the same physical printing can sit in the main
    // pool AND in a deck as separate copies; quantity absorbs duplicates within one place
    primaryKey({ columns: [t.userId, t.cardId, t.finish, t.containerId] }),
  ],
);

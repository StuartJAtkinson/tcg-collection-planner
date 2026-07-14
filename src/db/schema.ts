import {
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
    legalities: jsonb('legalities'), // {standard: 'Legal', …} — pokemon from source, mtg aggregated at import
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
    artist: text('artist'),
    finishes: text('finishes').array().notNull(),
    attrs: jsonb('attrs'), // tier 3: display-only, game-specific
  },
  (t) => [index('cards_set_sort_idx').on(t.setId, t.sortKey), index('cards_name_idx').on(t.name)],
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

// inventory overlay — single user today, user_id column from day 1 per the plan.
// One slot per card: any owned finish satisfies completion, wherever the card physically
// lives — a card in a deck or out for grading still counts. containerId is just "where is
// it right now" (null = general collection pool); it never affects completion math.
export const containers = pgTable('containers', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('user_id').notNull().default('stuart'),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('binder'), // binder | deck | graded | box
  pocketLayout: smallint('pocket_layout'), // 9 or 12, binders only
});

export const holdings = pgTable(
  'holdings',
  {
    userId: text('user_id').notNull().default('stuart'),
    cardId: text('card_id').notNull().references(() => cards.id),
    finish: text('finish').notNull().default('normal'),
    quantity: integer('quantity').notNull().default(1),
    condition: text('condition'),
    paid: numeric('paid', { precision: 12, scale: 2 }),
    containerId: integer('container_id').references(() => containers.id),
  },
  (t) => [
    // one row per (card, finish): "own it" toggles this row, quantity absorbs duplicates
    primaryKey({ columns: [t.userId, t.cardId, t.finish] }),
  ],
);

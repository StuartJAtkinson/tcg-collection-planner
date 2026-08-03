// Which games are surfaced in the UI. Pokémon is hidden until its import path is fully in
// place — flip it back by adding 'pokemon' here; the catalogue data stays untouched in the DB.
// ponytail: one constant, applied wherever both games are enumerated (game tabs, toggles,
// cross-game list queries). Nothing is deleted, so re-enabling is a one-line change.
export const ENABLED_GAMES: string[] = ['mtg'];

// MTG deck-shaped set types (precon products). Shared between /g/mtg's hidden filter and
// /advisor's "precons" bucket and /decks' precon section. Mutable (not `as const`) because
// values flow into postgres.js tagged-template query interpolation, which needs plain arrays.
export const MTG_DECK_TYPES: string[] = [
  'commander', 'duel_deck', 'planechase', 'archenemy', 'starter', 'arsenal', 'premium_deck',
];

// MTG "Collection Aim" / nav-bucket taxonomy. The advisor's last bucket ('precons') is
// flagged in the consumer — g/[game] ignores that key, advisor renders it as the last
// option. Crossovers is filtered by sets.crossover, not set_type, so its list is empty.
// ponytail: shared so /advisor and /g/mtg can't drift on the six core bucket labels.
export type MtgBucket = [string, string, string[]];
export const MTG_BUCKETS: MtgBucket[] = [
  ['core', 'Core & Reprints', ['core', 'masters', 'from_the_vault', 'spellbook', 'masterpiece']],
  ['expansions', 'Expansions', ['expansion']],
  ['crossovers', 'Crossovers', []],
  ['draft', 'Draft & Supplemental', ['draft_innovation', 'eternal', 'funny']],
  ['boxes', 'Secret Lair & Boxes', ['box']],
  ['promos', 'Promos', ['promo']],
  ['precons', 'Precon decks', MTG_DECK_TYPES],
];

// Which games are surfaced in the UI. Pokémon is hidden until its import path is fully in
// place — flip it back by adding 'pokemon' here; the catalogue data stays untouched in the DB.
// ponytail: one constant, applied wherever both games are enumerated (game tabs, toggles,
// cross-game list queries). Nothing is deleted, so re-enabling is a one-line change.
export const ENABLED_GAMES = ['mtg'];

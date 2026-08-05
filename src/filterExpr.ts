// JSON binder filter → SQL fragment compiler. One filter shape lives in
// `containers.filter jsonb` (see migration 2026_08_05_*):
//   { set_ids?: string[], rarities?: string[], color_combos?: string[], cmcs?: string[] }
// Empty arrays are no-ops; missing keys are no-ops. All four fields intersect (AND).
//
// `filterFragment(filter, tableAlias)` returns a postgres.js fragment that callers
// splice into a WHERE clause. Reuses the same `card_facets` table the global search uses
// for color_combo so the binders and search page agree on the colour taxonomy.
//
// `binderOverlap()` sorts binders smallest-first so the narrowest filter "wins" any
// potential materialisation. Display-only today (the binder page reads its own filter
// and never walks others); kept here as the future materialisation hook.
import { client } from './db/index.ts';

export type FilterExpr = {
  set_ids?: string[];
  rarities?: string[];
  color_combos?: string[];
  cmcs?: string[];
};

const none = client``;

export function filterFragment(f: FilterExpr | null | undefined, alias = 'c') {
  const c = client.unsafe(alias);
  const frags: any[] = [];
  const sets = f?.set_ids ?? [];
  if (sets.length) frags.push(client`${c}.set_id = any(${sets})`);
  const rarities = f?.rarities ?? [];
  if (rarities.length) frags.push(client`${c}.rarity_raw = any(${rarities})`);
  const combos = f?.color_combos ?? [];
  if (combos.length) {
    frags.push(client`exists (
      select 1 from card_facets f
      where f.card_id = ${c}.id and f.facet = 'color_combo' and f.value = any(${combos})
    )`);
  }
  const cmcs = f?.cmcs ?? [];
  if (cmcs.length) frags.push(client`${c}.attrs->>'cmc' = any(${cmcs})`);
  return frags.length
    ? frags.reduce((acc, x) => client`(${acc}) and (${x})`)
    : none;
}

// Smallest binder first; ties broken by name. Display order only — materialisation
// would join the filtered card sets and assign each card to the first binder that
// contains it, but we don't do that today.
export function binderOverlap<T extends { filter: FilterExpr | null; name: string }>(binders: T[]): T[] {
  const score = (b: T) => {
    const f = b.filter ?? {};
    return (f.set_ids?.length ?? 0)
      + (f.rarities?.length ?? 0)
      + (f.color_combos?.length ?? 0)
      + (f.cmcs?.length ?? 0);
  };
  return [...binders].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

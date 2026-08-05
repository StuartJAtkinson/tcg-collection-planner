// "name.a,rarity.d" → ORDER BY fragment, in precedence order. Returns null (or the
// caller-supplied fallback) when nothing valid, so callers keep their own default ordering.
// Field keys come only from the caller-supplied whitelist — never raw user text — so the
// composed ORDER BY is injection-safe. `color` typically requires a left join card_facets
// in the caller's query.
import { client } from './db/index.ts';

// Whitelist shared by the binder, deck, and set list pages (all read the same SortBar
// fields). `mv` and `price` are nullable in queries that don't pull prices or cmc.
export const SORT_FIELDS: Record<string, string> = {
  name: 'c.name',
  set: 's.release_date',
  number: 'c.sort_key',
  rarity: 'c.rarity_tier',
  mv: "(c.attrs->>'cmc')::numeric",
  // C/W/U/B/R/G primary colours first, then 2-colour combos in WUBRG order, then 3-colour
  // combos, etc. Lex sort of `translate` alone puts 'WU' (='23') between 'W' and 'U' — a
  // length-prefix fixes that: shorter combos come first, inner ordering preserved.
  color: "lpad(length(cc.value)::text, 2, '0') || translate(cc.value, 'CWUBRG', '123456')",
  price: 'p.usd',
};

export function orderFragment(
  fields: Record<string, string>,
  raw?: string | null,
  fallback?: any,
) {
  const terms = (raw ?? '')
    .split(',')
    .map((t) => t.split('.'))
    .filter(([f]) => f in fields) as [string, string][];
  if (!terms.length) return fallback ?? null;
  return terms.reduce(
    (acc, [f, d], i) => {
      const col = client`${client.unsafe(fields[f])} ${client.unsafe(d === 'd' ? 'desc nulls last' : 'asc nulls last')}`;
      return i === 0 ? col : client`${acc}, ${col}`;
    },
    client``,
  );
}

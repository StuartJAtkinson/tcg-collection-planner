import { client } from './db/index.ts';

// Main sortable properties → SQL expression. Field keys come only from this whitelist (never
// raw user text), so composing the ORDER BY fragment below is injection-safe.
export const SORT_FIELDS = {
  name: client`c.name`,
  set: client`s.release_date`,
  number: client`c.sort_key`,
  rarity: client`c.rarity_tier`,
  mv: client`(c.attrs->>'cmc')::numeric`,
  color: client`cc.value`,
  price: client`p.usd`, // only the set page exposes this chip + has the `p` price lateral
} as const;

// "name.a,rarity.d" → ORDER BY fragment, in precedence order. null when nothing valid,
// so callers keep their own default ordering. Requires a `left join card_facets cc … color_combo`
// in the query when the `color` field is used (present in both consumers).
export function orderFragment(raw?: string) {
  const terms = (raw ?? '')
    .split(',')
    .map((t) => t.split('.'))
    .filter(([f]) => f in SORT_FIELDS) as [keyof typeof SORT_FIELDS, string][];
  if (!terms.length) return null;
  return terms.reduce(
    (acc, [f, d], i) => {
      const col = client`${SORT_FIELDS[f]} ${client.unsafe(d === 'd' ? 'desc nulls last' : 'asc nulls last')}`;
      return i === 0 ? col : client`${acc}, ${col}`;
    },
    client``,
  );
}

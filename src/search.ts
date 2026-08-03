import { client } from './db/index.ts';
import { ENABLED_GAMES } from './games.ts';
import { holdCte } from './ownership.ts';
import { orderFragment } from './sort.ts';

export type SearchParams = {
  q?: string; game?: string; kind?: string;
  combos?: string[]; cmcs?: string[];
  sort?: string; offset?: number; limit?: number;
};

// Search-result columns exposed by the inner query below; same field names the shared
// SortBar emits. Whitelist keeps the composed ORDER BY injection-safe.
const SEARCH_SORT: Record<string, string> = {
  name: 'sort_name', set: 'release_date', number: 'sort_key',
  rarity: 'rarity_tier', mv: 'cmc_num', color: 'color_combo', price: 'usd',
};
// default: owned first, then A–Z. When there's a fuzzy query, similarity to the query takes
// priority so "lightning bollt" floats "Lightning Bolt" above alphabetical noise — but only
// when the user hasn't picked an explicit sort.
const SEARCH_DEFAULT = client`(func_total > 0) desc, sort_name`;

export type SearchCard = {
  id: string; name: string; image_small: string | null; set_code: string;
  owned: boolean; game_id: string; set_icon_url: string | null;
  // representative printing's own copies (an owned printing when you have one)
  set_nonfoil: number; set_foil: number;
  // oracle-level ownership rollup, for the at-a-glance sidebar
  func_total: number; deck_nonfoil: number; deck_foil: number; any_foil: boolean;
  usd: number | null;
};

// Shared global-search query, used by the Search page (initial render) and /api/search
// (infinite-scroll paging). Blank text with any scope browses the whole cohort.
//
// Results are collapsed to one tile per functional card (Gatherer-style): every printing
// shares an oracle identity, so "Lightning Bolt" appears once no matter how many printings you
// own. The representative printing is an owned one (newest) if you have any, else the newest.
// The ownership sidebar carries the how-many-you-own detail, aggregated across the group.
export async function searchCards(p: SearchParams): Promise<SearchCard[]> {
  const q = (p.q ?? '').trim();
  const like = '%' + q + '%';
  const combos = p.combos ?? [];
  const cmcs = p.cmcs ?? [];
  const limit = p.limit ?? 60;
  const offset = p.offset ?? 0;
  return (await client`
    with ${holdCte},
      grp as ( -- oracle-level rollup (falls back to the card id when there's no oracle identity)
        select coalesce(c.oracle_id, c.id) as gid,
               sum(coalesce(hd.total, 0))::int as func_total,
               sum(coalesce(hd.deck_nonfoil, 0))::int as deck_nonfoil,
               sum(coalesce(hd.deck_foil, 0))::int as deck_foil,
               bool_or(coalesce(hd.set_foil, 0) > 0) as any_foil
        from cards c left join hold hd on hd.card_id = c.id
        group by 1
      )
    select id, name, image_small, set_code, game_id, set_icon_url,
           func_total > 0 as owned, set_nonfoil, set_foil,
           func_total, deck_nonfoil, deck_foil, any_foil, usd
    from (
      select distinct on (coalesce(c.oracle_id, c.id))
             c.id, c.name, c.image_small, s.code as set_code, c.game_id, s.icon_url as set_icon_url,
             coalesce(hd.set_nonfoil, 0) as set_nonfoil, coalesce(hd.set_foil, 0) as set_foil,
             g.func_total, g.deck_nonfoil, g.deck_foil, g.any_foil, c.name as sort_name,
             c.sort_key, c.rarity_tier, s.release_date, (c.attrs->>'cmc')::numeric as cmc_num,
             cc.value as color_combo, p.usd::float as usd
      from cards c
      join sets s on s.id = c.set_id
      join grp g on g.gid = coalesce(c.oracle_id, c.id)
      left join hold hd on hd.card_id = c.id
      left join card_facets cc on cc.card_id = c.id and cc.facet = 'color_combo'
      left join lateral (
        select usd from prices p where p.card_id = c.id
        order by (p.finish = 'nonfoil') desc, p.as_of desc limit 1
      ) p on true
      where true
      ${q ? client`and (
        c.name % ${q}
        or c.name ilike ${like}
        or coalesce(c.attrs->>'oracle_text', '') ilike ${like}
        or coalesce(c.attrs->>'flavor_text', '') ilike ${like}
        or coalesce(c.attrs->>'type_line', '') ilike ${like}
        or coalesce(c.attrs->'attacks', '[]'::jsonb)::text ilike ${like}
        or coalesce(c.attrs->'rules', '[]'::jsonb)::text ilike ${like}
      )` : client``}
      and c.game_id = any(${ENABLED_GAMES})
      ${p.game ? client`and c.game_id = ${p.game}` : client``}
      ${p.kind ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'kind' and f.value = ${p.kind})` : client``}
      ${combos.length ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'color_combo' and f.value = any(${combos}))` : client``}
      ${cmcs.length ? client`and c.attrs->>'cmc' = any(${cmcs})` : client``}
      order by coalesce(c.oracle_id, c.id), (hd.card_id is not null) desc, s.release_date desc nulls last
    ) reps
    order by ${orderFragment(SEARCH_SORT, p.sort, q ? client`similarity(name, ${q}) desc, (func_total > 0) desc, sort_name` : SEARCH_DEFAULT)}
    limit ${limit} offset ${offset}`) as unknown as SearchCard[];
}

import { client } from './db/index.ts';

export type SearchParams = {
  q?: string; game?: string; kind?: string;
  combos?: string[]; cmcs?: string[];
  offset?: number; limit?: number;
};

export type SearchCard = {
  id: string; name: string; image_small: string | null; set_code: string;
  owned: boolean; game_id: string; set_icon_url: string | null;
  // representative printing's own copies (an owned printing when you have one)
  set_nonfoil: number; set_foil: number;
  // oracle-level ownership rollup, for the at-a-glance sidebar
  func_total: number; deck_nonfoil: number; deck_foil: number; any_foil: boolean;
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
    with hold as (
      select h.card_id,
             sum(case when h.finish in ('normal','nonfoil') then h.quantity else 0 end)::int as set_nonfoil,
             sum(case when h.finish not in ('normal','nonfoil') then h.quantity else 0 end)::int as set_foil,
             sum(h.quantity)::int as total,
             sum(case when ct.kind = 'deck' and h.finish in ('normal','nonfoil') then h.quantity else 0 end)::int as deck_nonfoil,
             sum(case when ct.kind = 'deck' and h.finish not in ('normal','nonfoil') then h.quantity else 0 end)::int as deck_foil
      from holdings h join containers ct on ct.id = h.container_id
      group by h.card_id
    ),
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
           func_total, deck_nonfoil, deck_foil, any_foil
    from (
      select distinct on (coalesce(c.oracle_id, c.id))
             c.id, c.name, c.image_small, s.code as set_code, c.game_id, s.icon_url as set_icon_url,
             coalesce(hd.set_nonfoil, 0) as set_nonfoil, coalesce(hd.set_foil, 0) as set_foil,
             g.func_total, g.deck_nonfoil, g.deck_foil, g.any_foil, c.name as sort_name
      from cards c
      join sets s on s.id = c.set_id
      join grp g on g.gid = coalesce(c.oracle_id, c.id)
      left join hold hd on hd.card_id = c.id
      where true
      ${q ? client`and (
        c.name ilike ${like}
        or coalesce(c.attrs->>'oracle_text', '') ilike ${like}
        or coalesce(c.attrs->>'flavor_text', '') ilike ${like}
        or coalesce(c.attrs->>'type_line', '') ilike ${like}
        or coalesce(c.attrs->'attacks', '[]'::jsonb)::text ilike ${like}
        or coalesce(c.attrs->'rules', '[]'::jsonb)::text ilike ${like}
      )` : client``}
      ${p.game ? client`and c.game_id = ${p.game}` : client``}
      ${p.kind ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'kind' and f.value = ${p.kind})` : client``}
      ${combos.length ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'color_combo' and f.value = any(${combos}))` : client``}
      ${cmcs.length ? client`and c.attrs->>'cmc' = any(${cmcs})` : client``}
      order by coalesce(c.oracle_id, c.id), (hd.card_id is not null) desc, s.release_date desc nulls last
    ) reps
    order by (func_total > 0) desc, sort_name
    limit ${limit} offset ${offset}`) as unknown as SearchCard[];
}

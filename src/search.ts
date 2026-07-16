import { client } from './db/index.ts';

export type SearchParams = {
  q?: string; game?: string; kind?: string;
  combos?: string[]; cmcs?: string[];
  offset?: number; limit?: number;
};

export type SearchCard = {
  id: string; name: string; image_small: string | null;
  set_code: string; owned: boolean;
};

// Shared global-search query, used by the Search page (initial render) and /api/search
// (infinite-scroll paging). Blank text with any scope browses the whole cohort.
export async function searchCards(p: SearchParams): Promise<SearchCard[]> {
  const q = (p.q ?? '').trim();
  const like = '%' + q + '%';
  const combos = p.combos ?? [];
  const cmcs = p.cmcs ?? [];
  const limit = p.limit ?? 60;
  const offset = p.offset ?? 0;
  return (await client`
    select c.id, c.name, c.image_small, s.code as set_code, (own.card_id is not null) as owned
    from cards c
    join sets s on s.id = c.set_id
    left join (select distinct card_id from holdings) own on own.card_id = c.id
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
    order by (own.card_id is not null) desc, c.name, s.release_date desc
    limit ${limit} offset ${offset}`) as unknown as SearchCard[];
}

// Deck analytics — five live aggregations over the cards physically held in a deck.
// All read `cards.attrs jsonb`; no denormalisation, no caches. One round-trip.
//
//   1. mvDevotion   — per-MV-bucket count of coloured mana pips (W/U/B/R/G/C). Hybrids
//                     like {W/U} are counted in MV (cmc) only, not in any colour column.
//   2. mvHistogram  — cards per MV bucket, 0..7+ (7+ collapsed).
//   3. types        — count by `attrs->'types'`.
//   4. subtypes     — count by `attrs->'subtypes'`.
//   5. keywords     — count by `attrs->'keywords'`.
//
// Returned shape mirrors the plan: a single row with five jsonb arrays, each ordered
// for direct rendering (mv ascending, histogram ascending, others by count desc).
import { client } from './db/index.ts';

export type MvDevotionRow = { mv: number; W: number; U: number; B: number; R: number; G: number; C: number };
export type HistRow = { bucket: number; n: number };
export type CountRow = { value: string; n: number };

export type DeckAnalytics = {
  mvDevotion: MvDevotionRow[];
  mvHistogram: HistRow[];
  types: CountRow[];
  subtypes: CountRow[];
  keywords: CountRow[];
};

const EMPTY: DeckAnalytics = {
  mvDevotion: [], mvHistogram: [], types: [], subtypes: [], keywords: [],
};

export async function deckAnalytics(deckId: string): Promise<DeckAnalytics> {
  const [row] = await client`
    with deck as (
      select c.id, c.attrs, h.quantity
      from holdings h join cards c on c.id = h.card_id
      where h.container_id = ${deckId}
    ),
    parsed as (
      select id, quantity,
             (attrs->>'cmc')::numeric as mv,
             coalesce(
               array(select m[1] from regexp_matches(coalesce(attrs->>'mana_cost',''), '\{([^}]+)\}', 'g') m),
               '{}'::text[]
             ) as tokens
      from deck
    ),
    devo as (
      select p.mv::int as mv,
             sum(case when t='W' then p.quantity end)::int as W,
             sum(case when t='U' then p.quantity end)::int as U,
             sum(case when t='B' then p.quantity end)::int as B,
             sum(case when t='R' then p.quantity end)::int as R,
             sum(case when t='G' then p.quantity end)::int as G,
             sum(case when t='C' then p.quantity end)::int as C
      from parsed p, unnest(p.tokens) as t
      where t ~ '^[WUBRG]$'
      group by 1
    ),
    hist as (
      select case when (attrs->>'cmc')::numeric >= 7 then 7
                  else (attrs->>'cmc')::numeric end as bucket,
             sum(quantity)::int as n
      from deck group by 1
    ),
    ty as (
      select t as value, sum(quantity)::int as n
      from deck, unnest(coalesce(attrs->'types', '[]'::jsonb)::text[]) as x(t)
      group by 1
    ),
    sub as (
      select t as value, sum(quantity)::int as n
      from deck, unnest(coalesce(attrs->'subtypes', '[]'::jsonb)::text[]) as x(t)
      group by 1
    ),
    kw as (
      select t as value, sum(quantity)::int as n
      from deck, unnest(coalesce(attrs->'keywords', '[]'::jsonb)::text[]) as x(t)
      group by 1
    )
    select
      (select coalesce(jsonb_agg(jsonb_build_object('mv',mv,'W',W,'U',U,'B',B,'R',R,'G',G,'C',C) order by mv), '[]'::jsonb) from devo) as "mvDevotion",
      (select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'n',n) order by bucket), '[]'::jsonb) from hist) as "mvHistogram",
      (select coalesce(jsonb_agg(jsonb_build_object('value',value,'n',n) order by n desc, value), '[]'::jsonb) from ty)  as "types",
      (select coalesce(jsonb_agg(jsonb_build_object('value',value,'n',n) order by n desc, value), '[]'::jsonb) from sub) as "subtypes",
      (select coalesce(jsonb_agg(jsonb_build_object('value',value,'n',n) order by n desc, value), '[]'::jsonb) from kw)  as "keywords"
  ` as unknown as { mvDevotion: MvDevotionRow[]; mvHistogram: HistRow[]; types: CountRow[]; subtypes: CountRow[]; keywords: CountRow[] }[];

  return row ?? EMPTY;
}

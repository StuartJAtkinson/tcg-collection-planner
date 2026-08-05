// One shared search across every page. Scope narrows the candidate set; `q` and
// `opts` are flat.
//
//   scope = { type: 'all' }                       → catalogue, game-scoped via opts.game
//   scope = { type: 'game', gameId: 'mtg' }       → locked to one game
//   scope = { type: 'set', setId: '<id>' }        → a set's checklist
//   scope = { type: 'binder', containerId, filter } → binder filter applied to non-deck cards
//   scope = { type: 'deck', containerId }         → a deck's holdings
//
// Results are collapsed to one tile per oracle (Gatherer-style); the ownership
// sidebar carries the how-many-you-own detail aggregated across the group.
// Binders/all-game/set reuse the `hold` ownership CTE from src/ownership.ts;
// binder scope adds the filter fragment from src/filterExpr.ts; deck scope uses
// holdings directly so the same card sitting in two decks isn't over-counted.
import { client } from './db/index.ts';
import { ENABLED_GAMES } from './games.ts';
import { holdCte } from './ownership.ts';
import { orderFragment } from './sort.ts';
import { filterFragment, type FilterExpr } from './filterExpr.ts';

export type SearchScope =
  | { type: 'all' }
  | { type: 'game'; gameId: string }
  | { type: 'set'; setId: string }
  | { type: 'binder'; containerId: string; filter: FilterExpr | null }
  | { type: 'deck'; containerId: string };

export type SearchOpts = {
  game?: string;
  // legacy: single-valued kind (kept so older callers compile). Prefer plus/minus pairs.
  kind?: string;
  kindPlus?: string[]; kindMinus?: string[];
  combosPlus?: string[]; combosMinus?: string[];
  cmcMin?: string; cmcMax?: string;
  sort?: string;
  offset?: number;
  limit?: number;
};

// Whitelist keeps the composed ORDER BY injection-safe.
const SEARCH_SORT: Record<string, string> = {
  name: 'sort_name', set: 'release_date', number: 'sort_key',
  rarity: 'rarity_tier', mv: 'cmc_num', color: 'color_combo', price: 'usd',
};
// Owned first, then A–Z. When there's a fuzzy query, similarity wins so "lightning bollt"
// floats "Lightning Bolt" above alphabetical noise — but only when the user hasn't picked
// an explicit sort.
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

export async function search(scope: SearchScope, q: string, opts: SearchOpts): Promise<SearchCard[]> {
  const text = (q ?? '').trim();
  const like = '%' + text + '%';
  // tri-state split: if a `*Plus`/`*Minus` pair isn't given, fall back to the legacy flat
  // array and treat every entry as a plus (matches old single-state URLs).
  const combosPlus = opts.combosPlus ?? opts.combos ?? [];
  const combosMinus = opts.combosMinus ?? [];
  const cmcMin = opts.cmcMin?.trim() ?? '';
  const cmcMax = opts.cmcMax?.trim() ?? '';
  const kindPlus = opts.kindPlus ?? (opts.kind ? [opts.kind] : []);
  const kindMinus = opts.kindMinus ?? [];
  const limit = opts.limit ?? 60;
  const offset = opts.offset ?? 0;

  // Scope narrows the FROM before the oracle-level rollup runs.
  //   deck: cards reachable via this deck's holdings
  //   binder: cards matching the binder's filter (added as a WHERE clause)
  //   all / game / set: cards table (game/set narrow it in WHERE)
  const innerFrom =
    scope.type === 'deck'
      ? client`from cards c
        join sets s on s.id = c.set_id
        join holdings h on h.card_id = c.id and h.container_id = ${scope.containerId}`
      : client`from cards c
        join sets s on s.id = c.set_id
        ${scope.type === 'binder' ? filterFragment(scope.filter) : client``}`;

  // Deck ownership comes straight from the holdings join; the global hold CTE is for
  // the collection-wide view, not "what's in this deck specifically".
  const ownershipFrom =
    scope.type === 'deck'
      ? client`from cards c left join holdings h on h.card_id = c.id and h.container_id = ${scope.containerId}`
      : client`from cards c left join hold hd on hd.card_id = c.id`;

  return (await client`
    with ${holdCte},
      grp as (
        select coalesce(c.oracle_id, c.id) as gid,
               sum(coalesce(hd.total, 0))::int as func_total,
               sum(coalesce(hd.deck_nonfoil, 0))::int as deck_nonfoil,
               sum(coalesce(hd.deck_foil, 0))::int as deck_foil,
               bool_or(coalesce(hd.set_foil, 0) > 0) as any_foil
        ${ownershipFrom}
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
      ${innerFrom}
      join grp g on g.gid = coalesce(c.oracle_id, c.id)
      left join hold hd on hd.card_id = c.id
      left join card_facets cc on cc.card_id = c.id and cc.facet = 'color_combo'
      left join lateral (
        select usd from prices p where p.card_id = c.id
        order by (p.finish = 'nonfoil') desc, p.as_of desc limit 1
      ) p on true
      where true
      ${scope.type === 'set' ? client`and c.set_id = ${scope.setId}` : client``}
      ${scope.type === 'game' ? client`and c.game_id = ${scope.gameId}` : client``}
      ${scope.type === 'all' && opts.game ? client`and c.game_id = ${opts.game}` : client``}
      ${text ? client`and (
        c.name % ${text}
        or c.name ilike ${like}
        or coalesce(c.attrs->>'oracle_text', '') ilike ${like}
        or coalesce(c.attrs->>'flavor_text', '') ilike ${like}
        or coalesce(c.attrs->>'type_line', '') ilike ${like}
        or coalesce(c.attrs->'attacks', '[]'::jsonb)::text ilike ${like}
        or coalesce(c.attrs->'rules', '[]'::jsonb)::text ilike ${like}
      )` : client``}
      and c.game_id = any(${ENABLED_GAMES})
      ${kindPlus.length ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'kind' and f.value = any(${kindPlus}))` : client``}
      ${kindMinus.length ? client`and not exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'kind' and f.value = any(${kindMinus}))` : client``}
      ${combosPlus.length ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'color_combo' and f.value = any(${combosPlus}))` : client``}
      ${combosMinus.length ? client`and not exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'color_combo' and f.value = any(${combosMinus}))` : client``}
      ${cmcMin ? client`and (c.attrs->>'cmc')::numeric >= ${cmcMin}::numeric` : client``}
      ${cmcMax ? client`and (c.attrs->>'cmc')::numeric <= ${cmcMax}::numeric` : client``}
      order by coalesce(c.oracle_id, c.id), (hd.card_id is not null) desc, s.release_date desc nulls last
    ) reps
    order by ${orderFragment(SEARCH_SORT, opts.sort, text ? client`similarity(name, ${text}) desc, (func_total > 0) desc, sort_name` : SEARCH_DEFAULT)}
    limit ${limit} offset ${offset}`) as unknown as SearchCard[];
}

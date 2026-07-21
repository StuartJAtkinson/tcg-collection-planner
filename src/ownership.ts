// Ownership rollup CTE — per-card finish-bucketed copy counts split by deck containers,
// plus the distinct finishes owned (for the strip badge) and the copy total. Joined to
// `cards` from any list query that needs the sidebar/strip counters.
import { client } from './db/index.ts';

export const holdCte = client`
  hold as (
    select h.card_id,
      sum(case when h.finish in ('normal','nonfoil') then h.quantity else 0 end)::int as set_nonfoil,
      sum(case when h.finish not in ('normal','nonfoil') then h.quantity else 0 end)::int as set_foil,
      sum(h.quantity)::int as total,
      sum(case when ct.kind = 'deck' and h.finish in ('normal','nonfoil') then h.quantity else 0 end)::int as deck_nonfoil,
      sum(case when ct.kind = 'deck' and h.finish not in ('normal','nonfoil') then h.quantity else 0 end)::int as deck_foil,
      array_agg(distinct h.finish) as owned_finishes
    from holdings h join containers ct on ct.id = h.container_id
    group by h.card_id
  )
`;

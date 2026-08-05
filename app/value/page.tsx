// Phase-5 collection value: today's owned-portfolio value plus a 90-day sparkline sourced
// from the prices time series (populated by the nightly `db:prices` job in src/import/prices.ts).
//
// held_since: holdings carry an acquisition date (set by import to the CSV's Date Added or
// now() for manual adds; null pre-backfill means "assume since forever"). The per-day join
// gates on h.held_since <= p.as_of, so a card acquired yesterday correctly doesn't appear in
// the chart for last week.
import { client } from '../../src/db/index.ts';

export const dynamic = 'force-dynamic';

const DAYS = 90;

export default async function ValuePage() {
  // latest snapshot per (card, finish) — used for the today's-value number + the per-game split
  const [today] = await client`
    with latest as (
      select distinct on (card_id, finish) card_id, finish, usd, as_of
      from prices order by card_id, finish, as_of desc
    )
    select coalesce(sum(h.quantity * l.usd), 0)::float as total,
           count(*) filter (where l.usd is not null) as priced_rows
    from holdings h
    left join latest l on l.card_id = h.card_id and l.finish = h.finish
    where h.user_id = 'stuart'`;

  const [games] = await client`
    with latest as (
      select distinct on (card_id, finish) card_id, finish, usd
      from prices order by card_id, finish, as_of desc
    )
    select coalesce(sum(h.quantity * l.usd), 0)::float as total, c.game_id
    from holdings h
    join cards c on c.id = h.card_id
    left join latest l on l.card_id = h.card_id and l.finish = h.finish
    where h.user_id = 'stuart'
    group by c.game_id
    order by 1 desc`;

  // 90-day series: for each day that has prices, total holdings × that day's price — but only
  // counting holdings that existed by that day (held_since <= as_of; NULL treated as always).
  // Uses the latest price as-of that day per (card, finish) via distinct-on.
  const series = await client`
    with days as (
      select distinct as_of from prices order by as_of desc limit ${DAYS}
    ),
    priced as (
      select distinct on (p.as_of, p.card_id, p.finish)
        p.as_of, p.card_id, p.finish, p.usd
      from prices p
      where p.as_of in (select as_of from days)
      order by p.as_of, p.card_id, p.finish, p.as_of desc
    )
    select p.as_of as day,
           sum(h.quantity * p.usd)::float as total
    from priced p
    join holdings h on h.card_id = p.card_id and h.finish = p.finish and h.user_id = 'stuart'
      and (h.held_since is null or h.held_since <= p.as_of)
    group by 1
    order by 1`;

  const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const points = (series as { day: string; total: number }[] | undefined) ?? [];
  const max = Math.max(1, ...points.map((p) => p.total));
  const w = 100, h = 28;
  const path = points.length
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i / (points.length - 1 || 1)) * w},${h - (p.total / max) * h}`).join(' ')
    : '';
  const gameRows = (games as { game_id: string; total: number }[] | undefined) ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="sr-only">Collection value</h1>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="text-sm text-neutral-400">Latest snapshot</div>
        <div className="text-4xl font-bold">{fmt(today?.total ?? 0)}</div>
        <div className="mt-1 text-sm text-neutral-500">
          {today?.priced_rows ?? 0} priced holdings
          {gameRows.length ? ' · ' + gameRows.map((g) => `${g.game_id} ${fmt(g.total)}`).join(' · ') : ''}
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="mb-2 flex items-center justify-between text-sm text-neutral-400">
          <span>Last {points.length || 0} snapshots</span>
          {points.length > 0 && <span>{points[0].day} → {points[points.length - 1].day}</span>}
        </div>
        {points.length < 2 ? (
          <div className="text-sm text-neutral-500">
            Not enough snapshots yet — the nightly <code className="text-neutral-300">db:prices</code> job
            will populate the series day by day.
          </div>
        ) : (
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
            <path d={path} fill="none" stroke="currentColor" strokeWidth="0.6" className="text-emerald-400" />
          </svg>
        )}
      </div>
    </div>
  );
}

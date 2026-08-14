// Binders section. Three parts, no sub-tabs:
//  1. Unsorted collection + real binders (the physical containers).
//  2. Import locations — classify each imported portfolio container as binder / deck (neither
//     = unsorted). Same location a portfolio's resolved unmatched cards route to.
//  3. Create Binders — a completion frequency analysis finds the "step jump"
//     from scattered promos/decks to substantially-collected sets, and suggests a dedicated
//     binder for every set past the threshold; the rest are destined for functional-grouping
//     binders (built next). Ownership counts cards anywhere you own them (incl. decks) but not
//     for-play (a different printing of the same oracle card).
import Link from 'next/link';
import { client } from '../../src/db/index.ts';
import { createSetBinder } from '../../src/actions.ts';
import { ENABLED_GAMES } from '../../src/games.ts';
import DeleteContainer from '../components/DeleteContainer.tsx';
import NewContainer from '../components/NewContainer.tsx';
import ChipFormSection from '../components/ChipFormSection.tsx';
import { BTN_PRIMARY, BTN_SECONDARY } from '../components/chip.ts';

export const dynamic = 'force-dynamic';

export default async function BindersPage({ searchParams }: { searchParams: Promise<{ game?: string; pct?: string }> }) {
  const sp = await searchParams;
  const game = sp.game ?? 'mtg';
  const threshold = Math.min(100, Math.max(1, parseInt(sp.pct ?? '60', 10) || 60));

  const containers = await client`
    select ct.id, ct.name, ct.kind,
           coalesce(sum(h.quantity), 0)::int as total_cards,
           count(distinct h.card_id)::int as distinct_cards,
           coalesce(
             (select g2.name from holdings h2
              join cards c2 on c2.id = h2.card_id join games g2 on g2.id = c2.game_id
              where h2.container_id = ct.id group by g2.name order by sum(h2.quantity) desc limit 1),
             '—'
           ) as game_name
    from containers ct left join holdings h on h.container_id = ct.id
    group by ct.id order by ct.kind, ct.name`;

  const binders = containers.filter((c) => c.kind === 'binder' || c.kind === 'unsorted');

  // per-set completion for this game: owned = distinct exact cards held anywhere
  const setStats = (await client`
    select c.set_id, s.name, s.icon_url, count(*)::int as total,
           count(distinct h.card_id)::int as owned
    from cards c join sets s on s.id = c.set_id
    left join holdings h on h.card_id = c.id
    where c.game_id = ${game}
    group by c.set_id, s.name, s.icon_url
    having count(distinct h.card_id) > 0
    order by count(distinct h.card_id)::float / count(*) desc`) as unknown as {
    set_id: string; name: string; icon_url: string | null; total: number; owned: number;
  }[];

  // frequency analysis: histogram of completion %, and the "worthwhile floor" — the largest
  // relative gap in the sorted owned-counts marks where the promo/deck scatter ends
  const bands = Array.from({ length: 10 }, (_, i) => ({
    lo: i * 10,
    hi: i * 10 + 10,
    sets: setStats.filter((s) => {
      const p = (100 * s.owned) / s.total;
      return p > i * 10 && p <= i * 10 + 10;
    }).length,
  }));
  // worthwhile floor = the owned-count where the promo/deck scatter ends. Search the largest
  // ABSOLUTE gap within the lower ~80% of sorted owned-counts, so the single top set (a big
  // outlier) doesn't dominate — that upper gap is real but isn't the scatter boundary.
  const ownedCounts = [...setStats.map((s) => s.owned)].sort((a, b) => a - b);
  const searchTo = Math.max(2, Math.floor(ownedCounts.length * 0.8));
  let floor = 10;
  let bestGap = 0;
  for (let i = 1; i < searchTo; i++) {
    const gap = ownedCounts[i] - ownedCounts[i - 1];
    if (gap > bestGap) { bestGap = gap; floor = ownedCounts[i]; }
  }

  const suggestions = setStats.filter((s) => (100 * s.owned) / s.total >= threshold && s.owned >= floor);
  const suggestedIds = new Set(suggestions.map((s) => s.set_id));
  const restCards = setStats.filter((s) => !suggestedIds.has(s.set_id)).reduce((n, s) => n + s.owned, 0);
  const maxBand = Math.max(1, ...bands.map((b) => b.sets));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="inline-block border-b-2 border-emerald-500 pb-1 text-xl font-semibold text-white">Binders</h1>
        <NewContainer kind="binder" />
      </div>

      {/* 1. physical binders */}
      <section className="mb-10">
        <h2 className="mb-3 border-b border-neutral-800 pb-1 text-lg font-semibold text-neutral-300">
          Your binders <span className="text-sm font-normal text-neutral-500">{binders.length}</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {binders.map((b) => (
            <div key={b.id} className="relative rounded-lg border border-neutral-800 bg-neutral-900 hover:border-neutral-600">
              {b.kind !== 'unsorted' && (
                <div className="absolute right-1 top-1 z-10"><DeleteContainer id={b.id} name={b.name} /></div>
              )}
              <Link href={`/binders/${encodeURIComponent(b.id)}`} className="block p-3">
                <div className="flex items-center gap-1.5 pr-6">
                  {b.kind === 'unsorted' && <span className="rounded bg-neutral-700 px-1 text-[10px] uppercase">unsorted</span>}
                  <span className="truncate font-medium">{b.name}</span>
                </div>
                <div className="mt-1 text-xs text-neutral-400">{b.total_cards} cards · {b.distinct_cards} distinct</div>
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* 3. create binders */}
      <section>
        <div className="mb-1 flex items-center justify-between border-b border-neutral-800 pb-1">
          <h2 className="text-lg font-semibold text-neutral-300">Create binders</h2>
          <Link href="/binders/build" className={BTN_PRIMARY}>
            Build functional binder
          </Link>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-neutral-400">
          Sets you&apos;ve collected past the threshold get a dedicated binder; everything else is destined for
          functional-grouping binders (colour / rarity / type / mana value / alphabetical…). Ownership
          counts copies held anywhere including decks, but not for-play copies of a different printing.
        </p>

        {/* Game scope (Magic / Pokémon) — radio chips + Apply. Threshold % sits in its own
            small form below since it's a free-form number, not a choice. */}
        <ChipFormSection
          action="/binders"
          className="no-print mb-3 flex flex-wrap items-center gap-1.5 text-sm"
          fields={[
            {
              name: 'game',
              kind: 'radio',
              defaultValue: game,
              options: ENABLED_GAMES.map((g) => ({ value: g, label: g === 'mtg' ? 'Magic' : 'Pokémon' })),
            },
          ]}
          hidden={{ pct: String(threshold) }}
          clearHref={`/binders?game=${game}`}
        />

        <form method="get" action="/binders" className="mb-4 flex items-center gap-2 text-sm">
          <input type="hidden" name="game" value={game} />
          <label className="flex items-center gap-1 text-neutral-400">
            threshold %
            <input
              type="number"
              name="pct"
              min={1}
              max={100}
              defaultValue={threshold}
              className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
            />
          </label>
          <button className={BTN_SECONDARY}>Apply</button>
        </form>

        {/* frequency analysis histogram — the step jump from scatter to worthwhile sets */}
        <div className="mb-6 max-w-xl">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Set completion spread</div>
          <div className="flex items-end gap-1" style={{ height: 80 }}>
            {bands.map((b) => (
              <div key={b.lo} className="flex flex-1 flex-col items-center justify-end" title={`${b.lo}-${b.hi}%: ${b.sets} sets`}>
                <div className="w-full rounded-t bg-emerald-600/70" style={{ height: `${(100 * b.sets) / maxBand}%` }} />
                <div className="mt-0.5 text-[8px] text-neutral-500">{b.lo}</div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            worthwhile floor ≈ <span className="text-neutral-300">{floor}</span> cards (largest owned-count gap) ·
            threshold <span className="text-neutral-300">{threshold}%</span>
          </div>
        </div>

        {suggestions.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No sets meet {threshold}% completion (min {floor} cards) yet — all {restCards.toLocaleString()} owned{' '}
            {game === 'mtg' ? 'Magic' : 'Pokémon'} cards would go to functional-grouping binders. Lower the threshold to
            see near-complete sets.
          </p>
        ) : (
          <div className="grid gap-2">
            <div className="text-sm text-neutral-400">{suggestions.length} suggested binder{suggestions.length > 1 ? 's' : ''}; {restCards.toLocaleString()} cards to functional grouping</div>
            {suggestions.map((s) => {
              const pct = Math.round((100 * s.owned) / s.total);
              return (
                <div key={s.set_id} className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2">
                  {s.icon_url && <img src={s.icon_url} alt="" className={`h-6 w-6 shrink-0 ${game === 'mtg' ? 'invert' : ''}`} />}
                  <span className="w-64 shrink-0 truncate font-medium">{s.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-800">
                    <div className="h-2 rounded bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm text-neutral-400">{s.owned}/{s.total} · {pct}%</span>
                  <form action={createSetBinder}>
                    <input type="hidden" name="set_id" value={s.set_id} />
                    <input type="hidden" name="set_name" value={s.name} />
                    <button className={BTN_PRIMARY}>Create binder</button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

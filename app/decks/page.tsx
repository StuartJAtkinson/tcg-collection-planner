// The Decks section, mirroring how Master Sets works for sets: Wizards' preconstructed
// products (commander decks, duel decks, planechase/archenemy, starters) are the "fixed"
// buyable deck lists — the master reference — while the user's own decks (imported from
// Collectr portfolios as containers, many started from a precon then modified with
// collection cards) sit alongside as "selections". Cards in decks still count as collected
// everywhere; this page is about the physical/deck view of the same holdings.
import Link from 'next/link';
import { client } from '../../src/db/index.ts';

export const dynamic = 'force-dynamic';

const MTG_DECK_TYPES = ['commander', 'duel_deck', 'planechase', 'archenemy', 'starter', 'arsenal', 'premium_deck'];

export default async function DecksPage({ searchParams }: { searchParams: Promise<{ game?: string }> }) {
  const sp = await searchParams;
  const game = sp.game ?? 'mtg';

  const myDecks = await client`
    select ct.id, ct.name,
           count(distinct h.card_id)::int as distinct_cards,
           coalesce(sum(h.quantity), 0)::int as total_cards
    from containers ct
    left join holdings h on h.container_id = ct.id
    where ct.kind = 'deck'
    group by ct.id
    order by ct.name`;

  const preconSets = await client`
    select s.id, s.code, s.name, s.set_type, s.icon_url, s.crossover,
           to_char(s.release_date, 'YYYY-MM-DD') as released,
           date_part('year', s.release_date)::int as year,
           count(c.id)::int as total,
           count(distinct h.card_id)::int as owned
    from sets s
    join cards c on c.set_id = s.id
    left join holdings h on h.card_id = c.id
    where s.game_id = ${game} and s.set_type = any(${MTG_DECK_TYPES})
    group by s.id
    order by s.release_date desc`;

  const years = [...new Set(preconSets.map((s) => s.year))];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Decks</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Preconstructed products are the fixed, buyable deck lists — the "master sets" of decks.
        Your own decks are selections from the collection (many begin life as a precon).
      </p>

      <section className="mb-10">
        <h2 className="mb-3 border-b border-neutral-800 pb-1 text-lg font-semibold text-neutral-300">
          My decks <span className="text-sm font-normal text-neutral-500">{myDecks.length}</span>
        </h2>
        {myDecks.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No decks yet — import a Collectr export with portfolio names, or create decks in phase 3b.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {myDecks.map((d) => (
              <div key={d.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                <div className="truncate font-medium">{d.name}</div>
                <div className="mt-1 text-xs text-neutral-400">
                  {d.total_cards} cards · {d.distinct_cards} distinct
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 border-b border-neutral-800 pb-1 text-lg font-semibold text-neutral-300">
          Preconstructed products{' '}
          <span className="text-sm font-normal text-neutral-500">{preconSets.length}</span>
        </h2>
        {years.map((year) => (
          <div key={year} className="mb-8">
            <h3 className="mb-3 text-base font-semibold text-neutral-400">{year}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {preconSets
                .filter((s) => s.year === year)
                .map((s) => {
                  const pct = s.total ? Math.round((100 * s.owned) / s.total) : 0;
                  return (
                    <Link
                      key={s.id}
                      href={`/set/${encodeURIComponent(s.id)}`}
                      className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 hover:border-neutral-600"
                    >
                      <div className="flex items-center gap-2">
                        {s.icon_url && (
                          <img
                            src={s.icon_url}
                            alt=""
                            loading="lazy"
                            className={`h-6 w-6 shrink-0 ${game === 'mtg' ? 'invert' : ''}`}
                          />
                        )}
                        <div className="truncate font-medium leading-tight">{s.name}</div>
                        {s.crossover && (
                          <span className="ml-auto shrink-0 rounded bg-purple-500/20 px-1 text-[10px] uppercase text-purple-300">
                            crossover
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs uppercase text-neutral-400">
                        {s.code} · {s.total} cards · {s.released}
                      </div>
                      <div className="mt-2 h-1.5 rounded bg-neutral-800">
                        <div className="h-1.5 rounded bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-xs text-neutral-500">
                        {s.owned}/{s.total} · {pct}%
                      </div>
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// The Decks section, mirroring how Collections works for sets — but NOT split by game:
// one page for all play decks, with game dividers. Wizards' preconstructed products
// (commander decks, duel decks, planechase/archenemy, starters) are the "fixed" buyable
// deck lists — the master reference — while the user's own decks (imported from Collectr
// portfolios as containers, many started from a precon then modified with collection cards)
// sit alongside as selections. Cards in decks still count as collected everywhere.
import Link from 'next/link';
import { client } from '../../src/db/index.ts';
import { ENABLED_GAMES, MTG_DECK_TYPES } from '../../src/games.ts';
import DeleteContainer from '../components/DeleteContainer.tsx';
import { BTN_PRIMARY } from '../components/chip.ts';

export const dynamic = 'force-dynamic';

// deck-shaped set types across games: mtg's precon products plus pokemon's 'deck'
// (Trainer Kits / Starter Sets, derived at import). MTG list comes from src/games.ts so
// /g/mtg agrees on what counts as a precon.
const DECK_SET_TYPES = [...MTG_DECK_TYPES, 'deck'];

export default async function DecksPage() {
  // a container has no game column; a deck's game is whichever game most of its cards
  // belong to (decks are single-game in practice, this just avoids hand-tagging them)
  const myDecks = await client`
    select ct.id, ct.name,
           count(distinct h.card_id)::int as distinct_cards,
           coalesce(sum(h.quantity), 0)::int as total_cards,
           coalesce(
             (select g2.name
              from holdings h2
              join cards c2 on c2.id = h2.card_id
              join games g2 on g2.id = c2.game_id
              where h2.container_id = ct.id
              group by g2.name
              order by sum(h2.quantity) desc
              limit 1),
             'Empty'
           ) as game_name
    from containers ct
    left join holdings h on h.container_id = ct.id
    where ct.kind = 'deck'
    group by ct.id
    order by ct.name`;

  const preconSets = await client`
    select s.id, s.code, s.name, s.game_id, s.set_type, s.icon_url, s.crossover,
           g.name as game_name,
           to_char(s.release_date, 'YYYY-MM-DD') as released,
           date_part('year', s.release_date)::int as year,
           count(c.id)::int as total,
           count(distinct h.card_id)::int as owned
    from sets s
    join games g on g.id = s.game_id
    join cards c on c.set_id = s.id
    left join holdings h on h.card_id = c.id
    where s.set_type = any(${DECK_SET_TYPES}) and s.game_id = any(${ENABLED_GAMES})
    group by s.id, g.name
    order by g.name, s.release_date desc`;

  const deckGames = [...new Set(myDecks.map((d) => d.game_name))];
  const preconGames = [...new Set(preconSets.map((s) => s.game_name))];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="inline-block border-b-2 border-emerald-500 pb-1 text-xl font-semibold text-white">Decks</h1>
        <Link href="/decks/new" className={BTN_PRIMARY}>+ New deck</Link>
      </div>
      <p className="mb-6 text-sm text-neutral-400">
        Preconstructed products are the fixed, buyable deck lists — the &quot;master sets&quot; of decks.
        Your own decks are selections from the collection (many begin life as a precon).
      </p>

      <section className="mb-10">
        <h2 className="mb-3 border-b border-neutral-800 pb-1 text-lg font-semibold text-neutral-300">
          Your decks <span className="text-sm font-normal text-neutral-500">{myDecks.length}</span>
        </h2>
        {myDecks.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No decks yet — click "+ New deck" above, or import a Collectr export with portfolio names.
          </p>
        ) : (
          deckGames.map((gameName) => (
            <div key={gameName} className="mb-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{gameName}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {myDecks
                  .filter((d) => d.game_name === gameName)
                  .map((d) => (
                    <div key={d.id} className="relative rounded-lg border border-neutral-800 bg-neutral-900 hover:border-neutral-600">
                      <div className="absolute right-1 top-1 z-10"><DeleteContainer id={d.id} name={d.name} /></div>
                      <Link href={`/decks/${encodeURIComponent(d.id)}`} className="block p-3">
                        <div className="truncate pr-6 font-medium">{d.name}</div>
                        <div className="mt-1 text-xs text-neutral-400">
                          {d.total_cards} cards · {d.distinct_cards} distinct
                        </div>
                      </Link>
                    </div>
                  ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section>
        <h2 className="mb-3 border-b border-neutral-800 pb-1 text-lg font-semibold text-neutral-300">
          Preconstructed products{' '}
          <span className="text-sm font-normal text-neutral-500">{preconSets.length}</span>
        </h2>
        {preconGames.map((gameName) => {
          const gameSets = preconSets.filter((s) => s.game_name === gameName);
          const years = [...new Set(gameSets.map((s) => s.year))];
          return (
            <div key={gameName} className="mb-10">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{gameName}</h3>
              {years.map((year) => (
                <div key={year} className="mb-8">
                  <h4 className="mb-3 text-base font-semibold text-neutral-400">{year}</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {gameSets
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
                                  className={`h-6 w-6 shrink-0 ${s.game_id === 'mtg' ? 'invert' : ''}`}
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
            </div>
          );
        })}
      </section>
    </div>
  );
}

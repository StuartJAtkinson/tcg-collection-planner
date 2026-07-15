// Binders section, sibling to Decks: the physical binder containers that organise the
// collection. Like /decks it is not game-split — one page, game dividers. The 'main'
// collection pool shows here as the default binder until per-binder containers exist
// (creating binders + assigning pages/pockets is phase 3b container CRUD). Each binder links
// to its own book-spread view at /binders/[id].
import Link from 'next/link';
import { client } from '../../src/db/index.ts';

export const dynamic = 'force-dynamic';

export default async function BindersPage() {
  const binders = await client`
    select ct.id, ct.name, ct.kind,
           count(distinct h.card_id)::int as distinct_cards,
           coalesce(sum(h.quantity), 0)::int as total_cards,
           coalesce(
             (select g2.name from holdings h2
              join cards c2 on c2.id = h2.card_id
              join games g2 on g2.id = c2.game_id
              where h2.container_id = ct.id
              group by g2.name order by sum(h2.quantity) desc limit 1),
             'Empty'
           ) as game_name
    from containers ct
    left join holdings h on h.container_id = ct.id
    where ct.kind in ('collection', 'binder')
    group by ct.id
    order by ct.kind, ct.name`;

  const games = [...new Set(binders.map((b) => b.game_name))];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Binders</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Physical binders that organise the collection. The <span className="text-neutral-200">Main</span> pool is the
        default binder; named binders and per-page pocket layout arrive with container editing (phase 3b).
      </p>

      {binders.length === 0 ? (
        <p className="text-sm text-neutral-500">No binders yet.</p>
      ) : (
        games.map((gameName) => (
          <div key={gameName} className="mb-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{gameName}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {binders
                .filter((b) => b.game_name === gameName)
                .map((b) => (
                  <Link
                    key={b.id}
                    href={`/binders/${encodeURIComponent(b.id)}`}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 hover:border-neutral-600"
                  >
                    <div className="truncate font-medium">{b.name}</div>
                    <div className="mt-1 text-xs text-neutral-400">
                      {b.total_cards} cards · {b.distinct_cards} distinct
                    </div>
                  </Link>
                ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

import Link from 'next/link';
import { client } from '../src/db/index.ts';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const games = await client`
    select g.id, g.name,
      (select count(*) from sets s where s.game_id = g.id)::int as sets,
      (select count(*) from cards c where c.game_id = g.id)::int as cards,
      (select count(distinct h.card_id) from holdings h
         join cards c2 on c2.id = h.card_id where c2.game_id = g.id)::int as owned,
      (select coalesce(sum(h.quantity), 0) from holdings h
         join cards c2 on c2.id = h.card_id
         join containers ct on ct.id = h.container_id
         where c2.game_id = g.id and ct.kind in ('collection', 'binder'))::int as physical_collection,
      (select coalesce(sum(h.quantity), 0) from holdings h
         join cards c2 on c2.id = h.card_id
         join containers ct on ct.id = h.container_id
         where c2.game_id = g.id and ct.kind = 'deck')::int as physical_decks
    from games g order by g.id`;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Master Sets</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {games.map((g) => (
          <Link
            key={g.id}
            href={`/g/${g.id}`}
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 hover:border-neutral-600"
          >
            <div className="text-xl font-semibold">{g.name}</div>
            <div className="mt-2 flex gap-6 text-sm text-neutral-400">
              <span><span className="text-neutral-100">{g.sets}</span> sets</span>
              <span><span className="text-neutral-100">{g.cards.toLocaleString()}</span> cards</span>
              <span><span className="text-neutral-100">{g.owned.toLocaleString()}</span> owned</span>
            </div>
            {(g.physical_collection > 0 || g.physical_decks > 0) && (
              <div className="mt-1 text-xs text-neutral-500">
                physical: {g.physical_collection.toLocaleString()} in collection · {g.physical_decks.toLocaleString()} in decks
              </div>
            )}
            <div className="mt-4 h-1.5 rounded bg-neutral-800">
              <div
                className="h-1.5 rounded bg-emerald-500"
                style={{ width: `${g.cards ? Math.round((100 * g.owned) / g.cards) : 0}%` }}
              />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

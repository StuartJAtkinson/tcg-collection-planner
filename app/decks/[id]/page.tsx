// A single deck's contents — the holdings physically sitting in this container. Read-only
// for now: moving cards between containers / editing quantities is phase 3b's container CRUD.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';

export const dynamic = 'force-dynamic';

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [deck] = await client`select id, name, kind from containers where id = ${id}`;
  if (!deck) notFound();

  const cards = await client`
    select c.id, c.name, c.collector_number, c.image_small, c.game_id,
           s.code as set_code, s.name as set_name,
           h.finish, h.quantity, h.condition, h.grade,
           lp.usd::float as usd
    from holdings h
    join cards c on c.id = h.card_id
    join sets s on s.id = c.set_id
    left join lateral (
      select usd from prices p where p.card_id = c.id
      order by (p.finish = 'nonfoil') desc, p.as_of desc limit 1
    ) lp on true
    where h.container_id = ${id}
    order by c.name, s.code`;

  const totalCards = cards.reduce((n, c) => n + c.quantity, 0);
  const totalValue = cards.reduce((n, c) => n + (c.usd ?? 0) * c.quantity, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-neutral-400">
            <Link href="/decks" className="hover:text-white">Decks</Link>
            {' · '}
            {deck.kind}
          </div>
          <h1 className="text-2xl font-bold">{deck.name}</h1>
        </div>
        <div className="text-right text-sm text-neutral-400">
          <div>
            <span className="text-lg font-semibold text-neutral-100">{totalCards}</span> cards ·{' '}
            {cards.length} distinct
          </div>
          {totalValue > 0 && (
            <div>
              value ≈ <span className="text-neutral-100">${totalValue.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
        {cards.map((c) => (
          <div key={`${c.id}-${c.finish}`}>
            <Link href={`/card/${encodeURIComponent(c.id)}`} className="relative block overflow-hidden rounded-lg">
              {c.image_small ? (
                <img src={c.image_small} alt={c.name} loading="lazy" className="w-full" />
              ) : (
                <div className="flex aspect-[5/7] items-center justify-center bg-neutral-800 p-2 text-center text-xs text-neutral-400">
                  {c.name}
                </div>
              )}
              {c.quantity > 1 && (
                <span className="absolute right-1 top-1 rounded-full bg-neutral-950/90 px-1.5 py-0.5 text-xs font-bold">
                  ×{c.quantity}
                </span>
              )}
              {c.finish !== 'normal' && c.finish !== 'nonfoil' && (
                <span className="absolute left-1 top-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-950">
                  {c.finish.slice(0, 4)}
                </span>
              )}
            </Link>
            <div className="mt-1 flex justify-between text-xs text-neutral-400">
              <span className="uppercase">{c.set_code}</span>
              {c.usd != null && <span>${(c.usd * c.quantity).toFixed(2)}</span>}
            </div>
            <div className="truncate text-sm">{c.name}</div>
          </div>
        ))}
        {cards.length === 0 && <p className="text-neutral-500">This deck is empty.</p>}
      </div>
    </div>
  );
}

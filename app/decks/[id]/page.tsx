// A single deck's contents — the holdings physically sitting in this container. Read-only
// for now: moving cards between containers / editing quantities is phase 3b's container CRUD.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';
import { orderFragment } from '../../../src/sort.ts';
import SortBar from '../../components/SortBar.tsx';
import CardTile from '../../components/CardTile.tsx';

export const dynamic = 'force-dynamic';

export default async function DeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { id } = await params;
  const order = orderFragment((await searchParams).sort);

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
    left join card_facets cc on cc.card_id = c.id and cc.facet = 'color_combo'
    left join lateral (
      select usd from prices p where p.card_id = c.id
      order by (p.finish = 'nonfoil') desc, p.as_of desc limit 1
    ) lp on true
    where h.container_id = ${id}
    order by ${order ?? client`c.name, s.code`}`;

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

      <div className="mb-3"><SortBar /></div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
        {cards.map((c) => (
          <CardTile
            key={`${c.id}-${c.finish}`}
            card={{ id: c.id, name: c.name, imageSmall: c.image_small, owned: true, quantity: c.quantity, finish: c.finish }}
            metaLeft={<span className="uppercase">{c.set_code}</span>}
            metaRight={c.usd != null ? `$${(c.usd * c.quantity).toFixed(2)}` : undefined}
          />
        ))}
        {cards.length === 0 && <p className="text-neutral-500">This deck is empty.</p>}
      </div>
    </div>
  );
}

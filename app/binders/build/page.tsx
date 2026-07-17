import Link from 'next/link';
import { client } from '../../../src/db/index.ts';
import BinderBuilder, { type BinderCandidate } from '../../components/BinderBuilder.tsx';

export const dynamic = 'force-dynamic';

export default async function BuildBinderPage({ searchParams }: { searchParams: Promise<{ game?: string }> }) {
  const sp = await searchParams;
  const game = sp.game === 'pokemon' ? 'pokemon' : 'mtg';
  const rows = (await client`
    select c.id, c.name, c.image_small as image, c.collector_number,
           c.sort_key, c.rarity_raw as rarity, c.attrs->>'cmc' as cmc,
           h.finish, h.quantity, s.name as set, s.code as set_code,
           coalesce((select f.value from card_facets f where f.card_id = c.id and f.facet = 'color_combo' limit 1), 'Colourless') as color,
           coalesce((select f.value from card_facets f where f.card_id = c.id and f.facet = 'kind' limit 1), 'Other') as kind
    from holdings h
    join cards c on c.id = h.card_id
    join sets s on s.id = c.set_id
    where h.user_id = 'stuart' and h.container_id = 'unsorted' and c.game_id = ${game}
    order by c.name`) as unknown as {
      id: string; name: string; image: string | null; collector_number: string; sort_key: number;
      rarity: string | null; cmc: string | null; finish: string; quantity: number; set: string;
      set_code: string; color: string; kind: string;
    }[];

  const cards: BinderCandidate[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    finish: r.finish,
    quantity: r.quantity,
    image: r.image,
    set: r.set,
    setCode: r.set_code,
    collectorNumber: r.collector_number,
    sortKey: r.sort_key,
    color: r.color,
    rarity: r.rarity ?? 'Unknown',
    kind: r.kind,
    manaValue: r.cmc === null || r.cmc === '' ? null : Number(r.cmc),
  }));

  return (
    <div>
      <div className="mb-5">
        <div className="text-sm text-neutral-400"><Link href="/binders" className="hover:text-white">Binders</Link> · Create</div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-bold">Build from unsorted collection</h1>
          <div className="flex gap-1">
            {(['mtg', 'pokemon'] as const).map((g) => (
              <Link key={g} href={`/binders/build?game=${g}`}
                className={`rounded-full border px-3 py-1 text-xs ${game === g ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'}`}>
                {g === 'mtg' ? 'Magic' : 'Pokémon'}
              </Link>
            ))}
          </div>
        </div>
      </div>
      <BinderBuilder cards={cards} defaultName={`General ${game === 'mtg' ? 'Magic' : 'Pokémon'} binder`} />
    </div>
  );
}

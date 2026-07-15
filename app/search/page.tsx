// Global card search across both games — name + facet filters, per the plan's Search page.
// Minimal first cut: name search with ownership indication; the standardized filter sidebar
// (rarity/kind/colour, Apply button) lands with the sidebar-standardization pass.
import Link from 'next/link';
import { client } from '../../src/db/index.ts';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();

  const cards = q
    ? await client`
        select c.id, c.name, c.collector_number, c.image_small, c.game_id, c.set_id,
               s.code as set_code, s.name as set_name,
               exists (select 1 from holdings h where h.card_id = c.id) as owned
        from cards c join sets s on s.id = c.set_id
        where c.name ilike ${'%' + q + '%'}
        order by (exists (select 1 from holdings h where h.card_id = c.id)) desc, c.name, s.release_date desc
        limit 120`
    : [];

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Search</h1>
      <form method="get" className="mb-6 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="card name…"
          autoFocus
          className="w-80 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5"
        />
        <button className="rounded border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800">Search</button>
      </form>

      {q && <div className="mb-3 text-sm text-neutral-400">{cards.length} results</div>}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
        {cards.map((c) => (
          <Link key={c.id} href={`/set/${encodeURIComponent(c.set_id ?? '')}`} className={c.owned ? '' : 'opacity-90'}>
            <div className={`relative overflow-hidden rounded-lg ${c.owned ? 'ring-2 ring-emerald-500' : ''}`}>
              {c.image_small ? (
                <img src={c.image_small} alt={c.name} loading="lazy" className="w-full" />
              ) : (
                <div className="flex aspect-[5/7] items-center justify-center bg-neutral-800 p-2 text-center text-xs text-neutral-400">
                  {c.name}
                </div>
              )}
            </div>
            <div className="mt-1 truncate text-sm">{c.name}</div>
            <div className="text-xs uppercase text-neutral-500">{c.set_code}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

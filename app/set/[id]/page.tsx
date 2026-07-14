import Link from 'next/link';
import { notFound } from 'next/navigation';
import { toggleHolding } from '../../../src/actions.ts';
import { client } from '../../../src/db/index.ts';
import PrintButton from './print-button.tsx';

export const dynamic = 'force-dynamic';

type SP = { view?: string; rarity?: string; kind?: string; color?: string; artist?: string; q?: string };
type Card = {
  id: string; name: string; collector_number: string; rarity_raw: string | null;
  image_small: string | null; artist: string | null; finishes: string[];
  owned_finishes: string[]; owned: boolean; usd: number | null;
};

const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export default async function SetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const view = sp.view ?? 'grid';

  const [set] = await client`
    select s.*, to_char(s.release_date, 'YYYY-MM-DD') as released, g.name as game_name
    from sets s join games g on g.id = s.game_id
    where s.id = ${id}`;
  if (!set) notFound();

  const [stats] = await client`
    select count(*)::int as total,
           count(*) filter (where exists (select 1 from holdings h where h.card_id = c.id))::int as owned,
           sum(p.usd) filter (where not exists (select 1 from holdings h where h.card_id = c.id))::float as cost_to_complete
    from cards c
    left join lateral (
      select usd from prices p where p.card_id = c.id
      order by (p.finish = 'nonfoil') desc, p.as_of desc limit 1
    ) p on true
    where c.set_id = ${id}`;

  const cards = (await client`
    select c.id, c.name, c.collector_number, c.rarity_raw, c.image_small, c.artist, c.finishes,
           coalesce(hh.owned_finishes, '{}') as owned_finishes,
           coalesce(array_length(hh.owned_finishes, 1), 0) > 0 as owned,
           p.usd::float as usd
    from cards c
    left join lateral (select array_agg(h.finish) as owned_finishes from holdings h where h.card_id = c.id) hh on true
    left join lateral (
      select usd from prices p where p.card_id = c.id
      order by (p.finish = 'nonfoil') desc, p.as_of desc limit 1
    ) p on true
    where c.set_id = ${id}
    ${sp.rarity ? client`and c.rarity_raw = ${sp.rarity}` : client``}
    ${sp.artist ? client`and c.artist = ${sp.artist}` : client``}
    ${sp.q ? client`and c.name ilike ${'%' + sp.q + '%'}` : client``}
    ${sp.kind ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'kind' and f.value = ${sp.kind})` : client``}
    ${sp.color ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'color' and f.value = ${sp.color})` : client``}
    order by c.sort_key, c.collector_number`) as unknown as Card[];

  const facetOpts = await client`
    select f.facet, f.value, count(*)::int as n
    from card_facets f join cards c on c.id = f.card_id
    where c.set_id = ${id} and f.facet in ('color', 'kind')
    group by 1, 2 order by 1, 3 desc`;
  const rarities = await client`
    select rarity_raw as value, count(*)::int as n
    from cards where set_id = ${id} and rarity_raw is not null
    group by 1 order by 2 desc`;
  const artists = await client`
    select distinct artist from cards where set_id = ${id} and artist is not null order by 1`;

  const pct = stats.total ? Math.round((100 * stats.owned) / stats.total) : 0;
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  const select = (name: string, placeholder: string, current: string | undefined, opts: { value: string; n?: number }[]) => (
    <select
      name={name}
      defaultValue={current ?? ''}
      className="max-w-40 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
    >
      <option value="">{placeholder}</option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value}{o.n ? ` (${o.n})` : ''}
        </option>
      ))}
    </select>
  );

  // primary finish owns the slot; a second finish (e.g. foil) gets its own small toggle
  const tile = (c: Card) => {
    const [primary, ...rest] = c.finishes.length ? c.finishes : ['normal'];
    return (
      <div key={c.id} className={c.owned ? '' : 'opacity-90'}>
        <div className={`relative overflow-hidden rounded-lg ${c.owned ? 'ring-2 ring-emerald-500' : ''}`}>
          {c.image_small ? (
            <img src={c.image_small} alt={c.name} loading="lazy" className="w-full" />
          ) : (
            <div className="flex aspect-[5/7] items-center justify-center bg-neutral-800 p-2 text-center text-xs text-neutral-400">
              {c.name}
            </div>
          )}
          {!c.owned && <div className="absolute inset-0 bg-neutral-950/40" />}
          <form action={toggleHolding.bind(null, c.id, primary)} className="no-print absolute right-1 top-1">
            <button
              title={c.owned_finishes.includes(primary) ? `Owned (${primary}) — click to remove` : `Mark owned (${primary})`}
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${
                c.owned_finishes.includes(primary)
                  ? 'border-emerald-400 bg-emerald-500 text-neutral-950'
                  : 'border-neutral-400 bg-neutral-950/70 text-transparent hover:text-neutral-300'
              }`}
            >
              ✓
            </button>
          </form>
          {rest[0] && (
            <form action={toggleHolding.bind(null, c.id, rest[0])} className="no-print absolute left-1 top-1">
              <button
                title={c.owned_finishes.includes(rest[0]) ? `Owned (${rest[0]}) — click to remove` : `Mark owned (${rest[0]})`}
                className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  c.owned_finishes.includes(rest[0])
                    ? 'border-amber-400 bg-amber-500 text-neutral-950'
                    : 'border-neutral-400 bg-neutral-950/70 text-neutral-300'
                }`}
              >
                {rest[0].slice(0, 4)}
              </button>
            </form>
          )}
        </div>
        <div className="mt-1 flex justify-between text-xs text-neutral-400">
          <span>#{c.collector_number}</span>
          {c.usd != null && <span>${c.usd.toFixed(2)}</span>}
        </div>
        <div className="truncate text-sm">{c.name}</div>
      </div>
    );
  };

  const views = [
    ['grid', 'Grid'],
    ['9', '9-pocket'],
    ['12', '12-pocket'],
    ['print', 'Print'],
  ] as const;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-neutral-400">
            <Link href={`/g/${set.game_id}`} className="hover:text-white">{set.game_name}</Link>
            {' · '}{set.released}{set.series ? ` · ${set.series}` : ''}
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {set.icon_url && (
              <img src={set.icon_url} alt="" className={`h-7 w-7 ${set.game_id === 'mtg' ? 'invert' : ''}`} />
            )}
            {set.name}
            <span className="text-base font-normal uppercase text-neutral-500">{set.code}</span>
          </h1>
        </div>
        <div className="text-right text-sm text-neutral-400">
          <div>
            <span className="text-lg font-semibold text-neutral-100">{stats.owned}/{stats.total}</span> owned · {pct}%
          </div>
          {stats.cost_to_complete != null && (
            <div>cost to complete ≈ <span className="text-neutral-100">${stats.cost_to_complete.toFixed(2)}</span></div>
          )}
        </div>
      </div>

      <div className="no-print mb-4 flex flex-wrap items-center gap-2 text-sm">
        {views.map(([v, label]) => (
          <Link
            key={v}
            href={qs({ view: v === 'grid' ? undefined : v })}
            className={`rounded-full border px-3 py-1 ${
              view === v
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            }`}
          >
            {label}
          </Link>
        ))}
        <form method="get" className="ml-auto flex flex-wrap items-center gap-2">
          {view !== 'grid' && <input type="hidden" name="view" value={view} />}
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="name…"
            className="w-32 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
          {select('rarity', 'All rarities', sp.rarity, rarities as any)}
          {select('kind', 'All kinds', sp.kind, facetOpts.filter((f) => f.facet === 'kind') as any)}
          {select('color', 'All colors', sp.color, facetOpts.filter((f) => f.facet === 'color') as any)}
          {select('artist', 'All artists', sp.artist, (artists as any[]).map((a) => ({ value: a.artist })))}
          <button className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800">Filter</button>
          {(sp.q || sp.rarity || sp.kind || sp.color || sp.artist) && (
            <Link href={qs({ q: undefined, rarity: undefined, kind: undefined, color: undefined, artist: undefined })} className="text-neutral-400 hover:text-white">
              clear
            </Link>
          )}
        </form>
      </div>

      <div className="mb-3 text-sm text-neutral-400">{cards.length} cards shown</div>

      {view === 'grid' && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
          {cards.map(tile)}
        </div>
      )}

      {(view === '9' || view === '12') && (
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {chunk(cards, view === '9' ? 9 : 12).map((page, i) => (
            <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
                Page {i + 1} of {Math.ceil(cards.length / (view === '9' ? 9 : 12))}
              </div>
              <div className={`grid gap-2 ${view === '9' ? 'grid-cols-3' : 'grid-cols-4'}`}>
                {page.map(tile)}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'print' && (
        <div className="mx-auto max-w-3xl rounded-xl bg-white p-6 text-black print:max-w-none print:rounded-none print:p-0">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-bold">
              {set.name} <span className="font-normal text-neutral-500">({set.code?.toUpperCase()}) — {stats.total} cards</span>
            </div>
            <PrintButton />
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="w-8 py-1"></th>
                <th className="w-14 py-1">#</th>
                <th className="py-1">Name</th>
                <th className="py-1">Rarity</th>
                <th className="w-16 py-1 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} className="border-b border-neutral-300">
                  <td className="py-0.5 text-center">{c.owned ? '☑' : '☐'}</td>
                  <td className="py-0.5">{c.collector_number}</td>
                  <td className="py-0.5">{c.name}</td>
                  <td className="py-0.5">{c.rarity_raw}</td>
                  <td className="py-0.5 text-right">{c.usd != null ? `$${c.usd.toFixed(2)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

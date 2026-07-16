// A single binder rendered as the physical book: pages chunked to cols x rows pockets, paired
// into two-page spreads, first spread being [cover | page 1]. The cover shows launch art —
// the binder's majority set's logo (sets.logo_url: pokemon official logos, mtg highest-value
// card fallback) — so it reads like the real folder's front. cols x rows configurable 1-12.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';

export const dynamic = 'force-dynamic';

const clampDim = (raw: string | undefined, fallback: number) =>
  Math.min(12, Math.max(1, parseInt(raw ?? '', 10) || fallback));
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

type Slot = { id: string; name: string; image_small: string | null; quantity: number; finish: string };

export default async function BinderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string; r?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const cols = clampDim(sp.c, 3);
  const rows = clampDim(sp.r, 3);

  const [binder] = await client`select id, name, kind from containers where id = ${id}`;
  if (!binder) notFound();

  const cardsRaw = (await client`
    select c.id, c.name, c.image_small, h.quantity, h.finish, c.sort_key, s.code as set_code
    from holdings h
    join cards c on c.id = h.card_id
    join sets s on s.id = c.set_id
    where h.container_id = ${id}
    order by s.code, c.sort_key, c.collector_number`) as unknown as (Slot & { sort_key: number; set_code: string })[];

  // cover art = logo of the set most represented in this binder
  const [cover] = await client`
    select s.logo_url, s.name
    from holdings h join cards c on c.id = h.card_id join sets s on s.id = c.set_id
    where h.container_id = ${id} and s.logo_url is not null
    group by s.id
    order by sum(h.quantity) desc
    limit 1`;

  const POCKET_W = 96;
  const pages: (Slot[] | 'cover')[] = ['cover', ...chunk(cardsRaw, cols * rows)];
  const spreads = chunk(pages, 2);
  const pageW = cols * POCKET_W + (cols - 1) * 4;
  const pocketGrid = { display: 'grid', gap: 4, gridTemplateColumns: `repeat(${cols}, ${POCKET_W}px)` } as const;
  const totalCards = cardsRaw.reduce((n, c) => n + c.quantity, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-neutral-400">
            <Link href="/binders" className="hover:text-white">Binders</Link> · {binder.kind}
          </div>
          <h1 className="text-2xl font-bold">{binder.name}</h1>
        </div>
        <form method="get" className="flex items-center gap-1 text-xs text-neutral-400">
          <input type="number" name="c" min={1} max={12} defaultValue={cols} className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5" />
          cols ×
          <input type="number" name="r" min={1} max={12} defaultValue={rows} className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5" />
          rows
          <button className="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800">Apply</button>
        </form>
      </div>
      <div className="mb-4 text-sm text-neutral-400">{totalCards} cards · {cardsRaw.length} slots</div>

      <div className="overflow-x-auto pb-2">
        <div className="flex flex-wrap gap-x-10 gap-y-8">
          {spreads.map((spread, si) => (
            <div key={si} className="flex items-stretch gap-1.5">
              {spread.map((page, pi) => {
                const pageNo = si * 2 + pi;
                return (
                  <div key={pi} className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900 p-2">
                    <div className="mb-1.5 text-xs uppercase tracking-wide text-neutral-500">
                      {pageNo === 0 ? 'Cover' : `Page ${pageNo} of ${pages.length - 1}`}
                    </div>
                    {page === 'cover' ? (
                      <div
                        style={{ width: pageW }}
                        className="flex flex-1 flex-col items-center justify-center gap-2 rounded border border-neutral-800 bg-neutral-950 p-3 text-center"
                      >
                        {cover?.logo_url ? (
                          <img src={cover.logo_url} alt="" className="max-h-40 max-w-full object-contain" />
                        ) : (
                          <span className="text-xs uppercase tracking-widest text-neutral-600">{binder.name}</span>
                        )}
                      </div>
                    ) : (
                      <div style={pocketGrid}>
                        {page.map((c, k) => (
                          <Link key={`${c.id}-${c.finish}-${k}`} href={`/card/${encodeURIComponent(c.id)}`} className="relative block overflow-hidden rounded">
                            {c.image_small ? (
                              <img src={c.image_small} alt={c.name} loading="lazy" className="w-full" />
                            ) : (
                              <div className="flex aspect-[5/7] items-center justify-center bg-neutral-800 p-1 text-center text-[8px] text-neutral-400">
                                {c.name}
                              </div>
                            )}
                            {c.quantity > 1 && (
                              <span className="absolute right-0.5 top-0.5 rounded-full bg-neutral-950/90 px-1 text-[9px] font-bold">
                                ×{c.quantity}
                              </span>
                            )}
                          </Link>
                        ))}
                        {Array.from({ length: cols * rows - page.length }, (_, k) => (
                          <div key={`e${k}`} className="aspect-[5/7] rounded border border-dashed border-neutral-800" />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

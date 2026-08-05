// A single binder, computed live from `containers.filter jsonb`.
// Bindrs own no holdings; the page applies the filter to the non-deck catalogue and pages
// the result by the binder's chosen sort. Cover art is the logo of the most-represented
// set within the filter result. Edit model: holders are NOT shown here (binders are
// read-only); to move cards into a deck, use the deck page.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';
import { search } from '../../../src/search.ts';
import SortBar from '../../components/SortBar.tsx';
import CardSurface from '../../components/CardSurface.tsx';
import RenameContainer from '../../components/RenameContainer.tsx';
import AddCardToContainer from '../../components/AddCardToContainer.tsx';
import { BTN_SECONDARY } from '../../components/chip.ts';

export const dynamic = 'force-dynamic';

const clampDim = (raw: string | undefined, fallback: number) =>
  Math.min(12, Math.max(1, parseInt(raw ?? '', 10) || fallback));
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export default async function BinderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string; r?: string; sort?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [binder] = await client`
    select id, name, kind, pocket_cols, pocket_rows, filter
    from containers where id = ${id}`;
  if (!binder) notFound();
  const cols = clampDim(sp.c, Number(binder.pocket_cols) || 3);
  const rows = clampDim(sp.r, Number(binder.pocket_rows) || 3);

  const cards = await search({ type: 'binder', containerId: id, filter: binder.filter as any }, '', {
    sort: sp.sort,
    limit: 5000,
  });

  // cover art = logo of the set most represented in this binder's filter result
  const [cover] = binder.filter && cards.length
    ? await client`
        select s.logo_url, s.name, count(*)::int as n
        from cards c join sets s on s.id = c.set_id
        where s.logo_url is not null
          and c.set_id = any(${(binder.filter as any).set_ids ?? []}::text[])
        group by s.id
        order by n desc
        limit 1`
    : [];

  const POCKET_W = 96;
  const cardSlots: typeof cards = [...cards];
  const pages: (typeof cards | 'cover')[] = ['cover', ...chunk(cardSlots, cols * rows)];
  const spreads = chunk(pages, 2);
  const pageW = cols * POCKET_W + (cols - 1) * 4;
  const pocketGrid = { display: 'grid', gap: 4, gridTemplateColumns: `repeat(${cols}, ${POCKET_W}px)` } as const;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-neutral-400">
            <Link href="/binders" className="hover:text-white">Binders</Link> · {binder.kind}
          </div>
          <h1 className="flex items-center gap-1 text-2xl font-bold">
            {binder.name}
            {binder.id !== 'unsorted' && <RenameContainer id={binder.id} name={binder.name} />}
          </h1>
          <div className="mt-2"><AddCardToContainer containerId={id} /></div>
        </div>
        <form method="get" className="flex items-center gap-1 text-xs text-neutral-400">
          <input type="number" name="c" min={1} max={12} defaultValue={cols} className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5" />
          cols ×
          <input type="number" name="r" min={1} max={12} defaultValue={rows} className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5" />
          rows
          <button className={BTN_SECONDARY}>Apply</button>
        </form>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-neutral-400">{cards.length} cards</div>
        <SortBar />
      </div>

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
                        {page.map((c) => (
                          <div key={c.id} className="relative">
                            <CardSurface
                              card={{ ...c, imageSmall: c.image_small } as any}
                              setIconUrl={c.set_icon_url}
                              container={{ kind: 'binder', id }}
                            />
                          </div>
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

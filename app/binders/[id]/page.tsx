// A single binder rendered as the physical book: pages chunked to cols x rows pockets, paired
// into two-page spreads, first spread being [cover | page 1]. The cover shows launch art —
// the binder's majority set's logo (sets.logo_url: pokemon official logos, mtg highest-value
// card fallback) — so it reads like the real folder's front. cols x rows configurable 1-12.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';
import { orderFragment, SORT_FIELDS } from '../../../src/sort.ts';
import SortBar from '../../components/SortBar.tsx';
import VanillaCard from '../../components/VanillaCard.tsx';
import RenameContainer from '../../components/RenameContainer.tsx';
import HoldingEditor from '../../components/HoldingEditor.tsx';
import AddCardToContainer from '../../components/AddCardToContainer.tsx';

export const dynamic = 'force-dynamic';

const clampDim = (raw: string | undefined, fallback: number) =>
  Math.min(12, Math.max(1, parseInt(raw ?? '', 10) || fallback));
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

type Slot = { id: string; name: string; image_small: string | null; quantity: number; finish: string; binder_position: number | null; condition: string | null; paid: string | null; held_since: string | null };

export default async function BinderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string; r?: string; sort?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [binder] = await client`select id, name, kind, pocket_cols, pocket_rows from containers where id = ${id}`;
  if (!binder) notFound();
  const cols = clampDim(sp.c, Number(binder.pocket_cols) || 3);
  const rows = clampDim(sp.r, Number(binder.pocket_rows) || 3);
  const order = orderFragment(SORT_FIELDS, sp.sort);

  const containers = (await client`select id, name, kind from containers order by kind, name`) as unknown as
    { id: string; name: string; kind: string }[];

  const cardsRaw = (await client`
    select c.id, c.name, c.image_small, h.quantity, h.finish, h.binder_position, h.condition, h.paid::text as paid, h.held_since::text as held_since, c.sort_key, s.code as set_code
    from holdings h
    join cards c on c.id = h.card_id
    join sets s on s.id = c.set_id
    left join card_facets cc on cc.card_id = c.id and cc.facet = 'color_combo'
    where h.container_id = ${id}
    order by ${order ?? client`h.binder_position nulls last, s.code, c.sort_key, c.collector_number`}`) as unknown as (Slot & { sort_key: number; set_code: string })[];

  // cover art = logo of the set most represented in this binder
  const [cover] = await client`
    select s.logo_url, s.name
    from holdings h join cards c on c.id = h.card_id join sets s on s.id = c.set_id
    where h.container_id = ${id} and s.logo_url is not null
    group by s.id
    order by sum(h.quantity) desc
    limit 1`;

  const POCKET_W = 96;
  const positioned = !order && cardsRaw.some((c) => c.binder_position !== null);
  const cardSlots: (Slot | null)[] = positioned
    ? Array.from({ length: Math.max(...cardsRaw.map((c) => c.binder_position ?? 0)) + 1 }, () => null)
    : [...cardsRaw];
  if (positioned) {
    for (const card of cardsRaw) {
      if (card.binder_position !== null) cardSlots[card.binder_position] = card;
    }
  }
  const pages: ((Slot | null)[] | 'cover')[] = ['cover', ...chunk(cardSlots, cols * rows)];
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
          <button className="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800">Apply</button>
        </form>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-neutral-400">{totalCards} cards · {cardsRaw.length} slots</div>
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
                        {page.map((c, k) => c ? (
                          <div key={`${c.id}-${c.finish}-${k}`} className="relative">
                            <div className="absolute right-0.5 top-0.5 z-10">
                              <HoldingEditor
                                cardId={c.id} finish={c.finish} containerId={id}
                                quantity={c.quantity} condition={c.condition} paid={c.paid}
                                containers={containers}
                              />
                            </div>
                            <Link href={`/card/${encodeURIComponent(c.id)}`} className="block">
                              <VanillaCard card={{ name: c.name, imageSmall: c.image_small, owned: true, quantity: c.quantity, finish: c.finish }} />
                            </Link>
                            {c.held_since && (
                              <div className="absolute bottom-0.5 left-0.5 rounded bg-neutral-900/80 px-1 text-[10px] text-neutral-400" title="Acquired">
                                {c.held_since}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div key={`gap-${k}`} className="aspect-[5/7] rounded border border-dashed border-neutral-800" />
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

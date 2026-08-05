import Link from 'next/link';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';
import { holdCte } from '../../../src/ownership.ts';
import ComboSlicer from '../../components/ComboSlicer.tsx';
import FilterSidebar, { type FilterGroup } from '../../components/FilterSidebar.tsx';
import CardTile from '../../components/CardTile.tsx';
import SortBar from '../../components/SortBar.tsx';
import { orderFragment, SORT_FIELDS } from '../../../src/sort.ts';
import PrintButton from './print-button.tsx';

export const dynamic = 'force-dynamic';

// Collections set checklist: Grid + Print only, read-only ownership (derived from binders/
// decks). The physical binder-book view now lives on the Binders page, per binder container.
type SP = { view?: string; rarity?: string; kind?: string; combo?: string | string[]; cmc?: string | string[]; q?: string; sort?: string };
const toArr = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);
type Card = {
  id: string; name: string; collector_number: string; rarity_raw: string | null;
  image_small: string | null; artist: string | null; finishes: string[];
  owned_finishes: string[]; owned: boolean; for_play: boolean; usd: number | null;
  set_nonfoil: number; set_foil: number; deck_nonfoil: number; deck_foil: number; func_total: number;
};

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
  const combos = toArr(sp.combo);
  const cmcs_sel = toArr(sp.cmc);
  const order = orderFragment(SORT_FIELDS, sp.sort);

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

  // per-card ownership breakdown by finish bucket (nonfoil vs anything foil-ish), split by
  // whether the copy sits in a deck container; plus the functional total across every printing
  // sharing this card's oracle identity. Drives the ring, the finish badges, the foil sheen,
  // and the per-card indicator strip.
  const cards = (await client`
    with ${holdCte},
    oracle_total as (
      select c.oracle_id, sum(coalesce(hd.set_nonfoil,0) + coalesce(hd.set_foil,0))::int as total
      from cards c left join hold hd on hd.card_id = c.id
      where c.oracle_id is not null
      group by c.oracle_id
    )
    select c.id, c.name, c.collector_number, c.rarity_raw, c.image_small, c.artist, c.finishes,
           coalesce(hd.owned_finishes, '{}') as owned_finishes,
           coalesce(hd.owned_finishes, '{}') <> '{}' as owned,
           coalesce(hd.set_nonfoil, 0) as set_nonfoil,
           coalesce(hd.set_foil, 0) as set_foil,
           coalesce(hd.deck_nonfoil, 0) as deck_nonfoil,
           coalesce(hd.deck_foil, 0) as deck_foil,
           coalesce(ot.total, 0) as func_total,
           (hd.card_id is null and ot.total > 0) as for_play,
           p.usd::float as usd
    from cards c
    left join hold hd on hd.card_id = c.id
    left join oracle_total ot on ot.oracle_id = c.oracle_id
    left join card_facets cc on cc.card_id = c.id and cc.facet = 'color_combo'
    left join lateral (
      select usd from prices p where p.card_id = c.id
      order by (p.finish = 'nonfoil') desc, p.as_of desc limit 1
    ) p on true
    where c.set_id = ${id}
    ${sp.rarity ? client`and c.rarity_raw = ${sp.rarity}` : client``}
    ${sp.q ? client`and c.name ilike ${'%' + sp.q + '%'}` : client``}
    ${sp.kind ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'kind' and f.value = ${sp.kind})` : client``}
    ${combos.length ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'color_combo' and f.value = any(${combos}))` : client``}
    ${cmcs_sel.length ? client`and c.attrs->>'cmc' = any(${cmcs_sel})` : client``}
    order by ${order ?? client`c.sort_key, c.collector_number`}`) as unknown as Card[];

  // colour is the exact colour COMBO (mono-R excludes R/W), sorted by WUBRG-length then count
  const facetOpts = await client`
    select f.facet, f.value, count(*)::int as n
    from card_facets f join cards c on c.id = f.card_id
    where c.set_id = ${id} and f.facet in ('color_combo', 'kind')
    group by 1, 2 order by 1, length(f.value), 3 desc`;
  const rarities = await client`
    select rarity_raw as value, count(*)::int as n
    from cards where set_id = ${id} and rarity_raw is not null
    group by 1 order by 2 desc`;
  const cmcs = await client`
    select c.attrs->>'cmc' as value, count(*)::int as n
    from cards c
    where c.set_id = ${id} and c.game_id = 'mtg' and c.attrs->>'cmc' is not null
    group by 1 order by (c.attrs->>'cmc')::numeric`;

  const pct = stats.total ? Math.round((100 * stats.owned) / stats.total) : 0;

  const comboOpts = facetOpts.filter((f) => f.facet === 'color_combo').map((f) => ({ value: f.value as string, n: f.n as number }));
  const kindOpts = facetOpts
    .filter((f) => f.facet === 'kind')
    .map((f) => ({ value: f.value, label: f.value, n: f.n }))
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.label.localeCompare(b.label));
  const slicers: FilterGroup[] = [
    { name: 'rarity', label: 'Rarity', current: sp.rarity, options: (rarities as any[]).map((r) => ({ value: r.value, label: r.value, n: r.n })) },
    { name: 'kind', label: 'Kind', current: sp.kind, options: kindOpts },
    ...(set.game_id !== 'mtg' && comboOpts.length ? [{ name: 'combo', label: 'Colour combo', current: combos, multi: true, rawLabel: true, options: comboOpts.map((c) => ({ value: c.value, label: c.value, n: c.n })) }] : []),
    ...(cmcs.length ? [{ name: 'cmc', label: 'Mana value', current: cmcs_sel, multi: true, rawLabel: true, options: (cmcs as any[]).map((c) => ({ value: c.value, label: c.value, n: c.n })) }] : []),
  ];
  const displayGroups: FilterGroup[] = [
    { name: 'view', label: 'Display', current: view === 'grid' ? '' : view, options: [{ value: 'print', label: 'Print' }] },
  ];

  // Collections is read-only ownership: the ring is derived from what's in your binders/decks,
  // not toggled here (that lives on each container's detail page — add/move/edit holdings). ring: emerald
  // = this exact printing owned somewhere, amber-dashed = "For Play" (owned under a different
  // printing, per oracle_id), grey = neither. Owned foils get the holographic sheen.
  // "For trade" = copies of this printing beyond one kept + what's committed to decks.
  const tile = (c: Card) => (
    <CardTile
      key={c.id}
      card={{ id: c.id, name: c.name, imageSmall: c.image_small, owned: c.owned, forPlay: c.for_play, foil: c.set_foil > 0 }}
      metaLeft={`#${c.collector_number}`}
      metaRight={c.usd != null ? `$${c.usd.toFixed(2)}` : undefined}
      ownership={c.owned ? { funcTotal: c.func_total, setNonfoil: c.set_nonfoil, setFoil: c.set_foil, deckNonfoil: c.deck_nonfoil, deckFoil: c.deck_foil } : undefined}
      setIconUrl={set.icon_url}
      game={set.game_id}
    />
  );


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
          {cards.some((c) => c.for_play) && (
            <div className="mt-1 text-amber-400">◐ dashed = have this card, different printing</div>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        <FilterSidebar
          display={displayGroups}
          search={{ name: 'q', value: sp.q, placeholder: 'card name…' }}
          slicers={slicers}
          customSlicers={set.game_id === 'mtg' && comboOpts.length ? <ComboSlicer options={comboOpts} current={combos} /> : undefined}
          clearHref={`/set/${encodeURIComponent(id)}`}
        />

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-neutral-400">{cards.length} cards shown</div>
            <SortBar price />
          </div>

          {view === 'grid' && (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]">
              {cards.map(tile)}
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
                      <td className="py-0.5 text-center">{c.owned ? '☑' : c.for_play ? '◐' : '☐'}</td>
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
      </div>
    </div>
  );
}

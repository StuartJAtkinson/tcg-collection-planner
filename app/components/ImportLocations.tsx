import { client } from '../../src/db/index.ts';
import { setContainerKind } from '../../src/actions.ts';
import DeselectableRadio from './DeselectableRadio.tsx';

// Part of the Import flow: review the location each imported Collectr portfolio was filed into.
// Import presumes binder (>100 cards) vs deck (≤100); this is where you override. Leaving a
// portfolio with neither selected drops it to the unsorted collection. Renders nothing when
// there are no import-derived portfolios (a clean slate), so it only appears when relevant.
export default async function ImportLocations() {
  const containers = await client`
    select ct.id, ct.name, ct.kind, coalesce(sum(h.quantity), 0)::int as total_cards
    from containers ct left join holdings h on h.container_id = ct.id
    where ct.id <> 'unsorted'
    group by ct.id order by total_cards desc`;
  if (!containers.length) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-2 text-lg font-semibold text-neutral-300">Import locations</h2>
      <p className="mb-3 max-w-3xl text-sm text-neutral-400">
        Each imported portfolio was presumed a <span className="text-emerald-300">Binder</span> (&gt;100 cards) or{' '}
        <span className="text-sky-300">Deck</span> (≤100). Override below; leave neither and it drops to the unsorted
        collection. Resolving a portfolio&apos;s unmatched cards routes them to the same place.
      </p>
      <form action={setContainerKind} className="max-w-3xl">
        <input type="hidden" name="ids" value={containers.map((c) => c.id).join(',')} />
        <div className="mb-3 grid gap-1.5">
          {containers.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm">
              <span className="w-48 shrink-0 truncate">{c.name}</span>
              <span className="w-24 shrink-0 text-xs text-neutral-500">{c.total_cards} cards</span>
              <div className="flex gap-1.5">
                {(['binder', 'deck'] as const).map((k) => (
                  <label key={k} className="cursor-pointer rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-500/10 has-[:checked]:text-emerald-300">
                    <DeselectableRadio name={`kind_${c.id}`} value={k} defaultChecked={c.kind === k} className="sr-only" />
                    {k[0].toUpperCase() + k.slice(1)}
                  </label>
                ))}
                {c.kind !== 'binder' && c.kind !== 'deck' && (
                  <span className="self-center text-[10px] uppercase text-neutral-600">unsorted</span>
                )}
              </div>
            </div>
          ))}
        </div>
        <button className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">Apply locations</button>
      </form>
    </section>
  );
}

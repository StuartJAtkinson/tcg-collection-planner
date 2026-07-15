import Link from 'next/link';

// Standardized filter panel used across Search / Collections / Decks. A plain GET <form>, so
// nothing applies until the sticky Apply button is pressed (click-to-apply, not laggy live
// toggling). Fixed order everywhere: Display settings → text search → slicers → collapsible
// "Other" (rarely-browsed facets like illustrator). Single-select slicers as radio chips,
// each with an "Any" reset option.

export type FilterOpt = { value: string; label: string; n?: number };
// rawLabel: don't proper-case (for codes like colour combos "WR" or mana values "3", which
// proper-casing would mangle to "Wr")
export type FilterGroup = { name: string; label: string; options: FilterOpt[]; current?: string; rawLabel?: boolean };

const properCase = (s: string) =>
  s.replace(/\w[^\s/-]*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

function ChipGroup({ group }: { group: FilterGroup }) {
  const current = group.current ?? '';
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{group.label}</div>
      <div className="flex flex-wrap gap-1.5">
        {[{ value: '', label: 'Any' }, ...group.options].map((o) => (
          <label
            key={o.value}
            className="cursor-pointer rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-300 hover:border-neutral-500 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-500/10 has-[:checked]:text-emerald-300"
          >
            <input type="radio" name={group.name} value={o.value} defaultChecked={current === o.value} className="sr-only" />
            {o.value === '' ? o.label : group.rawLabel ? o.label : properCase(o.label)}
            {'n' in o && o.n ? <span className="text-neutral-500"> {o.n}</span> : null}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function FilterSidebar({
  action,
  display,
  search,
  slicers,
  other,
  hidden,
  clearHref,
}: {
  action?: string;
  display?: FilterGroup[];
  search?: { name: string; value?: string; placeholder?: string };
  slicers?: FilterGroup[];
  other?: FilterGroup[];
  hidden?: Record<string, string | undefined>;
  clearHref?: string;
}) {
  return (
    <form
      method="get"
      action={action}
      className="no-print flex w-56 shrink-0 flex-col self-start rounded-xl border border-neutral-800 bg-neutral-900/50"
    >
      <div className="flex-1 overflow-y-auto p-3">
        {hidden &&
          Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}

        {/* 1. Display */}
        {display?.map((g) => <ChipGroup key={g.name} group={g} />)}

        {/* 2. Text search */}
        {search && (
          <div className="mb-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Search</div>
            <input
              type="search"
              name={search.name}
              defaultValue={search.value ?? ''}
              placeholder={search.placeholder ?? 'name…'}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
            />
          </div>
        )}

        {/* 3. Slicers */}
        {slicers?.map((g) => <ChipGroup key={g.name} group={g} />)}

        {/* 4. Other (collapsed) */}
        {other && other.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-300">
              Other
            </summary>
            <div className="mt-2">{other.map((g) => <ChipGroup key={g.name} group={g} />)}</div>
          </details>
        )}
      </div>

      {/* sticky Apply */}
      <div className="sticky bottom-0 flex items-center gap-2 rounded-b-xl border-t border-neutral-800 bg-neutral-900 p-2">
        <button className="flex-1 rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
          Apply
        </button>
        {clearHref && (
          <Link href={clearHref} className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-400 hover:text-white">
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}

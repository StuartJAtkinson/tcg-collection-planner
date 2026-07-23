import React from 'react';
import FilterApply from './FilterApply.tsx';

// Standardized filter panel used across Search / Collections / Decks. A plain GET <form>, so
// nothing applies until the sticky Apply button is pressed (click-to-apply, not laggy live
// toggling). Fixed order everywhere: Display settings → text search → slicers → collapsible
// "Other" (rarely-browsed facets like illustrator). Single-select slicers as radio chips,
// each with an "Any" reset option. Apply greys out when nothing in the form differs from the
// current URL, so a passive chip-state never triggers a pointless navigation.

export type FilterOpt = { value: string; label: string; n?: number };
// rawLabel: don't proper-case (for codes like mana values "3", which would mangle to "Wr").
// manaSymbols: render each character of the value as a real MTG mana symbol (the same Mana
// font the MockCard uses), so a colour combo "WR" shows white+red pips instead of text.
// multi: checkbox multiselect (any number) instead of single-select radios; `current` is a
// list. No "Any" chip — nothing checked means no filter.
export type FilterGroup = {
  name: string; label: string; options: FilterOpt[];
  current?: string | string[]; rawLabel?: boolean; manaSymbols?: boolean; multi?: boolean;
};

const properCase = (s: string) =>
  s.replace(/\w[^\s/-]*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

function OptLabel({ opt, group }: { opt: FilterOpt; group: FilterGroup }) {
  if (opt.value === '') return <>{opt.label}</>;
  if (group.manaSymbols) {
    return (
      <span className="inline-flex items-center gap-0.5 align-middle">
        {[...opt.value].map((ch, i) => <i key={i} className={`ms ms-cost ms-${ch.toLowerCase()} text-[13px]`} />)}
      </span>
    );
  }
  return <>{group.rawLabel ? opt.label : properCase(opt.label)}</>;
}

function ChipGroup({ group }: { group: FilterGroup }) {
  const current = new Set(Array.isArray(group.current) ? group.current : group.current ? [group.current] : []);
  const opts = group.multi ? group.options : [{ value: '', label: 'Any' }, ...group.options];
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{group.label}</div>
      <div className="flex flex-wrap gap-1.5">
        {opts.map((o) => (
          <label
            key={o.value}
            className="cursor-pointer rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-300 hover:border-neutral-500 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-500/10 has-[:checked]:text-emerald-300"
          >
            <input
              type={group.multi ? 'checkbox' : 'radio'}
              name={group.name}
              value={o.value}
              defaultChecked={group.multi ? current.has(o.value) : current.size ? current.has(o.value) : o.value === ''}
              className="sr-only"
            />
            <OptLabel opt={o} group={group} />
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
  customSlicers,
  other,
  hidden,
  clearHref,
}: {
  action?: string;
  display?: FilterGroup[];
  search?: { name: string; value?: string; placeholder?: string };
  slicers?: FilterGroup[];
  customSlicers?: import('react').ReactNode; // interactive client slicers (e.g. ComboSlicer)
  other?: FilterGroup[];
  hidden?: Record<string, string | undefined>;
  clearHref?: string;
}) {
  const formId = React.useId();
  return (
    <form
      id={formId}
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
        {customSlicers}

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

      {/* sticky Apply (with dirty check) */}
      <div className="sticky bottom-0 flex items-center gap-2 rounded-b-xl border-t border-neutral-800 bg-neutral-900 p-2">
        <FilterApply formId={formId} searchName={search?.name} clearHref={clearHref} />
      </div>
    </form>
  );
}

'use client';
import { useState } from 'react';
import type { FilterGroup } from './FilterSidebar.tsx';
import { fmtN } from '../format.ts';
import { CHIP_PLUS, CHIP_MINUS, CHIP_NEUTRAL } from './chip.ts';

// Tri-state chip group: each chip cycles neutral → + → − → neutral on click. The current
// state of the whole group is rendered as a hidden form input per chip carrying the signed
// value (`+W`, `-WU`). The form submits the hidden inputs verbatim. Subset state is local to
// the group — when the URL changes via Apply, the server re-renders with new defaults.
//
// `-` is only meaningful when at least one `+` exists in the same group; the server still
// honours `-` alone but the AND-of-+s is empty so no rows match.
//
// Layout: 2-col grid. Count badge truncates with `…` when a label is long enough to overflow
// its half-width column (e.g. "Enchantment 10174"); the grid keeps the row aligned.

type State = '+' | '-' | 'off';

export default function TriStateChipGroup({ group }: { group: FilterGroup }) {
  const initial: Record<string, State> = {};
  const cur = Array.isArray(group.current) ? group.current : group.current ? [group.current] : [];
  for (const v of cur) {
    if (v.startsWith('+')) initial[v.slice(1)] = '+';
    else if (v.startsWith('-')) initial[v.slice(1)] = '-';
  }
  const [sel, setSel] = useState<Record<string, State>>(initial);

  const cycle = (val: string) =>
    setSel((prev) => {
      const cur = prev[val] ?? 'off';
      const next: Record<string, State> = { ...prev };
      if (cur === 'off') next[val] = '+';
      else if (cur === '+') next[val] = '-';
      else delete next[val];
      return next;
    });

  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{group.label}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {group.options.map((o) => {
          const s = sel[o.value] ?? 'off';
          const cls = s === '+' ? CHIP_PLUS : s === '-' ? CHIP_MINUS : CHIP_NEUTRAL;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => cycle(o.value)}
              aria-pressed={s !== 'off'}
              title={`${o.label} — ${s === '+' ? 'include' : s === '-' ? 'exclude' : 'off'}`}
              className={cls}
            >
              <span className="flex min-w-0 items-center gap-1">
                {s !== 'off' && <span className="font-bold">{s}</span>}
                <span className="truncate">{o.label}</span>
              </span>
              {'n' in o && o.n ? <span className="shrink-0 overflow-hidden text-ellipsis tabular-nums text-neutral-500">{fmtN(o.n)}</span> : null}
            </button>
          );
        })}
      </div>
      {Object.entries(sel).map(([v, s]) =>
        s === 'off' ? null : <input key={`${s}${v}`} type="hidden" name={group.name} value={`${s}${v}`} />,
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { fmtN } from '../format.ts';
import { CHIP_PLUS, CHIP_NEUTRAL, CHIP_MINUS } from './chip.ts';

// Colour-combo multiselect. Both left- and right-click cycle the same tri-state per chip:
// off → + (include) → − (exclude) → off. Right-click used to mean "select this combo plus its
// colour-identity subsets"; cycling matches TriStateChipGroup so a muscle-memory user sees
// the same behaviour regardless of which slicer they grabbed. Excludes are only useful when
// paired with at least one include — the server treats an all-exclude query as empty — but
// the UI lets you set either freely and Apply will just return nothing.
//
// Sort: buckets by combo length; within a bucket combos are ordered by canonical WUBRG.
// Colourless (C) is also length 1 but appears FIRST (before the mono colours). Multi-colour
// buckets (dual/tri/quad/all) use canonical WUBRG only.
//
// Column counts (matching Stuart's spec):
//   1-colour  (6)  : 3 cols × 2 rows
//   2-colour  (10) : 2 cols × 5 rows
//   3-colour  (10) : 2 cols × 5 rows
//   4-colour  (5)  : 1 col
//   5-colour  (1)  : 1 col

const WUBRG = 'WUBRG';
const COLOUR_NAME: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' };
const canonicalName = (combo: string) => [...combo].map((c) => COLOUR_NAME[c] ?? c).join(', ');
const sortCombo = (s: string) =>
  [...s].filter((c) => WUBRG.includes(c)).sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('');

// Render order for a combo's letters: Colourless → W → U → B → R → G for mono, then any
// multi-colour combo sorted by canonical WUBRG. Used to position C in the Mono bucket ahead
// of the coloured monos.
function comboRank(s: string): string {
  if (s === 'C') return '!'; // sort before W
  if (s.length === 1) return sortCombo(s);
  return sortCombo(s);
}

function bucket(options: { value: string; n: number }[]) {
  const byLen: Record<number, typeof options> = {};
  for (const o of options) (byLen[o.value.length] ??= []).push(o);
  for (const k of Object.keys(byLen)) {
    byLen[Number(k)].sort((a, b) => comboRank(a.value).localeCompare(comboRank(b.value)));
  }
  return [1, 2, 3, 4, 5].map((len) => ({ len, items: byLen[len] ?? [] })).filter((b) => b.items.length > 0);
}

const COLS: Record<number, string> = {
  1: 'grid-cols-3',
  2: 'grid-cols-2',
  3: 'grid-cols-2',
  4: 'grid-cols-1',
  5: 'grid-cols-1',
};
const LABEL: Record<number, string> = {
  1: 'Mono',
  2: 'Dual',
  3: 'Tri',
  4: 'Quad',
  5: 'All',
};

type State = '+' | '-' | 'off';

export default function ComboSlicer({
  options,
  current,
}: {
  options: { value: string; n: number }[];
  current: string[];
}) {
  const initial: Record<string, State> = {};
  for (const v of current) {
    if (v.startsWith('+')) initial[v.slice(1)] = '+';
    else if (v.startsWith('-')) initial[v.slice(1)] = '-';
    else if (v) initial[v] = '+';
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

  const buckets = bucket(options);

  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Colour combo</div>
      {Object.entries(sel).map(([v, s]) =>
        s === 'off' ? null : <input key={`${s}${v}`} type="hidden" name="combo" value={`${s}${v}`} />,
      )}
      <div className="divide-y divide-neutral-800">
        {buckets.map((b) => (
          <div key={b.len} className="py-1.5">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">{LABEL[b.len]}</div>
            <div className={`grid gap-1.5 ${COLS[b.len]}`}>
              {b.items.map((o) => {
                const s = sel[o.value] ?? 'off';
                const cls = s === '+' ? CHIP_PLUS : s === '-' ? CHIP_MINUS : CHIP_NEUTRAL;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => cycle(o.value)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      cycle(o.value);
                    }}
                    title={`${canonicalName(o.value)} — ${s === '+' ? 'include' : s === '-' ? 'exclude' : 'off'}; click or right-click to cycle`}
                    aria-pressed={s !== 'off'}
                    className={cls}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      {s !== 'off' && <span className="font-bold">{s}</span>}
                      <span className="inline-flex shrink-0 items-center gap-0.5">
                        {[...o.value].map((ch, i) => (
                          <i key={i} className={`ms ms-cost ms-${ch.toLowerCase()} text-[12px]`} />
                        ))}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] tabular-nums text-neutral-500">{fmtN(o.n)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

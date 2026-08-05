'use client';

import { useState } from 'react';
import { fmtN } from '../format.ts';
import { CHIP_PLUS, CHIP_NEUTRAL } from './chip.ts';

// Colour-combo multiselect with a right-click "colour identity" shortcut. Left-click toggles a
// single combo. Right-click a combo SETS the selection to that combo plus every combo it
// encapsulates — a tri like URG selects {U,R,G, UR,UG,RG, URG}. It replaces (not adds) so
// right-clicking a different tri afterward drops the non-applicable ones. Colourless (C) is a
// separate single chip, never pulled in by a coloured combo's subsets. Renders each combo as
// real MTG mana symbols (the Mana font the MockCard uses).
//
// Layout: bucketed by combo length, dividers between buckets. Within a bucket, combos are
// sorted by canonical WUBRG order. Column counts (matching Stuart's spec):
//   1-colour  (6)  : 3 cols × 2 rows
//   2-colour  (10) : 2 cols × 5 rows
//   3-colour  (10) : 2 cols × 5 rows
//   4-colour  (5)  : 1 col
//   5-colour  (1)  : 1 col

const WUBRG = 'WUBRG';
const COLOUR_NAME: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' };
const canonicalName = (combo: string) => [...combo].map((c) => COLOUR_NAME[c] ?? c).join(', ');
const sortCombo = (s: string) =>
  [...s].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('');

// every non-empty subset of a combo's colour letters, in WUBRG-sorted codes (incl. the combo
// itself); colourless carries no coloured letters so it yields nothing
function subsetsOf(combo: string): Set<string> {
  const letters = [...combo].filter((c) => WUBRG.includes(c));
  const out = new Set<string>();
  for (let mask = 1; mask < 1 << letters.length; mask++) {
    let s = '';
    for (let i = 0; i < letters.length; i++) if (mask & (1 << i)) s += letters[i];
    out.add(sortCombo(s));
  }
  return out;
}

// Bucket every combo by its length; within a bucket, colourless first then canonical WUBRG
// order. Missing buckets (no card has, say, "5-colour only" in catalogue) simply don't render.
function bucket(options: { value: string; n: number }[]) {
  const byLen: Record<number, typeof options> = {};
  for (const o of options) (byLen[o.value.length] ??= []).push(o);
  for (const k of Object.keys(byLen)) {
    byLen[Number(k)].sort((a, b) => {
      // C (colourless) sorts before any coloured combo
      const aC = a.value === 'C', bC = b.value === 'C';
      if (aC !== bC) return aC ? -1 : 1;
      return sortCombo(a.value).localeCompare(sortCombo(b.value));
    });
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

export default function ComboSlicer({
  options,
  current,
}: {
  options: { value: string; n: number }[];
  current: string[];
}) {
  const [sel, setSel] = useState(() => new Set(current));
  const present = new Set(options.map((o) => o.value));

  const toggle = (v: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  const setToSubsets = (v: string) =>
    setSel(new Set([...subsetsOf(v)].filter((x) => present.has(x))));

  const buckets = bucket(options);

  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Colour combo</div>
      {[...sel].map((v) => (
        <input key={v} type="hidden" name="combo" value={v} />
      ))}
      <div className="divide-y divide-neutral-800">
        {buckets.map((b) => (
          <div key={b.len} className="py-1.5">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-600">{LABEL[b.len]}</div>
            <div className={`grid gap-1.5 ${COLS[b.len]}`}>
              {b.items.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setToSubsets(o.value);
                  }}
                  title={`${canonicalName(o.value)} — left-click toggle, right-click select subsets`}
                  className={sel.has(o.value) ? CHIP_PLUS : CHIP_NEUTRAL}
                >
                  <span className="inline-flex shrink-0 items-center gap-0.5">
                    {[...o.value].map((ch, i) => (
                      <i key={i} className={`ms ms-cost ms-${ch.toLowerCase()} text-[12px]`} />
                    ))}
                  </span>
                  <span className="ml-auto text-[10px] tabular-nums text-neutral-500">{fmtN(o.n)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

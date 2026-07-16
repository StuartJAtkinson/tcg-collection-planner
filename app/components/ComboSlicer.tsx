'use client';

import { useState } from 'react';

// Colour-combo multiselect with a right-click "colour identity" shortcut. Left-click toggles a
// single combo. Right-click a combo SETS the selection to that combo plus every combo it
// encapsulates — a tri like URG selects {U,R,G, UR,UG,RG, URG}. It replaces (not adds) so
// right-clicking a different tri afterward drops the non-applicable ones. Colourless (C) is a
// separate single chip, never pulled in by a coloured combo's subsets. Renders each combo as
// real MTG mana symbols (the Mana font the MockCard uses).

const WUBRG = 'WUBRG';
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

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        <span>Colour combo</span>
        <span className="text-[9px] normal-case text-neutral-600">right-click = subsets</span>
      </div>
      {[...sel].map((v) => (
        <input key={v} type="hidden" name="combo" value={v} />
      ))}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            onContextMenu={(e) => {
              e.preventDefault();
              setToSubsets(o.value);
            }}
            title={`${o.value} — left-click toggle, right-click select subsets`}
            className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs ${
              sel.has(o.value)
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            }`}
          >
            <span className="inline-flex items-center gap-0.5 align-middle">
              {[...o.value].map((ch, i) => (
                <i key={i} className={`ms ms-cost ms-${ch.toLowerCase()} text-[13px]`} />
              ))}
            </span>
            <span className="text-neutral-500"> {o.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

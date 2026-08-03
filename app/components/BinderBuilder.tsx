'use client';

import { useMemo, useState } from 'react';
import { createFunctionalBinder } from '../../src/actions.ts';

export type BinderCandidate = {
  id: string;
  name: string;
  finish: string;
  quantity: number;
  image: string | null;
  set: string;
  setCode: string;
  collectorNumber: string;
  sortKey: number;
  color: string;
  rarity: string;
  kind: string;
  manaValue: number | null;
};

type Field = keyof Pick<BinderCandidate, 'color' | 'rarity' | 'kind' | 'manaValue' | 'name' | 'set' | 'collectorNumber'>;
type Rule = { field: Field; pageBreak: boolean };

const OPTIONS: { field: Field; label: string }[] = [
  { field: 'color', label: 'Colour combo' },
  { field: 'rarity', label: 'Rarity' },
  { field: 'kind', label: 'Kind' },
  { field: 'manaValue', label: 'Mana value' },
  { field: 'name', label: 'Alphabetical' },
  { field: 'set', label: 'Set' },
  { field: 'collectorNumber', label: 'Collector number' },
];
const label = (field: Field) => OPTIONS.find((o) => o.field === field)?.label ?? field;
const value = (card: BinderCandidate, field: Field) => {
  if (field === 'collectorNumber') return `${card.setCode}\0${String(card.sortKey).padStart(10, '0')}`;
  if (field === 'manaValue') return card.manaValue ?? Number.MAX_SAFE_INTEGER;
  return card[field] || '—';
};

export default function BinderBuilder({ cards, defaultName }: { cards: BinderCandidate[]; defaultName: string }) {
  const [rules, setRules] = useState<Rule[]>([
    { field: 'color', pageBreak: true },
    { field: 'kind', pageBreak: false },
    { field: 'name', pageBreak: false },
  ]);
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [dragged, setDragged] = useState<number | null>(null);
  const pageSize = cols * rows;

  const arranged = useMemo(() => {
    const sorted = [...cards].sort((a, b) => {
      for (const rule of rules) {
        const av = value(a, rule.field);
        const bv = value(b, rule.field);
        const n = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
        if (n) return n;
      }
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
    const slots: (BinderCandidate | null)[] = [];
    let previous: BinderCandidate | undefined;
    for (const card of sorted) {
      if (previous && rules.some((r) => r.pageBreak && value(previous!, r.field) !== value(card, r.field))) {
        while (slots.length % pageSize) slots.push(null);
      }
      slots.push(card);
      previous = card;
    }
    return slots;
  }, [cards, pageSize, rules]);

  const pages = Array.from({ length: Math.ceil(arranged.length / pageSize) }, (_, i) =>
    arranged.slice(i * pageSize, (i + 1) * pageSize),
  );
  const orderedIds = arranged.flatMap((c, position) => c ? [`${position}\t${c.id}\t${c.finish}`] : []);

  const moveRule = (from: number, to: number) => {
    if (from === to || to < 0 || to >= rules.length) return;
    setRules((old) => {
      const next = [...old];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <form action={createFunctionalBinder} className="self-start rounded-xl border border-neutral-800 bg-neutral-900 p-4 xl:sticky xl:top-4">
        <h2 className="border-b border-neutral-800 pb-1 text-lg font-semibold text-neutral-300">Functional binder</h2>
        <p className="mt-1 text-sm text-neutral-400">Drag fields into priority order. Remove any grouping you do not need.</p>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Binder name
          <input required name="name" defaultValue={defaultName}
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white" />
        </label>
        <div className="mt-3 flex gap-2">
          <label className="text-xs text-neutral-400">Columns
            <input name="cols" type="number" min={1} max={12} value={cols} onChange={(e) => setCols(Math.max(1, Math.min(12, +e.target.value)))}
              className="ml-1 w-14 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-white" />
          </label>
          <label className="text-xs text-neutral-400">Rows
            <input name="rows" type="number" min={1} max={12} value={rows} onChange={(e) => setRows(Math.max(1, Math.min(12, +e.target.value)))}
              className="ml-1 w-14 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-white" />
          </label>
        </div>

        <div className="mt-5 space-y-2">
          {rules.map((rule, i) => (
            <div key={rule.field} draggable
              onDragStart={() => setDragged(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragged !== null) moveRule(dragged, i); setDragged(null); }}
              className="flex cursor-grab items-center gap-2 rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm active:cursor-grabbing">
              <span className="text-neutral-600" aria-hidden>⠿</span>
              <span className="min-w-0 flex-1">{label(rule.field)}</span>
              <label className="flex items-center gap-1 text-[11px] text-neutral-400" title="Start this group on a fresh page">
                <input type="checkbox" checked={rule.pageBreak}
                  onChange={(e) => setRules((old) => old.map((r, n) => n === i ? { ...r, pageBreak: e.target.checked } : r))} />
                page break
              </label>
              <button type="button" onClick={() => setRules((old) => old.filter((_, n) => n !== i))}
                className="rounded px-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-300" aria-label={`Remove ${label(rule.field)}`}>×</button>
            </div>
          ))}
        </div>

        {rules.length < OPTIONS.length && (
          <select value="" onChange={(e) => {
            const field = e.target.value as Field;
            if (field) setRules((old) => [...old, { field, pageBreak: false }]);
          }} className="mt-2 w-full rounded border border-dashed border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-400">
            <option value="">+ Add sort field…</option>
            {OPTIONS.filter((o) => !rules.some((r) => r.field === o.field)).map((o) =>
              <option key={o.field} value={o.field}>{o.label}</option>)}
          </select>
        )}

        <input type="hidden" name="rules" value={JSON.stringify(rules)} />
        <input type="hidden" name="ordered" value={JSON.stringify(orderedIds)} />
        <div className="mt-5 rounded border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
          {cards.length.toLocaleString()} unsorted holdings → {pages.length.toLocaleString()} pages ·{' '}
          {arranged.filter((c) => c === null).length.toLocaleString()} deliberate empty pockets
        </div>
        <button disabled={!cards.length}
          className="mt-3 w-full rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
          Create binder and file cards
        </button>
      </form>

      <section className="min-w-0">
        <div className="mb-3 flex items-baseline justify-between border-b border-neutral-800 pb-1">
          <h2 className="text-lg font-semibold text-neutral-300">Page preview</h2>
          <span className="text-xs text-neutral-500">Only loose cards in Unsorted Collection are included</span>
        </div>
        {pages.length === 0 ? <p className="text-sm text-neutral-500">There are no unsorted cards to file.</p> : (
          <div className="flex flex-wrap gap-5">
            {pages.map((page, pi) => (
              <div key={pi} className="rounded-lg border border-neutral-800 bg-neutral-900 p-2">
                <div className="mb-1.5 text-xs uppercase tracking-wide text-neutral-500">Page {pi + 1}</div>
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 72px)` }}>
                  {Array.from({ length: pageSize }, (_, si) => {
                    const card = page[si];
                    return card ? (
                      <div key={`${card.id}-${card.finish}`} className="group relative aspect-[5/7] overflow-hidden rounded bg-neutral-800" title={`${card.name} · ${card.set}`}>
                        {card.image ? <img src={card.image} alt={card.name} loading="lazy" className="h-full w-full object-cover" /> :
                          <div className="flex h-full items-center justify-center p-1 text-center text-[8px]">{card.name}</div>}
                        <div className="absolute inset-x-0 bottom-0 truncate bg-black/80 px-1 py-0.5 text-[7px] opacity-0 group-hover:opacity-100">{card.name}</div>
                        {card.quantity > 1 && <span className="absolute right-0.5 top-0.5 rounded bg-black/85 px-1 text-[8px] font-bold">×{card.quantity}</span>}
                      </div>
                    ) : <div key={`empty-${si}`} className="aspect-[5/7] rounded border border-dashed border-neutral-700 bg-neutral-950/40" />;
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

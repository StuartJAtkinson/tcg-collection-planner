'use client';
import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CHIP_NEUTRAL } from './chip.ts';

// Fixed slot row — one chip per field, in display order. A chip is either empty (no entry in
// the current sort), ascending (↑, added by clicking the empty chip), or descending (↓,
// second click flips). Third click empties the slot. Drag a chip to reorder; the visible
// position IS the precedence. The row never grows; empty slots stay visible at a fixed size
// so the bar's height stays constant.
//
// Why Apply gates the navigation: live re-sort on every click re-fetches the (expensive)
// first page and has crashed during earlier sessions. Staging defers navigation to one
// Apply click. The current URL remains the source of truth — the stage buffer is seeded
// from `?sort=` and committed wholesale.
//
// Wire format: ?sort=name.a,rarity.d — comma-separated field.direction pairs, in precedence order.

const FIELDS: { f: string; label: string; price?: boolean }[] = [
  { f: 'name', label: 'Name' },
  { f: 'set', label: 'Set' },
  { f: 'number', label: 'Number' },
  { f: 'rarity', label: 'Rarity' },
  { f: 'mv', label: 'Mana' },
  { f: 'color', label: 'Colour' },
  { f: 'price', label: 'Price', price: true },
];

type Dir = 'a' | 'd';
type Term = { f: string; d: Dir };

const parse = (raw: string | null): Term[] =>
  (raw ?? '')
    .split(',')
    .filter(Boolean)
    .map((t) => {
      const [f, d] = t.split('.');
      return { f, d: d === 'd' ? 'd' : 'a' } as Term;
    });

const orderFromTerms = (terms: Term[], fields: typeof FIELDS): string[] => {
  const present = new Set(terms.map((t) => t.f));
  const fromFields = fields.filter((fl) => present.has(fl.f)).map((fl) => fl.f);
  const extras = terms.filter((t) => !fields.some((fl) => fl.f === t.f)).map((t) => t.f);
  return [...fromFields, ...extras];
};

const dirsFromTerms = (terms: Term[]): Record<string, Dir> =>
  Object.fromEntries(terms.map((t) => [t.f, t.d]));

export default function SortBar({ price = false }: { price?: boolean }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Memoize so deps of the seed effect stay stable across renders.
  const fields = React.useMemo(() => (price ? FIELDS : FIELDS.filter((x) => !x.price)), [price]);

  // Single state object: order = visible sequence, dirs = {field: dir|undefined}.
  // Fields appear in `order` once they're non-empty; the empty slot is the first available
  // field not in `order` and is rendered as a dashed "+" button at the tail.
  const initialSort = sp.get('sort') ?? '';
  const [order, setOrder] = useState<string[]>(() => orderFromTerms(parse(initialSort), fields));
  const [dirs, setDirs] = useState<Record<string, Dir>>(() => dirsFromTerms(parse(initialSort)));

  // Re-seed when the URL changes (after Apply navigates). Effect, not render-phase setState,
  // so StrictMode double-invokes don't thrash.
  const sortKey = sp.get('sort') ?? '';
  const lastSeed = useRef(sortKey);
  useEffect(() => {
    if (lastSeed.current === sortKey) return;
    lastSeed.current = sortKey;
    const terms = parse(sortKey);
    setOrder(orderFromTerms(terms, fields));
    setDirs(dirsFromTerms(terms));
  }, [sortKey, fields]);

  // Dirty must compare in the SAME order on both sides: staged is from `order` (display),
  // so re-derive the URL terms in display order too. Otherwise drag-reordering would make
  // `dirty` true forever even when the URL semantically matches.
  const urlTerms = parse(sortKey);
  const urlInDisplayOrder = order
    .map((f) => urlTerms.find((t) => t.f === f) ?? null)
    .filter((t): t is Term => t !== null);
  const staged: Term[] = order
    .map((f) => (dirs[f] ? { f, d: dirs[f] } : null))
    .filter((t): t is Term => t !== null);
  const dirty = JSON.stringify(urlInDisplayOrder) !== JSON.stringify(staged);

  const apply = () => {
    const params = new URLSearchParams(sp.toString());
    if (staged.length) params.set('sort', staged.map((t) => `${t.f}.${t.d}`).join(','));
    else params.delete('sort');
    router.push(`${pathname}?${params}`);
  };

  const clear = () => {
    setOrder([]);
    setDirs({});
  };

  // Atomic slot cycle. Empty → asc → desc → empty (empty removes the field from order).
  // Mid-cycle asc→desc leaves the slot's position alone; only the desc→empty step drops it
  // from `order`. Reading `prevOrder` here is safe — the setOrder updater runs in the next
  // commit, and we only enqueue an update when the order actually changes.
  const cycleSlot = (f: string) => {
    setDirs((prevDirs) => {
      const cur = prevDirs[f];
      const nextDirs = { ...prevDirs };
      if (!cur) nextDirs[f] = 'a';
      else if (cur === 'a') nextDirs[f] = 'd';
      else delete nextDirs[f];
      if (!cur) {
        setOrder((prevOrder) => (prevOrder.includes(f) ? prevOrder : [...prevOrder, f]));
      } else if (cur === 'd') {
        setOrder((prevOrder) => prevOrder.filter((x) => x !== f));
      }
      return nextDirs;
    });
  };

  const moveSlot = (from: number, to: number) => {
    setOrder((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to > prev.length) return prev;
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(Math.min(to, next.length), 0, m);
      return next;
    });
  };

  // HTML5 drag-and-drop. Drag a filled slot onto another slot (filled or empty) to reorder.
  const dragIdx = useRef<number | null>(null);
  const dragged = useRef(false);
  const onDragStart = (i: number) => (e: React.DragEvent) => {
    dragIdx.current = i;
    dragged.current = false;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onDropSlot = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIdx.current;
    dragged.current = true;
    dragIdx.current = null;
    if (from != null && from !== i) moveSlot(from, i);
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (dragged.current) {
      dragged.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  // Single chip family: every chip — selected, unselected, Apply, Clear — uses the same
  // canonical CHIP_NEUTRAL class imported from ./chip.ts. Selected chips show the
  // precedence index (no fill, no color change). Unselected chips are visibly dashed
  // (border-style only, not a color). One visual vocabulary on the page.
  const selected = fields.filter((fl) => order.includes(fl.f));
  const unselected = fields.filter((fl) => !order.includes(fl.f));
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {selected.map((fl, i) => {
        const d = dirs[fl.f];
        const arrow = d === 'd' ? '↓' : '↑';
        return (
          <button
            key={fl.f}
            type="button"
            draggable
            onDragStart={onDragStart(i)}
            onDragOver={onDragOver}
            onDrop={onDropSlot(i)}
            onClickCapture={onClickCapture}
            onClick={() => cycleSlot(fl.f)}
            title={`${fl.label} ${arrow} — drag to reorder, click to flip/remove`}
            className={`cursor-move ${CHIP_NEUTRAL}`}
          >
            <span className="cursor-move text-neutral-500" title="Drag to reorder">≡</span>
            <span className="tabular-nums text-neutral-500">{i + 1}</span>
            <span>{fl.label}</span>
            <span className="text-neutral-400">{arrow}</span>
          </button>
        );
      })}
      {unselected.length > 0 && selected.length > 0 && (
        <span className="mx-0.5 h-4 w-px bg-neutral-700" aria-hidden />
      )}
      {unselected.map((fl) => (
        <button
          key={fl.f}
          type="button"
          onClick={() => cycleSlot(fl.f)}
          title={`Add ${fl.label} ascending`}
          className={CHIP_NEUTRAL}
        >
          {fl.label}
        </button>
      ))}
      <button
        type="button"
        onClick={apply}
        disabled={!dirty}
        className={CHIP_NEUTRAL}
      >
        Apply
      </button>
      <button type="button" onClick={clear} className={CHIP_NEUTRAL}>
        Clear
      </button>
    </div>
  );
}

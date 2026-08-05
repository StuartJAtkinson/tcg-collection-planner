'use client';
import { useEffect, useState } from 'react';
import { addHolding } from '../../src/actions.ts';
import { BTN_PRIMARY, BTN_SECONDARY } from './chip.ts';

type Hit = { id: string; name: string; set_code: string; image_small: string | null };

// "+ Add card" on a container detail page: search the catalogue (reusing /api/search) and add a
// hit straight into this container. Finish defaults server-side to the card's primary finish;
// tune finish/quantity afterwards with the per-card ⋯ editor. Adds quantity 1 by default.
export default function AddCardToContainer({ containerId }: { containerId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setHits([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((cards: Hit[]) => setHits(cards.slice(0, 8)))
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, open]);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={BTN_SECONDARY}
      >
        + Add card
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search cards to add…"
              className="mb-2 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
            />
            <div className="max-h-72 overflow-y-auto">
              {q.trim().length < 2 && <p className="px-1 text-xs text-neutral-500">Type at least 2 characters.</p>}
              {q.trim().length >= 2 && hits.length === 0 && <p className="px-1 text-xs text-neutral-500">No matches.</p>}
              {hits.map((h) => (
                <form key={h.id} action={addHolding} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-neutral-800">
                  <input type="hidden" name="container_id" value={containerId} />
                  <input type="hidden" name="card_id" value={h.id} />
                  {h.image_small
                    ? <img src={h.image_small} alt="" className="h-10 w-7 shrink-0 rounded object-cover" />
                    : <div className="h-10 w-7 shrink-0 rounded bg-neutral-800" />}
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {h.name} <span className="uppercase text-neutral-500">{h.set_code}</span>
                  </span>
                  <button className={BTN_PRIMARY}>Add</button>
                </form>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

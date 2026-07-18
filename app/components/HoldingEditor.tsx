'use client';
import { useState } from 'react';
import { moveHolding, updateHolding } from '../../src/actions.ts';

export type ContainerOption = { id: string; name: string; kind: string };

// Per-holding editor: a small ⋯ button overlaid on a card in a container view. Opens a popover
// to move the card to another container, edit its quantity/condition/paid, or remove it. Keyed
// by (card, finish, container) — the holding's composite identity — since there's no row id.
export default function HoldingEditor({
  cardId, finish, containerId, quantity, condition, paid, containers,
}: {
  cardId: string; finish: string; containerId: string;
  quantity: number; condition: string | null; paid: string | null;
  containers: ContainerOption[];
}) {
  const [open, setOpen] = useState(false);
  const targets = containers.filter((c) => c.id !== containerId);
  const keys = (
    <>
      <input type="hidden" name="card_id" value={cardId} />
      <input type="hidden" name="finish" value={finish} />
    </>
  );

  return (
    <span className="relative inline-block">
      <button
        type="button"
        title="Edit holding"
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        className="rounded bg-neutral-950/80 px-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-xs shadow-xl">
            {/* edit quantity / condition / paid */}
            <form action={updateHolding} className="mb-2 flex flex-col gap-1.5 border-b border-neutral-800 pb-2">
              {keys}
              <input type="hidden" name="container_id" value={containerId} />
              <label className="flex items-center justify-between gap-2">
                Qty
                <input name="quantity" type="number" min={0} defaultValue={quantity} className="w-20 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1" />
              </label>
              <label className="flex items-center justify-between gap-2">
                Condition
                <input name="condition" defaultValue={condition ?? ''} placeholder="—" className="w-28 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1" />
              </label>
              <label className="flex items-center justify-between gap-2">
                Paid
                <input name="paid" defaultValue={paid ?? ''} placeholder="—" className="w-20 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1" />
              </label>
              <button className="rounded bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-500">Save</button>
              <span className="text-[10px] text-neutral-500">Qty 0 removes it from this container.</span>
            </form>

            {/* move to another container */}
            {targets.length > 0 ? (
              <form action={moveHolding} className="flex flex-col gap-1.5">
                {keys}
                <input type="hidden" name="from" value={containerId} />
                <select name="to" defaultValue={targets[0].id} className="rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1">
                  {targets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.kind})
                    </option>
                  ))}
                </select>
                <button className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800">Move here</button>
              </form>
            ) : (
              <p className="text-neutral-500">No other container to move to.</p>
            )}
          </div>
        </>
      )}
    </span>
  );
}

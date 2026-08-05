'use client';
import { useState } from 'react';
import { renameContainer } from '../../src/actions.ts';
import { BTN_PRIMARY } from './chip.ts';

// Inline rename for a container detail page: the title stays server-rendered; this adds a small
// ✎ button beside it that pops a name field (same popover feel as NewContainer/DeleteContainer).
export default function RenameContainer({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        title="Rename"
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
      >
        ✎
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
            <form action={renameContainer} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={id} />
              <input
                name="name"
                autoFocus
                required
                maxLength={100}
                defaultValue={name}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
              />
              <button className={BTN_PRIMARY}>Save</button>
            </form>
          </div>
        </>
      )}
    </span>
  );
}

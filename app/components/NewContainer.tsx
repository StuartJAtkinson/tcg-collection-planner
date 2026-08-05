'use client';
import { useState } from 'react';
import { createContainer } from '../../src/actions.ts';
import { BTN_PRIMARY } from './chip.ts';

// "New binder" / "New deck" button for the top of the Binders / Decks pages. Click reveals a
// small inline name field (same popover feel as DeleteContainer); submitting creates the empty
// container and jumps into it. kind is fixed per placement — no game/kind picker to fuss with.
export default function NewContainer({ kind }: { kind: 'binder' | 'deck' }) {
  const [open, setOpen] = useState(false);
  const label = kind === 'binder' ? 'binder' : 'deck';
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={BTN_PRIMARY}
      >
        + New {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
            <form action={createContainer} className="flex flex-col gap-2">
              <input type="hidden" name="kind" value={kind} />
              <input
                name="name"
                autoFocus
                required
                maxLength={100}
                placeholder={`${label[0].toUpperCase() + label.slice(1)} name`}
                className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
              />
              <button className={BTN_PRIMARY}>
                Create {label}
              </button>
            </form>
          </div>
        </>
      )}
    </span>
  );
}

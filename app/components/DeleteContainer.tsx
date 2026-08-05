'use client';
import { useState } from 'react';
import { deleteContainer } from '../../src/actions.ts';
import { BTN_DANGER, BTN_SECONDARY } from './chip.ts';

// Trash-can button → a small popover offering the two ways to delete a binder/deck:
//  · Keep in collection — its cards move to the unsorted pool
//  · Delete completely — its cards are removed outright
// Each choice is a real form submit to the deleteContainer action.
export default function DeleteContainer({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        title="Delete"
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
      >
        🗑
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-left text-xs shadow-xl">
            <div className="mb-2 truncate px-1 text-neutral-400">Delete “{name}”?</div>
            <form action={deleteContainer}>
              <input type="hidden" name="id" value={id} />
              <button name="mode" value="keep" className={`mb-1 block w-full ${BTN_SECONDARY}`}>
                Keep in collection <span className="text-neutral-500">→ unsorted</span>
              </button>
              <button name="mode" value="delete" className={`block w-full ${BTN_DANGER}`}>
                Delete completely
              </button>
            </form>
          </div>
        </>
      )}
    </span>
  );
}

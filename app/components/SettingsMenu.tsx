'use client';

import Link from 'next/link';
import { useState } from 'react';

// Top-right settings cog: a small dropdown gathering dev/debug pages (MockCard preview, etc.)
// so they don't clutter the main nav. Client component only for the open/close toggle.
const DEV_PAGES: [string, string][] = [['/preview', 'MockCard preview']];

export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        className="rounded-full border border-neutral-700 px-2 py-1 text-neutral-300 hover:border-neutral-500 hover:text-white"
      >
        ⚙
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-lg">
            <div className="px-3 py-1 text-xs uppercase tracking-wide text-neutral-500">Dev pages</div>
            {DEV_PAGES.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="block px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
              >
                {label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

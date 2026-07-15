import './globals.css';
import { readdirSync, readFileSync } from 'node:fs';
import Link from 'next/link';
import type { ReactNode } from 'react';
import SettingsMenu from './components/SettingsMenu.tsx';

export const metadata = {
  title: 'Card Collector',
  description: 'Catalogue-first TCG collection tracker',
};

// total unresolved rows across every *-unmatched.csv (minus their header line)
function unresolvedCount(): number {
  let n = 0;
  for (const f of readdirSync(process.cwd()).filter((f) => f.endsWith('-unmatched.csv'))) {
    try {
      const lines = readFileSync(f, 'utf8').split('\n').filter((l) => l.trim());
      n += Math.max(0, lines.length - 1);
    } catch {}
  }
  return n;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const unresolved = unresolvedCount();
  return (
    <html lang="en">
      <head>
        {/* self-hosted MTG mana symbol font (mana-font, MIT) — /public/mana.min.css +
            /public/fonts/mana.woff2, trimmed to a single woff2 @font-face, no CDN dependency */}
        <link rel="stylesheet" href="/mana.min.css" />
      </head>
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <header className="no-print sticky top-0 z-30 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
          <nav className="flex items-center gap-6 px-6 py-2">
            <Link href="/" className="text-lg font-bold tracking-tight">Card Collector</Link>
            {/* primary sections: Search, Collections (games are tabs under it), Binders and
                Decks (physical containers, not game-split) */}
            <Link href="/search" className="text-neutral-300 hover:text-white">Search</Link>
            <Link href="/" className="text-neutral-300 hover:text-white">Collections</Link>
            <Link href="/binders" className="text-neutral-300 hover:text-white">Binders</Link>
            <Link href="/decks" className="text-neutral-300 hover:text-white">Decks</Link>
            <Link href="/advisor" className="text-neutral-300 hover:text-white">Advisor</Link>

            <div className="ml-auto flex items-center gap-3">
              <Link
                href="/resolve"
                className="flex items-center gap-1.5 rounded-full border border-amber-500/60 px-3 py-1 text-sm text-amber-300 hover:border-amber-400 hover:text-amber-200"
              >
                Import
                {unresolved > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-xs font-bold text-neutral-950">
                    {unresolved}
                  </span>
                )}
              </Link>
              <SettingsMenu />
            </div>
          </nav>
        </header>
        <main className="px-6 py-6">{children}</main>
      </body>
    </html>
  );
}

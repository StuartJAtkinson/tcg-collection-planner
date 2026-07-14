import './globals.css';
import { readdirSync } from 'node:fs';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { client } from '../src/db/index.ts';

export const metadata = {
  title: 'Card Collector',
  description: 'Catalogue-first TCG collection tracker',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const games = await client`select id, name from games order by id`;
  const hasUnmatched = readdirSync(process.cwd()).some((f) => f.endsWith('-unmatched.csv'));
  return (
    <html lang="en">
      <head>
        {/* self-hosted MTG mana symbol font (mana-font, MIT) — /public/mana.min.css +
            /public/fonts/mana.woff2, trimmed to a single woff2 @font-face, no CDN dependency */}
        <link rel="stylesheet" href="/mana.min.css" />
      </head>
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <header className="no-print sticky top-0 z-10 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
          <nav className="flex items-center gap-6 px-6 py-2">
            <Link href="/" className="text-lg font-bold tracking-tight">Card Collector</Link>
            {games.map((g) => (
              <Link key={g.id} href={`/g/${g.id}`} className="text-neutral-300 hover:text-white">
                {g.name}
              </Link>
            ))}
            {hasUnmatched && (
              <Link href="/resolve" className="ml-auto text-amber-400 hover:text-amber-300">
                Resolve unmatched imports
              </Link>
            )}
          </nav>
        </header>
        <main className="px-6 py-6">{children}</main>
      </body>
    </html>
  );
}

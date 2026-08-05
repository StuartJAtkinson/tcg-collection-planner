import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { client } from '../src/db/index.ts';
import { CHIP_NEUTRAL } from './components/chip.ts';
import NavLinks from './components/NavLinks.tsx';

export const metadata = {
  title: 'Card Collector',
  description: 'Catalogue-first TCG collection tracker',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [{ n: unresolved }] = (await client`
    select count(*)::int as n from import_unmatched where user_id = 'stuart'`) as unknown as { n: number }[];
  return (
    <html lang="en">
      <head>
        {/* self-hosted MTG mana symbol font (mana-font, MIT) — /public/mana.min.css +
            /public/fonts/mana.woff2, trimmed to a single woff2 @font-face, no CDN dependency */}
        <link rel="stylesheet" href="/mana.min.css" />
      </head>
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <header className="no-print sticky top-0 z-30 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
          <nav className="flex items-center gap-4 px-6">
            <Link href="/" className="mr-2 py-2 text-lg font-bold tracking-tight">Card Collector</Link>
            <NavLinks />

            <div className="ml-auto flex items-center gap-3 py-2">
              <Link href="/resolve" className={CHIP_NEUTRAL}>
                Import
                {unresolved > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-xs font-bold text-neutral-950">
                    {unresolved}
                  </span>
                )}
              </Link>
              <Link href="/preview" className={CHIP_NEUTRAL} title="MockCard preview">▦</Link>
            </div>
          </nav>
        </header>
        <main className="px-6 py-6">{children}</main>
      </body>
    </html>
  );
}

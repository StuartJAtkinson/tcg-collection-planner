import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { client } from '../src/db/index.ts';

export const metadata = {
  title: 'Card Collector',
  description: 'Catalogue-first TCG collection tracker',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const games = await client`select id, name from games order by id`;
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <header className="no-print sticky top-0 z-10 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">Card Collector</Link>
            {games.map((g) => (
              <Link key={g.id} href={`/g/${g.id}`} className="text-neutral-300 hover:text-white">
                {g.name}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

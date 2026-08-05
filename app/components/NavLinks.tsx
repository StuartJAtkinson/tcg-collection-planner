'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Header nav. Current page is highlighted with the same underlined-header treatment as the
// Collections game tabs: `border-b-2 border-emerald-500`. /g/[game] and /set/[id] highlight
// "Collections" so the parent section reads as active when a child is open.

const SECTIONS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/search', label: 'Search', match: (p) => p.startsWith('/search') },
  { href: '/', label: 'Collections', match: (p) => p === '/' || p.startsWith('/g/') || p.startsWith('/set/') },
  { href: '/binders', label: 'Binders', match: (p) => p.startsWith('/binders') },
  { href: '/decks', label: 'Decks', match: (p) => p.startsWith('/decks') },
  { href: '/advisor', label: 'Advisor', match: (p) => p.startsWith('/advisor') },
  { href: '/value', label: 'Value', match: (p) => p.startsWith('/value') },
];

export default function NavLinks() {
  const pathname = usePathname() ?? '/';
  return (
    <>
      {SECTIONS.map((s) => {
        const active = s.match(pathname);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? 'page' : undefined}
            className={`border-b-2 px-1 py-3 text-sm font-medium ${
              active
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-neutral-300 hover:text-white'
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </>
  );
}

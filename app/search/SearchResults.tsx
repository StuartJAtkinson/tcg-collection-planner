'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import VanillaCard from '../components/VanillaCard.tsx';
import type { SearchCard } from '../../src/search.ts';

const PAGE = 60;

// Infinite-scroll result grid. Server hands over the first page + the query string; an
// IntersectionObserver on the sentinel fetches the next page from /api/search as it nears view.
export default function SearchResults({ initial, query }: { initial: SearchCard[]; query: string }) {
  const [cards, setCards] = useState(initial);
  const [done, setDone] = useState(initial.length < PAGE);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // hold live values for the observer callback without re-subscribing
  const state = useRef({ cards, done, loading });
  state.current = { cards, done, loading };

  // reset when the query (server render) changes
  useEffect(() => {
    setCards(initial);
    setDone(initial.length < PAGE);
  }, [initial, query]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting) return;
      const s = state.current;
      if (s.done || s.loading) return;
      setLoading(true);
      const res = await fetch(`/api/search?${query}${query ? '&' : ''}offset=${s.cards.length}`);
      const next: SearchCard[] = await res.json();
      setCards((prev) => [...prev, ...next]);
      if (next.length < PAGE) setDone(true);
      setLoading(false);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  return (
    <>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
        {cards.map((c) => (
          <Link key={c.id} href={`/card/${encodeURIComponent(c.id)}`} className={c.owned ? '' : 'opacity-90'}>
            <VanillaCard card={{ name: c.name, imageSmall: c.image_small, owned: c.owned }} />
            <div className="mt-1 truncate text-sm">{c.name}</div>
            <div className="text-xs uppercase text-neutral-500">{c.set_code}</div>
          </Link>
        ))}
      </div>
      <div ref={sentinel} className="h-8" />
      {loading && <div className="py-4 text-center text-sm text-neutral-500">Loading…</div>}
    </>
  );
}

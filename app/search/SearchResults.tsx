'use client';

import { useEffect, useRef, useState } from 'react';
import CardTile from '../components/CardTile.tsx';
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
          <CardTile
            key={c.id}
            card={{ id: c.id, name: c.name, imageSmall: c.image_small, owned: c.owned, foil: c.any_foil }}
            metaLeft={<span className="uppercase">{c.set_code}</span>}
            metaRight={c.usd != null ? `$${c.usd.toFixed(2)}` : undefined}
            ownership={c.owned ? { funcTotal: c.func_total, totalFoil: c.any_foil, setNonfoil: c.set_nonfoil, setFoil: c.set_foil, deckNonfoil: c.deck_nonfoil, deckFoil: c.deck_foil } : undefined}
            setIconUrl={c.set_icon_url}
            game={c.game_id}
          />
        ))}
      </div>
      <div ref={sentinel} className="h-8" />
      {loading && <div className="py-4 text-center text-sm text-neutral-500">Loading…</div>}
    </>
  );
}

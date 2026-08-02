import type { ReactNode } from 'react';

// Reusable at-a-glance ownership sidebar, standard across set / search / card pages. A narrow
// vertical strip whose rows spread down the card's height (justify-between). Emoji-led rows:
//   🎴 total functional copies owned (across every printing of this card)
//   [set symbol] copies of THIS exact printing
//   🃏 copies committed to decks
//   🔁 copies of this printing free to trade (owned − in decks − 1 kept)
// A ✨ twinkle next to a number means a foil is involved. Rows with a zero count are omitted,
// so an unowned card shows nothing and a single number reads instantly. All fields but
// funcTotal are optional — search passes the oracle-level rollup (no single printing), the
// set/card pages pass the full per-printing breakdown.
export type OwnershipCounts = {
  funcTotal: number;
  totalFoil?: boolean; // owns a foil somewhere → twinkle the total row (defaults from set/deck foils)
  setNonfoil?: number; setFoil?: number; // this exact printing
  deckNonfoil?: number; deckFoil?: number; // in decks
};

export default function OwnershipStrip({
  counts,
  setIconUrl,
  game,
}: {
  counts: OwnershipCounts;
  setIconUrl?: string | null;
  game?: string | null;
}) {
  const setTotal = (counts.setNonfoil ?? 0) + (counts.setFoil ?? 0);
  const deckTotal = (counts.deckNonfoil ?? 0) + (counts.deckFoil ?? 0);
  const totalFoil = counts.totalFoil ?? ((counts.setFoil ?? 0) > 0 || (counts.deckFoil ?? 0) > 0);
  // this exact printing, beyond one kept for yourself and whatever's in decks
  const forTrade = Math.max(0, setTotal - deckTotal - 1);

  const setIcon: ReactNode = setIconUrl
    ? <img src={setIconUrl} alt="" className={`h-3.5 w-3.5 ${game === 'mtg' ? 'invert' : ''}`} />
    : '🔖';

  const rows: { key: string; icon: ReactNode; label: string; n: number; foil: boolean }[] = [
    counts.funcTotal > 0 && { key: 'total', icon: '🎴', label: 'copies owned (all printings)', n: counts.funcTotal, foil: totalFoil },
    setTotal > 0 && { key: 'set', icon: setIcon, label: 'this printing', n: setTotal, foil: (counts.setFoil ?? 0) > 0 },
    deckTotal > 0 && { key: 'deck', icon: '🃏', label: 'in decks', n: deckTotal, foil: (counts.deckFoil ?? 0) > 0 },
    forTrade > 0 && { key: 'trade', icon: '🔁', label: 'for trade (this printing, 1 kept)', n: forTrade, foil: false },
  ].filter(Boolean) as any;

  // always render the fixed-width bar (even with no rows) so every CardTile is the same width
  // and the image column lines up across owned and unowned cards
  if (!rows.length) return <div className="no-print w-9 shrink-0 self-stretch" aria-hidden />;
  return (
    <div className="no-print flex w-9 shrink-0 flex-col items-center justify-between self-stretch rounded bg-neutral-900/70 py-1.5 text-center">
      {rows.map((r) => (
        <div key={r.key} title={`${r.label}: ${r.n}${r.foil ? ' · incl. foil' : ''}`} className="flex flex-col items-center leading-none">
          <span className="flex h-4 items-center justify-center text-[13px]">{r.icon}</span>
          <span className="mt-0.5 text-xs font-semibold text-neutral-100">
            {r.n}
            {r.foil && <span className="text-amber-300">✨</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

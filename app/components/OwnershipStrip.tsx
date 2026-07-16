// Reusable ownership indicator strip — the Σ / set / deck / trade column shown alongside a
// card. Total is finish-agnostic (the functional card, per oracle_id); the rest split
// nonfoil/foil. "trade" = copies beyond one kept + what's committed to decks. Given raw
// holding counts it derives the trade rows itself.
export type OwnershipCounts = {
  funcTotal: number;
  setNonfoil: number;
  setFoil: number;
  deckNonfoil: number;
  deckFoil: number;
};

export default function OwnershipStrip({ counts }: { counts: OwnershipCounts }) {
  const tradeNonfoil = Math.max(0, counts.setNonfoil - counts.deckNonfoil - 1);
  const tradeFoil = Math.max(0, counts.setFoil - counts.deckFoil - 1);
  const rows: [string, string, string | null][] = [
    ['Σ', String(counts.funcTotal), null],
    ['set', String(counts.setNonfoil), String(counts.setFoil)],
    ['deck', String(counts.deckNonfoil), String(counts.deckFoil)],
    ['trade', String(tradeNonfoil), String(tradeFoil)],
  ];
  return (
    <div className="no-print flex w-9 shrink-0 flex-col justify-start gap-px rounded bg-neutral-900/70 py-0.5 text-center text-[8px] leading-tight text-neutral-400">
      {rows.map(([label, nf, f]) => (
        <div key={label} title={`${label}: nonfoil ${nf}${f != null ? ` · foil ${f}` : ''}`} className="px-0.5">
          <div className="uppercase text-neutral-600">{label}</div>
          <div className="text-neutral-200">
            {nf}
            {f != null && <span className="text-amber-400">/{f}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

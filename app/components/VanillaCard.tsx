import FoilCard from './FoilCard.tsx';

// Reusable "vanilla" card display — the real card image with the standard collection dressing:
// ownership ring (emerald = owned this exact printing, amber-dashed = For Play via a different
// printing), holographic sheen when a foil is owned, dark overlay + For Play badge when
// unowned. Used on the set grid, search, deck/binder views and the single-card page.
export type VanillaCardData = {
  name: string;
  imageSmall?: string | null;
  owned?: boolean;
  forPlay?: boolean;
  foil?: boolean;
  quantity?: number; // ×N badge (top-right) when > 1 — decks/binder pockets
  finish?: string | null; // finish badge (top-left) when not a plain nonfoil
};

const isFoilFinish = (f?: string | null) => !!f && f !== 'normal' && f !== 'nonfoil';

export default function VanillaCard({ card }: { card: VanillaCardData }) {
  return (
    <FoilCard
      foil={!!card.foil || isFoilFinish(card.finish)}
      className={`relative overflow-hidden rounded-lg ${
        card.owned ? 'ring-2 ring-emerald-500' : card.forPlay ? 'ring-2 ring-dashed ring-amber-500/70' : ''
      }`}
    >
      {card.imageSmall ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageSmall} alt={card.name} loading="lazy" className="w-full" />
      ) : (
        <div className="flex aspect-[5/7] items-center justify-center bg-neutral-800 p-2 text-center text-xs text-neutral-400">
          {card.name}
        </div>
      )}
      {!card.owned && !card.quantity && <div className="absolute inset-0 z-[3] bg-neutral-950/40" />}
      {isFoilFinish(card.finish) && (
        <span className="absolute left-1 top-1 z-[3] rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-950">
          {card.finish!.slice(0, 4)}
        </span>
      )}
      {(card.quantity ?? 0) > 1 && (
        <span className="absolute right-1 top-1 z-[3] rounded-full bg-neutral-950/90 px-1.5 py-0.5 text-xs font-bold">
          ×{card.quantity}
        </span>
      )}
      {card.forPlay && (
        <div className="no-print absolute bottom-1 left-1 right-1 z-[3] rounded bg-amber-500/90 px-1 py-0.5 text-center text-[9px] font-semibold uppercase text-neutral-950">
          For Play
        </div>
      )}
    </FoilCard>
  );
}

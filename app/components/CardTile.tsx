import Link from 'next/link';
import type { ReactNode } from 'react';
import VanillaCard, { type VanillaCardData } from './VanillaCard.tsx';
import OwnershipStrip, { type OwnershipCounts } from './OwnershipStrip.tsx';

// The one standard full-size card tile, used by the set checklist, Search and deck views:
// the card image (with its ring/foil/qty/finish dressing) + name + an optional meta row,
// linking to the single-card page, with the at-a-glance ownership strip alongside. The strip
// is always rendered (an empty fixed-width bar when unowned) so every tile is the same width
// and the images line up across a grid. Compact grids (binder pockets) use <VanillaCard>.
export default function CardTile({
  card,
  href,
  metaLeft,
  metaRight,
  ownership,
  setIconUrl,
  game,
}: {
  card: VanillaCardData & { id: string };
  href?: string;
  metaLeft?: ReactNode;
  metaRight?: ReactNode;
  ownership?: OwnershipCounts;
  setIconUrl?: string | null;
  game?: string | null;
}) {
  return (
    <div className={`flex gap-1 ${card.owned ? '' : 'opacity-90'}`}>
      <Link href={href ?? `/card/${encodeURIComponent(card.id)}`} className="min-w-0 flex-1">
        <VanillaCard card={card} />
        <div className="mt-1 truncate text-sm">{card.name}</div>
        {(metaLeft || metaRight) && (
          <div className="flex justify-between text-xs text-neutral-400">
            <span>{metaLeft}</span>
            <span>{metaRight}</span>
          </div>
        )}
      </Link>
      <OwnershipStrip counts={ownership ?? { funcTotal: 0 }} setIconUrl={setIconUrl} game={game} />
    </div>
  );
}

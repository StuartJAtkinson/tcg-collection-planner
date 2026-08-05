import Link from 'next/link';
import type { ReactNode } from 'react';
import VanillaCard, { type VanillaCardData } from './VanillaCard.tsx';
import OwnershipStrip, { type OwnershipCounts } from './OwnershipStrip.tsx';
import MockCard from './MockCard.tsx';
import { cardToMockFaces, type MockCardSource } from './cardToMockFaces.ts';

// Uniform card surface used everywhere a card is rendered in the app:
//   /search, /set/[id], /binders/[id], /decks/[id], /preview, /card/[id].
//
// Slots:
//   - identity + art (always)
//   - enumeration + "for play" indicator (driven by container)
//   - printings sidebar (mtg only; future for pokemon)
//
// Dispatch:
//   showPrintings && game === 'mtg' → <MockCard> with art_crop + per-face rules
//   else → <VanillaCard> with the standard dressing (ring, foil sheen, ×N, finish badge)
//
// The ownership strip is always mounted when showSidebar is set, with a fixed-width
// placeholder when no rows qualify (so the grid columns line up across owned/unowned cards).

export type CardSurfaceContainer = { kind: 'binder' | 'deck' | 'all'; id?: string };

export type CardSurfaceData = VanillaCardData &
  MockCardSource & {
    id: string;
  };

export type CardSurfaceProps = {
  card: CardSurfaceData;
  ownership?: OwnershipCounts;
  setIconUrl?: string | null;
  href?: string;
  metaLeft?: ReactNode;
  metaRight?: ReactNode;
  container?: CardSurfaceContainer;
  showSidebar?: boolean; // default true outside preview
  showPrintings?: boolean; // default true on /card pages, false elsewhere
};

// ponytail: the wrapper is intentionally thin — every slot it toggles already exists in
// VanillaCard / OwnershipStrip / MockCard. New slots = new child component, not new
// branches in here.
export default function CardSurface({
  card,
  ownership,
  setIconUrl,
  href,
  metaLeft,
  metaRight,
  container,
  showSidebar = true,
  showPrintings = false,
}: CardSurfaceProps) {
  const target = href ?? `/card/${encodeURIComponent(card.id)}`;
  const inContainer = container?.kind === 'deck' || container?.kind === 'binder';
  const usePrintings = showPrintings && card.game_id === 'mtg';
  const dims = `${card.owned ? '' : 'opacity-90'} flex gap-1`;

  const strip = showSidebar ? (
    <OwnershipStrip counts={ownership ?? { funcTotal: 0 }} setIconUrl={setIconUrl} game={card.game_id} />
  ) : null;

  return (
    <div className={dims}>
      <Link href={target} className="min-w-0 flex-1">
        {usePrintings ? (
          <MockCard faces={cardToMockFaces(card)} />
        ) : (
          <VanillaCard card={card} />
        )}
        {!usePrintings && (
          <>
            <div className="mt-1 truncate text-sm">{card.name}</div>
            {(metaLeft || metaRight) && (
              <div className="flex justify-between text-xs text-neutral-400">
                <span>{metaLeft}</span>
                <span>{metaRight}</span>
              </div>
            )}
            {container && inContainer && (
              <ContainerBadge container={container} id={container.id} />
            )}
          </>
        )}
      </Link>
      {strip}
    </div>
  );
}

// Tiny read-only line under a card preview showing which container you're browsing.
// Search / set pages pass container.kind === 'all' and skip this entirely; the strip
// already conveys "owned somewhere" via funcTotal.
function ContainerBadge({ container, id }: { container: CardSurfaceContainer; id?: string }) {
  if (container.kind === 'all') return null;
  return (
    <div className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-neutral-500">
      {container.kind}
      {id ? ` · ${id}` : ''}
    </div>
  );
}
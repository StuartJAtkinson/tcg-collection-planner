import CardSurface from './CardSurface.tsx';
import type { VanillaCardData } from './VanillaCard.tsx';
import type { OwnershipCounts } from './OwnershipStrip.tsx';
import type { MockCardSource } from './cardToMockFaces.ts';

// Back-compat shim: every existing call site (set / search / decks) passes a
// `VanillaCardData & {id}` shape plus ownership / setIconUrl / game. CardSurface is the
// real renderer; this just maps the legacy props onto the uniform shape.
export default function CardTile({
  card,
  href,
  metaLeft,
  metaRight,
  ownership,
  setIconUrl,
  game,
}: {
  card: VanillaCardData & MockCardSource & { id: string };
  href?: string;
  metaLeft?: React.ReactNode;
  metaRight?: React.ReactNode;
  ownership?: OwnershipCounts;
  setIconUrl?: string | null;
  game?: string | null;
}) {
  return (
    <CardSurface
      card={{ ...card, game_id: card.game_id ?? game ?? null } as any}
      ownership={ownership}
      setIconUrl={setIconUrl}
      href={href}
      metaLeft={metaLeft}
      metaRight={metaRight}
      container={{ kind: 'all' }}
      showSidebar={true}
    />
  );
}
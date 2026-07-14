// A vector/font-only rendering of a card — no art required, laid out in standardized frame
// positions matching the standard Magic card anatomy (name/cost plate, art box, type line
// with rarity symbol, rules text box with a flavor-text rule and quote attribution, bottom
// collector/illustrator bar). Deliberately the "standard" frame only — Planeswalkers, Sagas,
// split cards etc. have their own real layouts and are a later concern, not modeled here.
// First step toward a future 3D/OpenGL binder renderer: everything but the art texture is
// cheap vector+font geometry, so a binder full of these can render (and occlusion-cull) far
// more cheaply than a wall of raster card images. Art is genuinely optional — if no image URL
// is known, the art box stays a plain placeholder rather than blocking the render.
//
// One MockCard = one physical card. `faces` has 2 entries for transform/MDFC/split cards —
// we don't always know which layout it is, so both faces just render side by side, second
// one lightly rotated as a visual nod to the physical flip mechanic.

export type MockFace = {
  name: string;
  typeLine?: string | null;
  costTokens?: string[]; // parsed {1}{W}{U} -> ['1','W','U'], or pokemon retreat cost as ['C','C']
  hp?: string | null;
  power?: string | null;
  toughness?: string | null;
  colors?: string[]; // MTG color letters (WUBRG/C) or pokemon energy types — drives frame color
  rarityTier?: number | null; // 1-5, normalized cross-game — drives the type-line rarity symbol
  rulesText?: string | null;
  attacks?: { name: string; cost?: string[]; damage?: string; text?: string }[];
  flavorText?: string | null;
  imageUrl?: string | null;
  rarity?: string | null;
  setCode?: string | null;
  setIconUrl?: string | null; // Scryfall/pokemon-tcg-data set symbol SVG, hotlinked (not recoloured)
  game?: string | null; // drives the set-icon invert filter (mtg icons are black-on-transparent)
  collectorNumber?: string | null;
  artist?: string | null;
};

const MTG_COLORS: Record<string, string> = {
  W: '#f8f6d8', U: '#0e68ab', B: '#4a4a4a', R: '#d3202a', G: '#00733e', C: '#8c8c8c',
};
const PKM_COLORS: Record<string, string> = {
  Fire: '#e0762f', Water: '#3b7bc4', Grass: '#4caf50', Lightning: '#e5c62f', Psychic: '#a8567a',
  Fighting: '#b5573a', Colorless: '#9a9a9a', Darkness: '#4b4b52', Metal: '#8f9aa3',
  Dragon: '#6a5acd', Fairy: '#e17ac6',
};
const DARK_FRAMES = new Set(['B', 'Darkness', 'Dragon']);
// standard rarity symbol colours: common=black, uncommon=silver, rare=gold, mythic=orange, special=purple
const RARITY_COLORS: Record<number, string> = {
  1: '#3a3a3a', 2: '#c0c9d1', 3: '#d4af37', 4: '#f0713a', 5: '#a76fd1',
};

// pokemon energy tokens are full type names ("Fire", "Colorless") — too long for a 16px pip,
// so they get abbreviated to one letter for display; colour lookup still uses the full name
const PKM_ABBR: Record<string, string> = {
  Fire: 'F', Water: 'W', Grass: 'G', Lightning: 'L', Psychic: 'P',
  Fighting: 'T', Colorless: 'C', Darkness: 'D', Metal: 'M', Dragon: 'N', Fairy: 'Y',
};

function pipColor(token: string) {
  return MTG_COLORS[token] ?? PKM_COLORS[token] ?? '#8c8c8c';
}

function pipLabel(token: string) {
  return PKM_ABBR[token] ?? token;
}

function frameColor(colors?: string[]) {
  if (!colors?.length) return '#8c8c8c';
  const known = colors.filter((c) => MTG_COLORS[c]);
  if (known.length > 1) return '#cfa036'; // gold, multicolor
  return MTG_COLORS[colors[0]] ?? PKM_COLORS[colors[0]] ?? '#8c8c8c';
}

// a muted, darker tone of the frame colour — used for the opaque chrome plates instead of the
// frame colour itself. Real card text boxes/name plates are a darker shade of the frame, not
// an identical fill; it also has to stay visually distinct from the frame when there's no art
// to mask (a plate the exact same colour as its background is just invisible).
function darken(hex: string, factor = 0.45): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// crude "shrink to fit" without measuring the DOM (this renders server-side, no client JS):
// pick a smaller font size as the total text volume grows, same way paper Magic cards do.
function textFitClass(chars: number) {
  if (chars > 380) return 'text-[7px]';
  if (chars > 260) return 'text-[7.5px]';
  if (chars > 160) return 'text-[8px]';
  if (chars > 80) return 'text-[8.5px]';
  return 'text-[9px]';
}

// flavor text often carries its attribution as a trailing "—Author, Source" line
function splitAttribution(flavorText: string) {
  const lines = flavorText.split('\n');
  if (lines.length > 1 && /^[-—]/.test(lines[lines.length - 1].trim())) {
    return { quote: lines.slice(0, -1).join('\n'), attribution: lines[lines.length - 1].trim() };
  }
  return { quote: flavorText, attribution: null };
}

function Pip({ token }: { token: string }) {
  return (
    <span
      style={{ background: pipColor(token) }}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-black/40 text-[9px] font-bold text-black/80"
    >
      {pipLabel(token)}
    </span>
  );
}

// real MTG mana symbols via the self-hosted Mana font (public/mana.min.css) — Scryfall's
// {2}{W}{U}{W/U}{W/P} tokens map to mana-font's ms-2/ms-w/ms-u/ms-wu/ms-wp classes by
// lowercasing and dropping the slash. Only used for MTG (Pokémon energy has no font coverage
// and keeps the plain colour+letter Pip above).
function ManaPip({ token }: { token: string }) {
  const cls = token.toLowerCase().replace(/\//g, '');
  return <i className={`ms ms-cost ms-${cls} text-[16px]`} />;
}

function Face({ face, rotated }: { face: MockFace; rotated?: boolean }) {
  const bg = frameColor(face.colors);
  const dark = face.colors?.some((c) => DARK_FRAMES.has(c));
  const fg = dark ? '#f0f0f0' : '#1a1a1a';
  const plateBg = darken(bg);

  const attacksText = face.attacks?.map((a) => `${a.name} ${a.text ?? ''}`).join(' ') ?? '';
  const bodyChars = (face.rulesText?.length ?? 0) + attacksText.length + (face.flavorText?.length ?? 0);
  const bodySize = textFitClass(bodyChars);
  const flavor = face.flavorText ? splitAttribution(face.flavorText) : null;

  return (
    <div
      style={{ background: bg, color: fg }}
      // real Magic cards' border is ~7% of card width/height (3.5% each side); frame is
      // w-56 = 224px, so 224 * 0.035 = 7.84px — keep this in sync if the width ever changes
      className={`relative flex aspect-[5/7] w-56 shrink-0 flex-col overflow-hidden rounded-lg border-[7.84px] border-black/70 p-1.5 text-[11px] shadow-lg ${rotated ? 'rotate-180' : ''}`}
    >
      {/* 1) no separate art-only crop is available, so the whole card photo is stretched to
          the mock's own frame size and sits behind everything as a mask — the art window
          below is just a transparent gap in the opaque chrome that reveals it. Layout is
          close enough to a real card's that the art lines up in roughly the right place. */}
      {face.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={face.imageUrl} alt="" className="absolute inset-0 h-full w-full object-fill" />
      )}

      <div className="relative z-10 flex h-full flex-col">
        {/* a) name/cost plate — rounded rectangle, name left, mana cost/hp right. Solid frame
            colour (not translucent black) so it stays on-brand with the card's colour identity
            and, since it needs to be fully opaque to mask the image behind it, doesn't leave
            any see-through seam. */}
        <div style={{ backgroundColor: plateBg }} className="flex items-center justify-between gap-1 rounded-md px-1.5 py-0.5">
          <span className="truncate text-[13px] font-bold leading-tight">{face.name}</span>
          <span className="flex shrink-0 items-center gap-0.5">
            {face.hp ? (
              <span className="text-[11px] font-bold">{face.hp} HP</span>
            ) : (
              face.costTokens?.map((t, i) => <ManaPip key={i} token={t} />)
            )}
          </span>
        </div>

        {/* b) art window: transparent — reveals the masked card image behind at roughly the
            right spot. +10% taller than the previous pass. No image at all: shows the honest
            placeholder instead, same footprint. */}
        <div className="my-1 aspect-[5/3.52] w-full shrink-0 overflow-hidden rounded border border-black/20">
          {!face.imageUrl && (
            <div className="flex h-full w-full items-center justify-center bg-black/10">
              <span className="px-2 text-center text-[9px] italic opacity-50">no art loaded</span>
            </div>
          )}
        </div>

        {/* c) type line — mirrors the name plate, overlapping the art/text seam. Rarity moved
            to a reserved slot on the right: the real set-symbol SVG, hotlinked exactly like
            the Master Sets/checklist pages already do (mask-image recolouring was tried first
            but Scryfall's icon host doesn't send CORS headers, so a masked/recoloured version
            can't load in the browser at all — a plain <img> has no such restriction). Falls
            back to a plain rarity-coloured dot if no icon URL is known. Type text is flex-1
            to fill the remaining width up to the reserved icon slot. */}
        {(face.typeLine || face.rarityTier) && (
          <div style={{ backgroundColor: plateBg }} className="relative z-10 -my-2.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
            <span className="flex-1 truncate">{face.typeLine}</span>
            <span className="shrink-0">
              {face.setIconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={face.setIconUrl}
                  alt=""
                  className={`h-3 w-3 ${face.game === 'mtg' ? 'invert' : ''}`}
                />
              ) : (
                face.rarityTier && (
                  <span
                    style={{ background: RARITY_COLORS[face.rarityTier] ?? RARITY_COLORS[1] }}
                    className="inline-block h-2 w-2 rounded-full border border-black/40"
                  />
                )
              )}
            </span>
          </div>
        )}

        {/* d) main text box: abilities/attacks pinned to the top, rule+flavor+attribution
            pinned to the bottom (justify-between) rather than immediately following the
            rules text — matches how a real card leaves the gap in the middle, not the end.
            Nudged down a bit more from the type line (mt-2.5, not just mt-1). */}
        <div style={{ backgroundColor: plateBg }} className={`mt-2.5 flex flex-1 flex-col justify-between overflow-hidden rounded-sm px-1 py-0.5 leading-snug ${bodySize}`}>
          <div>
            {face.rulesText && <p className="whitespace-pre-wrap">{face.rulesText}</p>}
            {face.attacks?.map((a, i) => (
              <div key={i} className="mt-0.5 flex items-baseline justify-between gap-1">
                <span className="flex items-center gap-0.5">
                  {a.cost?.map((t, j) => <Pip key={j} token={t} />)}
                  <span className="font-semibold">{a.name}</span>
                </span>
                {a.damage && <span className="font-bold">{a.damage}</span>}
              </div>
            ))}
          </div>
          {flavor && (
            <div>
              <hr className="my-1 border-black/50" />
              <p className="whitespace-pre-wrap italic opacity-70">{flavor.quote}</p>
              {flavor.attribution && <p className="text-right italic opacity-60">{flavor.attribution}</p>}
            </div>
          )}
        </div>

        {/* e) collector number + illustrator, one line only — rarity text dropped (the type
            line's symbol already covers it); P/T sized up now that a full second line isn't
            competing for space. mt-0 (flush against the text box, not mt-1): any gap between
            two opaque plates isn't actually empty — it's a sliver of the masked card image
            showing through underneath, which usually reads as a stray black line since that's
            typically the real card's own bottom border/legal-text strip. */}
        <div style={{ backgroundColor: plateBg }} className="mt-0 flex items-center justify-between gap-1 rounded-sm px-1 py-0.5 text-[8px]">
          <span className="truncate">
            <span className="uppercase">
              {face.setCode ?? ''} {face.collectorNumber ?? ''}
            </span>
            {face.artist && <span className="normal-case"> · Illus. {face.artist}</span>}
          </span>
          {(face.power || face.toughness) && (
            <span className="shrink-0 rounded-sm border border-black/30 bg-black/20 px-1 text-[10.5px] font-bold">
              {face.power}/{face.toughness}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MockCard({ faces }: { faces: MockFace[] }) {
  return (
    <div className="flex gap-1">
      {faces.map((f, i) => (
        <Face key={i} face={f} rotated={i === 1} />
      ))}
    </div>
  );
}

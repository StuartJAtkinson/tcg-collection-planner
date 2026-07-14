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

  const attacksText = face.attacks?.map((a) => `${a.name} ${a.text ?? ''}`).join(' ') ?? '';
  const bodyChars = (face.rulesText?.length ?? 0) + attacksText.length + (face.flavorText?.length ?? 0);
  const bodySize = textFitClass(bodyChars);
  const flavor = face.flavorText ? splitAttribution(face.flavorText) : null;

  return (
    <div
      style={{ background: bg, color: fg }}
      // real Magic cards' border is ~7% of card width/height (3.5% each side); frame is
      // w-56 = 224px, so 224 * 0.035 = 7.84px — keep this in sync if the width ever changes
      className={`flex aspect-[5/7] w-56 shrink-0 flex-col overflow-hidden rounded-lg border-[7.84px] border-black/70 p-1.5 text-[11px] shadow-lg ${rotated ? 'rotate-180' : ''}`}
    >
      {/* a) name/cost plate — rounded rectangle, name left, mana cost/hp right */}
      <div className="flex items-center justify-between gap-1 rounded-md bg-black/15 px-1.5 py-0.5">
        <span className="truncate text-[13px] font-bold leading-tight">{face.name}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {face.hp ? (
            <span className="text-[11px] font-bold">{face.hp} HP</span>
          ) : (
            face.costTokens?.map((t, i) => <ManaPip key={i} token={t} />)
          )}
        </span>
      </div>

      {/* b) art box: full frame width, same side margin as every other element, sized to the
          art's own aspect ratio (object-contain) rather than stretched/cropped. Shorter than
          a real card's art box to leave room for the type line's rarity symbol below. No
          image: an honest placeholder, same footprint, never blocks layout. */}
      <div className="my-1 flex aspect-[5/3.2] w-full shrink-0 items-center justify-center overflow-hidden rounded border border-black/20 bg-black/10">
        {face.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={face.imageUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="px-2 text-center text-[9px] italic opacity-50">no art loaded</span>
        )}
      </div>

      {/* c) type line — same plate treatment as the name bar (mirrors it), pulled up/down with
          negative margin so it physically overlaps the art box's bottom edge and the text
          box's top edge, like the banner on a real card, rather than sitting in its own
          separate slot between them */}
      {(face.typeLine || face.rarityTier) && (
        <div className="relative z-10 -my-2.5 flex items-center gap-1 truncate rounded-md bg-black/15 px-1.5 py-0.5 text-[10px] font-semibold">
          {face.rarityTier && (
            <span
              style={{ background: RARITY_COLORS[face.rarityTier] ?? RARITY_COLORS[1] }}
              className="inline-block h-2 w-2 shrink-0 rounded-full border border-black/40"
            />
          )}
          <span className="truncate">{face.typeLine}</span>
        </div>
      )}

      {/* d) main text box: i) abilities  ii) rule  iii) italic flavor  iv) quote attribution */}
      <div className={`mt-1 flex-1 overflow-hidden rounded-sm bg-black/5 px-1 py-0.5 leading-snug ${bodySize}`}>
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
        {flavor && (
          <>
            <hr className="my-1 border-black/50" />
            <p className="whitespace-pre-wrap italic opacity-70">{flavor.quote}</p>
            {flavor.attribution && <p className="text-right italic opacity-60">{flavor.attribution}</p>}
          </>
        )}
      </div>

      {/* e) collector number + illustrator */}
      <div className="mt-1 flex items-start justify-between text-[8px] uppercase opacity-70">
        <span className="flex flex-col">
          <span className="truncate">
            {face.rarity ?? ''} {face.setCode ? `· ${face.setCode}` : ''} {face.collectorNumber ?? ''}
          </span>
          {face.artist && <span className="truncate normal-case">Illus. {face.artist}</span>}
        </span>
        {(face.power || face.toughness) && (
          <span className="shrink-0 rounded-sm border border-black/30 bg-black/10 px-1 font-bold normal-case">
            {face.power}/{face.toughness}
          </span>
        )}
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

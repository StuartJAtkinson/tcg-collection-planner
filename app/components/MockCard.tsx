// A vector/font-only rendering of a card — no art required, laid out in standardized frame
// positions (title, cost, art box, type line, rules text, flavor text, bottom info bar).
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
  rulesText?: string | null;
  attacks?: { name: string; cost?: string[]; damage?: string; text?: string }[];
  flavorText?: string | null;
  imageUrl?: string | null;
  rarity?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
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

function pipColor(token: string) {
  return MTG_COLORS[token] ?? PKM_COLORS[token] ?? '#8c8c8c';
}

function frameColor(colors?: string[]) {
  if (!colors?.length) return '#8c8c8c';
  const known = colors.filter((c) => MTG_COLORS[c]);
  if (known.length > 1) return '#cfa036'; // gold, multicolor
  return MTG_COLORS[colors[0]] ?? PKM_COLORS[colors[0]] ?? '#8c8c8c';
}

function Pip({ token }: { token: string }) {
  return (
    <span
      style={{ background: pipColor(token) }}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-black/40 text-[9px] font-bold text-black/80"
    >
      {token}
    </span>
  );
}

function Face({ face, rotated }: { face: MockFace; rotated?: boolean }) {
  const bg = frameColor(face.colors);
  const dark = face.colors?.some((c) => DARK_FRAMES.has(c));
  const fg = dark ? '#f0f0f0' : '#1a1a1a';

  return (
    <div
      style={{ background: bg, color: fg }}
      className={`flex aspect-[5/7] w-56 shrink-0 flex-col overflow-hidden rounded-lg border-2 border-black/30 p-1.5 text-[11px] shadow-lg ${rotated ? 'rotate-180' : ''}`}
    >
      {/* title bar */}
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[13px] font-bold leading-tight">{face.name}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {face.hp ? (
            <span className="text-[11px] font-bold">{face.hp} HP</span>
          ) : (
            face.costTokens?.map((t, i) => <Pip key={i} token={t} />)
          )}
        </span>
      </div>

      {/* art box: real image if we have one, otherwise an honest placeholder — never blocks layout */}
      <div className="my-1 flex flex-1 items-center justify-center overflow-hidden rounded border border-black/20 bg-black/10">
        {face.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={face.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="px-2 text-center text-[9px] italic opacity-50">no art loaded</span>
        )}
      </div>

      {/* type line */}
      {face.typeLine && (
        <div className="truncate rounded-sm bg-black/10 px-1 py-0.5 text-[10px] font-semibold">
          {face.typeLine}
        </div>
      )}

      {/* rules text + attacks + flavor */}
      <div className="mt-1 flex-1 overflow-hidden rounded-sm bg-black/5 px-1 py-0.5 text-[9px] leading-snug">
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
        {face.flavorText && (
          <p className="mt-1 border-t border-black/10 pt-0.5 italic opacity-70">{face.flavorText}</p>
        )}
      </div>

      {/* bottom info bar */}
      <div className="mt-1 flex items-center justify-between text-[8px] uppercase opacity-70">
        <span className="truncate">
          {face.rarity ?? ''} {face.setCode ? `· ${face.setCode}` : ''} {face.collectorNumber ?? ''}
        </span>
        {(face.power || face.toughness) && (
          <span className="rounded-sm border border-black/30 bg-black/10 px-1 font-bold normal-case">
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

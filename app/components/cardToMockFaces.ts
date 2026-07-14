import type { MockFace } from './MockCard.tsx';

// {2}{W}{U} -> ['2','W','U']; hybrid/phyrexian tokens ({W/U}, {W/P}) pass through as literal
// text — Pip has no colour for them but still renders something rather than dropping it.
function manaCostToTokens(cost?: string | null): string[] {
  if (!cost) return [];
  return [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

export type MockCardSource = {
  name: string;
  collector_number: string;
  rarity_raw: string | null;
  rarity_tier: number | null;
  image_small: string | null;
  image_large: string | null;
  set_code: string;
  set_icon_url: string | null;
  game_id: string;
  artist: string | null;
  colors: string[]; // from card_facets, facet='color'
  attrs: Record<string, any> | null;
};

// dual/transform/split cards -> 2 faces, rendered side by side. We don't always know the
// layout (adventure vs transform vs split), so this doesn't try to be clever about it — both
// faces just render, second one rotated as a visual nod to the physical flip. Scryfall's
// artist credit is card-level, not per-face, so both faces show the same illustrator even
// when a dual-faced card technically had two.
export function cardToMockFaces(card: MockCardSource): MockFace[] {
  const attrs = card.attrs ?? {};
  const common = {
    rarity: card.rarity_raw,
    rarityTier: card.rarity_tier,
    setCode: card.set_code,
    setIconUrl: card.set_icon_url,
    game: card.game_id,
    collectorNumber: card.collector_number,
    artist: card.artist,
  };

  if (card.game_id === 'mtg') {
    const faces = attrs.card_faces;
    if (Array.isArray(faces) && faces.length >= 2) {
      return faces.map((f: any) => ({
        ...common,
        name: f.name ?? card.name,
        typeLine: f.type_line,
        costTokens: manaCostToTokens(f.mana_cost),
        power: f.power ?? null,
        toughness: f.toughness ?? null,
        colors: card.colors,
        rulesText: f.oracle_text ?? null,
        flavorText: f.flavor_text ?? null,
        imageUrl: f.image_small ?? f.image_large ?? null,
      }));
    }
    return [{
      ...common,
      name: card.name,
      typeLine: attrs.type_line,
      costTokens: manaCostToTokens(attrs.mana_cost),
      power: attrs.power ?? null,
      toughness: attrs.toughness ?? null,
      colors: card.colors,
      rulesText: attrs.oracle_text ?? null,
      flavorText: attrs.flavor_text ?? null,
      imageUrl: card.image_small ?? card.image_large ?? null,
    }];
  }

  // pokemon
  const abilities = Array.isArray(attrs.abilities) ? attrs.abilities : [];
  const abilitiesText = abilities.map((a: any) => `${a.name}: ${a.text}`).join('\n');
  const attacks = Array.isArray(attrs.attacks)
    ? attrs.attacks.map((a: any) => ({ name: a.name, cost: a.cost, damage: a.damage, text: a.text }))
    : [];
  return [{
    ...common,
    name: card.name,
    typeLine: Array.isArray(attrs.subtypes) ? attrs.subtypes.join(' · ') : null,
    hp: attrs.hp ?? null,
    colors: Array.isArray(attrs.types) && attrs.types.length ? attrs.types : card.colors,
    rulesText: abilitiesText || null,
    attacks,
    flavorText: attrs.flavorText ?? null,
    imageUrl: card.image_small ?? card.image_large ?? null,
  }];
}

// Collectr's Rarity column is inconsistent — sometimes an MTG-style single letter (C/U/R/M/S/P),
// sometimes a full word, sometimes a Yu-Gi-Oh-style tier ("Super Rare", "Secret Rare") for the
// unsupported-game rows that pass through here too. Best-effort mapping to the same 1-5 tier
// used everywhere else, so the type line's rarity dot has something to show; null (no dot) if
// the value doesn't match anything recognizable.
function guessRarityTier(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('secret') || s.includes('special')) return 5;
  if (s === 'm' || s.includes('mythic') || s.includes('ultra') || s.includes('super')) return 4;
  if (s === 'r' || s.includes('rare')) return 3;
  if (s === 'p' || s.includes('promo')) return 3;
  if (s === 'u' || s.includes('uncommon')) return 2;
  if (s === 'c' || s.includes('common')) return 1;
  return null;
}

// Builds a mock face straight from an unresolved import row — there's no catalogue match yet,
// so no oracle text/mana cost/art exists to show. Only fields actually printed on a physical
// card go in (name, set, collector number, rarity); commerce/tracking metadata (price paid,
// condition, grade, quantity, date added...) isn't part of the card object and stays out of
// the generated face, though it's still shown separately alongside it in the UI.
export function importRowToMockFace(get: (field: string) => string | undefined): MockFace {
  return {
    name: get('name') || '(unknown)',
    rarity: get('rarity') ?? null,
    rarityTier: guessRarityTier(get('rarity')),
    setCode: get('setCode') ?? get('set') ?? null,
    collectorNumber: get('number') ?? null,
    imageUrl: null,
  };
}

// Manual predicate probe (inline to avoid import complications).
// Matches the logic in scripts/count_schema_fields.ts.
const PATH_PREDICATES = [
  { test: (p) => p === 'Card.id', build: () => () => true },
  { test: (p) => /^Set\.(set_type|type|block|icon_svg_uri|svgs\.icon|arenacode|mtgoCode|parentCode|isFoilOnly|isOnlineOnly)$/.test(p),
    build: () => () => true },
  { test: (p) => /^Card\.(isReserved|isStarter|isStorySpotlight|isTimeshifted|isOversized|hasFoil|hasNonFoil|isOnlineOnly|reserved|booster|story_spotlight|variation|content_warning)\b/.test(p),
    build: (p) => {
      const m = p.match(/^Card\.([a-zA-Z_]+)/);
      if (!m) return null;
      const f = m[1];
      return (c) => c[f] === true;
    }},
  { test: (p) => /^Card\.[a-zA-Z_]+$/.test(p), build: (p) => {
    const f = p.slice(5);
    return (c) => c[f] != null && c[f] !== '';
  }},
  { test: (p) => /^Card\.legalities\.[a-z_]+$/.test(p), build: (p) => {
    const f = p.slice('Card.legalities.'.length);
    return (c) => c.legalities?.[f] != null && c.legalities?.[f] !== 'not_legal';
  }},
];

function predicateFor(path) {
  const trimmed = path.trim();
  const cleaned = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
  for (const { test, build } of PATH_PREDICATES) {
    if (test(cleaned)) {
      const p = build(cleaned);
      if (p) return p;
      break;
    }
  }
  return null;
}

const fakeCard = {
  uuid: 'x', name: 'X',
  scryfallOracleId: 'abc', scryfallId: 'def',
  releaseDate: '2020-01-01',
  numberSort: 100,
  rarity: 'rare',
  manaValue: 3,
  hasFoil: true, isStarter: false, isReserved: false,
  colors: ['W'], colorIdentity: ['W'],
  legalities: { vintage: 'legal' },
};

const probe = (path) => {
  const p = predicateFor(path);
  return p ? p(fakeCard) : 'NULL';
};

console.log('Card.scryfallOracleId →', probe('Card.scryfallOracleId'));
console.log('Card.releaseDate →', probe('Card.releaseDate'));
console.log('Card.isReserved →', probe('Card.isReserved'));
console.log('Card.numberSort (recommended) →', probe('Card.numberSort (recommended)'));
console.log('Card.legalities.vintage →', probe('Card.legalities.vintage'));
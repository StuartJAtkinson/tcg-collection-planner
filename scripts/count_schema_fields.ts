// Streams the cached Scryfall default_cards JSONL and a freshly-downloaded MTGJSON
// AllPrintings.json.gz, counts records per schema-field row from
// docs/schema-scryfall-vs-mtgjson.xlsx, and emits docs/schema-counts.json as a
// sidecar that the Python generator merges back into the workbook.
//
// Predicate table is data-driven: each (group, element) row carries a field
// path string ("Card.prices.usd", "Card.legalities.standard", "Set.code") —
// we parse the path and pick a matching predicate. Unparseable paths → null
// (we'll leave those count cells blank in the xlsx).
//
// Usage: npm run schema:counts
import { createReadStream, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import readline from 'node:readline';
import path from 'node:path';
import { streamMtgjsonAll } from '../src/import/util.ts';

const ROWS = path.resolve('docs/schema-rows.json');
const OUT = path.resolve('docs/schema-counts.json');
const SCRY = path.resolve('data/scryfall-default-cards.jsonl.gz');

// ----- predicate table --------------------------------------------------------
// Each predicate receives a single card object (or set object for Set.* paths)
// and returns true if the field would populate for that record.
// `null` = no predicate (skip the row for that source).

type Card = any;
type Predicate = (x: Card) => boolean;

// Normalise a path string coming out of the xlsx: drop annotation suffixes
// like " (boolean)", " (17 keys)", " (recommended)" so the parser sees a clean
// dotted path. Brace lists ("{usd,usd_foil,usd_etched}") are preserved and
// expanded in the predicate builder below.
function cleanPath(p: string): string {
  return p.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// Expand a brace-list path into all concrete variants — returns [] if no braces.
function expandBraces(p: string): string[] {
  const m = p.match(/\{([^}]+)\}/);
  if (!m) return [p];
  const items = m[1].split(',').map((s) => s.trim());
  return items.map((it) => p.replace(`{${m[1]}}}`, it).replace(`{${m[1]}}`, it));
}

const PATH_PREDICATES: Array<{ test: (p: string) => boolean; build: (p: string) => Predicate | null }> = [
  // Total-card-count anchor — Card.id always exists
  { test: (p) => p === 'Card.id', build: () => () => true },

  // Set-level anchors
  { test: (p) => p === 'Set.id' || p === 'Set.uuid', build: () => () => true },
  { test: (p) => p === 'Set.code', build: () => () => true },
  { test: (p) => p === 'Set.name', build: () => () => true },
  { test: (p) => p === 'Set.released_at' || p === 'Set.releaseDate', build: () => () => true },
  { test: (p) => p === 'Set.card_count' || p === 'Set.totalSetSize', build: () => () => true },
  { test: (p) => /^Set\.(set_type|type|block|icon_svg_uri|svgs\.icon|arenacode|mtgoCode|parentCode|isFoilOnly|isOnlineOnly)$/.test(p),
    build: () => () => true },

  // Card.<bool> — count records where the field is true (must come BEFORE the
  // catch-all Card.<field> test, since `reserved` etc. are non-null on every card)
  { test: (p) => /^Card\.(isReserved|isStarter|isStorySpotlight|isTimeshifted|isOversized|hasFoil|hasNonFoil|isOnlineOnly|reserved|booster|story_spotlight|variation|content_warning)\b/.test(p),
    build: (p) => {
      const m = p.match(/^Card\.([a-zA-Z_]+)/);
      if (!m) return null;
      const f = m[1];
      return (c) => c[f] === true;
    }},

  // Simple dotted paths: Card.<field>
  { test: (p) => /^Card\.[a-zA-Z_]+$/.test(p), build: (p) => {
    const f = p.slice(5);
    return (c) => c[f] != null && c[f] !== '';
  }},

  // Card.image_uris.<variant>
  { test: (p) => /^Card\.image_uris\.[a-z_]+$/.test(p), build: (p) => {
    const v = p.slice('Card.image_uris.'.length);
    return (c) => c.image_uris?.[v] != null;
  }},

  // Card.identifiers.<key>
  { test: (p) => /^Card\.identifiers\.[a-zA-Z_]+$/.test(p), build: (p) => {
    const k = p.slice('Card.identifiers.'.length);
    return (c) => c.identifiers?.[k] != null;
  }},

  // MTGJSON bare identifiers.<key> (no Card. prefix — used for some rows)
  { test: (p) => /^identifiers\.[a-zA-Z_]+$/.test(p), build: (p) => {
    const k = p.slice('identifiers.'.length);
    return (c) => c.identifiers?.[k] != null;
  }},

  // Card.legalities.<format> — count if the format has any non-"not_legal" value
  { test: (p) => /^Card\.legalities\.[a-z_]+$/.test(p), build: (p) => {
    const f = p.slice('Card.legalities.'.length);
    return (c) => c.legalities?.[f] != null && c.legalities?.[f] !== 'not_legal';
  }},

  // Card.prices.<key>
  { test: (p) => /^Card\.prices\.[a-z_]+$/.test(p), build: (p) => {
    const k = p.slice('Card.prices.'.length);
    return (c) => c.prices?.[k] != null;
  }},

  // MTGJSON Card.prices.paper.<vendor>.<finish>
  { test: (p) => /^Card\.prices\.paper\.[a-z]+\.[a-z_]+$/.test(p), build: (p) => {
    const parts = p.split('.');
    const vendor = parts[3];
    const finish = parts[4];
    return (c) => c.prices?.paper?.[vendor]?.[finish] != null;
  }},

  // Card.card_faces[].<field>
  { test: (p) => /^Card\.card_faces\[\]\.[a-zA-Z_]+$/.test(p), build: (p) => {
    const f = p.slice('Card.card_faces[].'.length);
    return (c) => Array.isArray(c.card_faces) && c.card_faces.some((face: any) => face[f] != null && face[f] !== '');
  }},

  // MTGJSON Card.cardFaces[].<field>
  { test: (p) => /^Card\.cardFaces\[\]\.[a-zA-Z_]+$/.test(p), build: (p) => {
    const f = p.slice('Card.cardFaces[].'.length);
    return (c) => Array.isArray(c.cardFaces) && c.cardFaces.some((face: any) => face[f] != null && face[f] !== '');
  }},

  // Card.card_faces[].image_uris (container — any face has it)
  { test: (p) => p === 'Card.card_faces[].image_uris', build: () => (c) =>
    Array.isArray(c.card_faces) && c.card_faces.some((f: any) => f.image_uris) },

  // Card.cardFaces[] (MTGJSON container — card has a face array)
  { test: (p) => p === 'Card.cardFaces[]' || p === 'Card.card_faces[]',
    build: () => (c) => Array.isArray(c.cardFaces ?? c.card_faces) && (c.cardFaces ?? c.card_faces).length > 0 },

  // Card.preview.<field>
  { test: (p) => /^Card\.preview\.[a-z_]+$/.test(p), build: (p) => {
    const f = p.slice('Card.preview.'.length);
    return (c) => c.preview?.[f] != null;
  }},

  // Card.all_parts[] (container — present if card has related parts)
  { test: (p) => /^Card\.all_parts/.test(p) || /^Card\.parts/.test(p),
    build: () => (c) => Array.isArray(c.all_parts) && c.all_parts.length > 0 },

  // Card.rulings[].date / .text / .published_at / .comment
  { test: (p) => /^Card\.rulings\[\]\.[a-zA-Z_]+$/.test(p), build: (p) => {
    const f = p.slice('Card.rulings[].'.length);
    return (c) => Array.isArray(c.rulings) && c.rulings.some((r: any) => r[f] != null);
  }},

  // Card.foreignData[] (array — present if any localisation exists)
  { test: (p) => /^Card\.foreignData/.test(p), build: () => (c) => Array.isArray(c.foreignData) && c.foreignData.length > 0 },

  // Card.types / subtypes / supertypes / colors / colorIdentity / colorIndicator (arrays)
  { test: (p) => /^Card\.(types|subtypes|supertypes|colors|colorIdentity|colorIndicator|keywords|games|promoTypes|finishes|artistIds|otherFaceIds|colors)\b/.test(p),
    build: (p) => {
      const m = p.match(/^Card\.([a-zA-Z]+)/);
      if (!m) return null;
      const f = m[1];
      return (c) => Array.isArray(c[f]) && c[f].length > 0;
    }},

  // Card.leadershipSkills.<role>
  { test: (p) => /^Card\.leadershipSkills\.[a-zA-Z]+$/.test(p), build: (p) => {
    const r = p.slice('Card.leadershipSkills.'.length);
    return (c) => c.leadershipSkills?.[r] === true;
  }},

  // Card.purchaseUrls.<vendor>
  { test: (p) => /^Card\.purchaseUrls\.[a-zA-Z]+$/.test(p), build: (p) => {
    const v = p.slice('Card.purchaseUrls.'.length);
    return (c) => c.purchaseUrls?.[v] != null;
  }},
];

const NO_PREDICATE = new Set([
  '—', 'none', 'derived', 'hardcoded', '',
  'derived from Card.collector_number',
  'derived from Card.number',
  'derived: hand-rolled sortKey() regex on collector_number',
  'derived: hardcoded MTG_RARITY_TIER 1-5 map',
  "derived from Card.colors (WUBRG) or Card.card_faces[].colors",
  'derived from Card.colors or Card.card_faces[].colors',
  'derived from Card.type_line or Card.card_faces[].type_line',
  'derived from Card.legalities (aggregated)',
  'derived from Card.security_stamp==\'triangle\' or Card.promo_types?\'universesbeyond\'',
  'derived from same Scryfall signals',
  'derived from cards.image_art_crop (highest-priced per set)',
  "— (MTGJSON's hasEtched isn't priced)",
  "— (deprecated in MTGJSON)",
  'none (MTGJSON exposes otherFaceIds[] instead)',
  '— (MTGJSON doesn\'t expose)',
  '— (MTGO is shut)',
  "— (rulings already in Card.rulings[])",
  "— (Scryfall 'colors' already includes the colour indicator)",
  '— (Scryfall exposes illustration_id only via the card object, not as a per-card indexable field)',
  '— (Scryfall small is via Card.image_uris.small)',
  '— (Scryfall large is via Card.image_uris.large)',
  "Card.prices.paper.tcgplayer.holofoil / etc.",
  "Card.prices.paper.tcgplayer / cardmarket",
  'Card.uuid (derives from scryfallId)',
  'Card.faceName',
  'Card.faceFlavorName',
  "Card.setCode + /sets lookup",
  'Set.uuid / /sets cross-ref',
  'Set.uuid (via /sets cross-ref)',
  'identifiers.tcgplayerProductId (per card)',
  'identifiers.imageSmallUrl (5e MB only)',
  'identifiers.imageLargeUrl (5e MB only)',
  '— (rulings already in Card.rulings[])',
  'Card.leadershipSkills.{commander,brawl,oathbreaker}',
  'Card.cardFaces[].identifiers.imageUrls{...}',
  'Card.rulings[].date',
  'Card.rulings[].text',
  'Card.cardFaces[].text (when localised)',
  'Card.cardFaces[].type (when localised)',
  'Card.rulings_uri',
  'none (Card.type_line is a string only)',
  'Card.booster (related)',
  'Card.isStarter (related)',
  'derived (Card.booster-related)',
  'identifiers.scryfallId',
  'identifiers.scryfallOracleId',
  'Card.isReserved',
  'Card.hasFoil',
  'Card.hasNonFoil',
  'derived from Card.finishes',
  'derived from Card.games (includes \'arena\' only)',
  'Set.svgs.icon / Set.icons[0]',
  'not stored',
  'not used',
  'not imported',
  "—",
]);

function predicateFor(path: string): Predicate | null {
  const trimmed = path.trim();
  if (NO_PREDICATE.has(trimmed)) return null;
  const cleaned = cleanPath(trimmed);
  const variants = expandBraces(cleaned);
  const preds: Predicate[] = [];
  for (const v of variants) {
    for (const { test, build } of PATH_PREDICATES) {
      if (test(v)) {
        const p = build(v);
        if (p) preds.push(p);
        break;
      }
    }
  }
  if (preds.length === 0) return null;
  // Brace-expanded paths become OR — count if any variant would populate.
  if (preds.length === 1) return preds[0];
  return (c) => preds.some((p) => p(c));
}

// ----- load schema rows from the Python generator's sidecar -----------------
// The Python generator writes docs/schema-rows.json with the same row order as
// the xlsx — we read it directly rather than parsing xlsx from node (no need to
// pull in another dep).
type SchemaRow = { group: string; element: string; scryfall: string; mtgjson: string };
function loadSchemaRows(): SchemaRow[] {
  if (!existsSync(ROWS)) throw new Error(`Missing ${ROWS} — run \`python scripts/build_schema_xlsx.py\` first`);
  return JSON.parse(readFileSync(ROWS, 'utf8'));
}

// ----- stream Scryfall default_cards JSONL ----------------------------------
async function streamScryfall(onCard: (c: any) => void): Promise<number> {
  if (!existsSync(SCRY)) throw new Error(`Missing ${SCRY} — run \`npm run import:mtg\` once to populate it`);
  const rl = readline.createInterface({ input: createReadStream(SCRY).pipe(createGunzip()) });
  let total = 0;
  for await (const raw of rl) {
    const line = raw.trim().replace(/,$/, '');
    if (!line || line === '[' || line === ']') continue;
    onCard(JSON.parse(line));
    total++;
  }
  return total;
}

// ----- main ------------------------------------------------------------------
async function main() {
  const rows = await loadSchemaRows();
  console.log(`schema:counts — ${rows.length} rows from ${ROWS}`);

  type Counts = { scryfall: number | null; mtgjson: number | null };
  const counts: Record<string, Counts> = {};
  for (const r of rows) {
    counts[`${r.group}::${r.element}`] = { scryfall: null, mtgjson: null };
  }

  const scryPredicates: Array<{ key: string; pred: Predicate }> = [];
  const mtjPredicates: Array<{ key: string; pred: Predicate }> = [];
  for (const r of rows) {
    const key = `${r.group}::${r.element}`;
    const sP = predicateFor(r.scryfall);
    if (sP) scryPredicates.push({ key, pred: sP });
    const mP = predicateFor(r.mtgjson);
    if (mP) mtjPredicates.push({ key, pred: mP });
  }
  console.log(`  ${scryPredicates.length} Scryfall predicates, ${mtjPredicates.length} MTGJSON predicates`);

  console.log('streaming Scryfall…');
  const scryTotal = await streamScryfall((c) => {
    for (const { key, pred } of scryPredicates) {
      if (pred(c)) counts[key].scryfall = (counts[key].scryfall ?? 0) + 1;
    }
  });
  console.log(`  ${scryTotal} Scryfall cards`);

  console.log('streaming MTGJSON…');
  let mtjTotal = 0;
  await streamMtgjsonAll(async (_code, set) => {
    for (const card of [...(set.cards ?? []), ...(set.tokens ?? [])]) {
      for (const { key, pred } of mtjPredicates) {
        if (pred(card)) counts[key].mtgjson = (counts[key].mtgjson ?? 0) + 1;
      }
      mtjTotal++;
    }
  });
  console.log(`  ${mtjTotal} MTGJSON cards+tokens`);

  // Inject totals for the Card.id / Set.id anchor rows
  for (const r of rows) {
    const key = `${r.group}::${r.element}`;
    if (r.scryfall === 'Card.id' && counts[key].scryfall == null) counts[key].scryfall = scryTotal;
    if ((r.mtgjson === 'Card.id' || r.mtgjson === 'Card.uuid') && counts[key].mtgjson == null) counts[key].mtgjson = mtjTotal;
  }

  writeFileSync(OUT, JSON.stringify({ totalScryfall: scryTotal, totalMtgjson: mtjTotal, counts }, null, 2));
  console.log(`wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sql } from 'drizzle-orm';
import { db, client } from '../db/index.ts';
import { cardFacets, cards, mtgCardPrintings, prices } from '../db/schema.ts';

export const DATA_DIR = path.resolve('data');
export const MTGJSON_URL = 'https://mtgjson.com/api/v5/AllPrintings.json.gz';
export const MTGJSON_FILE = 'AllPrintings.json.gz';

const HEADERS = { 'User-Agent': 'card-collection-importer/0.1', Accept: '*/*' };

export async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

export async function download(url: string, file: string, maxAgeHours = 20): Promise<string> {
  mkdirSync(DATA_DIR, { recursive: true });
  const dest = path.join(DATA_DIR, file);
  if (existsSync(dest) && (Date.now() - statSync(dest).mtimeMs) / 36e5 < maxAgeHours) {
    console.log(`  using cached ${file}`);
    return dest;
  }
  console.log(`  downloading ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(dest));
  return dest;
}

// ponytail: heuristic binder order — numeric part rules, letter prefixes ("TG01") sort after the
// main run, suffix chars ("184a", "184★") tie-break. Refine per-game when a real set proves it wrong.
export function sortKey(cn: string): number {
  const m = cn.match(/\d+/);
  if (!m) return 9e9;
  let key = parseInt(m[0], 10);
  const prefix = cn.slice(0, m.index);
  const suffix = cn.slice(m.index! + m[0].length);
  const pl = prefix.match(/[a-z]/i);
  if (pl) key += 1e6 * (pl[0].toUpperCase().charCodeAt(0) - 64);
  for (let i = 0; i < Math.min(suffix.length, 3); i++) {
    key += (suffix.charCodeAt(i) % 128) / 1000 ** (i + 1);
  }
  return key;
}

export type CardRow = typeof cards.$inferInsert;
export type FacetRow = typeof cardFacets.$inferInsert;
export type PriceRow = typeof prices.$inferInsert;
export type MtgPrintingRow = typeof mtgCardPrintings.$inferInsert;

const MTG_RARITY_TIER: Record<string, number> = { common: 1, uncommon: 2, rare: 3, mythic: 4, special: 5, bonus: 5 };
const MTG_WUBRG = 'WUBRG';
// Canonical MTG card kinds displayed as facets. Order = display order. The Tribal supertype
// was retired in 2014 (now folded into Kindred); Conspiracy/Plane/Scheme/Phenomenon/Vanguard
// and Emblem lived only in their own sets and are rare to nonexistent in real collections.
// Token and Card are also dropped — Token cards don't have a Scryfall type_line on the parent
// printing, and "Card" is Scryfall's placeholder for entries with no recognised type.
const MTG_KINDS = ['Battle', 'Planeswalker', 'Creature', 'Sorcery', 'Instant', 'Artifact', 'Enchantment', 'Land'];

// Subset of MTGJSON AllPrintings card shape we actually read. Anything not in here is still
// accessible via `as any` casts where needed. Keep in sync with docs/schema-scryfall-vs-mtgjson.xlsx.
export interface MtgjsonCard {
  uuid: string;
  name: string;
  number: string;
  setCode: string;
  lang?: string;
  colors?: string[];
  colorIdentity?: string[];
  colorIndicator?: string[];
  types?: string[];
  subtypes?: string[];
  supertypes?: string[];
  keywords?: string[];
  manaValue?: number;
  manaCost?: string;
  rarity?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  text?: string;
  flavorText?: string;
  artist?: string;
  artistIds?: string[];
  securityStamp?: string;
  promoTypes?: string[];
  boosterTypes?: string[];
  frame?: string;
  borderColor?: string;
  isReserved?: boolean;
  isFoil?: boolean;
  isNonFoil?: boolean;
  identifiers?: {
    scryfallId?: string;
    scryfallOracleId?: string;
    tcgplayerProductId?: string;
    mtgoId?: string;
    cardKingdomId?: string;
    mcmId?: string;
  };
  legalities?: Record<string, string>;
  rulings?: Array<{ date: string; text: string }>;
  leadershipSkills?: { commander?: boolean; brawl?: boolean; oathbreaker?: boolean };
  foreignData?: Array<{ language: string; name: string; text?: string; type?: string; flavorText?: string }>;
  purchaseUrls?: { tcgplayer?: string; cardmarket?: string; cardhoarder?: string };
  edhrecRank?: number;
  cardFaces?: Array<{
    name?: string;
    manaCost?: string;
    type?: string;
    types?: string[];
    subtypes?: string[];
    supertypes?: string[];
    oracleText?: string;
    power?: string;
    toughness?: string;
    loyalty?: string;
    flavorText?: string;
    artist?: string;
    colorIndicator?: string[];
  }>;
}

const mtgFacetsFor = (mtj: MtgjsonCard | null | undefined, sfall: any): FacetRow[] => {
  const id = sfall?.id ?? mtj?.identifiers?.scryfallId;
  if (!id) return [];
  const mt: any = mtj ?? {};
  const sf: any = sfall ?? {};
  // MTGJSON carries explicit colors/colorIdentity arrays; fall back to Scryfall's card_faces
  // (only the front face, matching the old behaviour). type_line parsing is the last resort.
  const colors: string[] = mt.colors
    ?? mt.colorIdentity
    ?? sf.colors
    ?? sf.card_faces?.flatMap((f: any) => f.colors ?? [])
    ?? [];
  const uniq = [...new Set(colors)].sort((a, b) => MTG_WUBRG.indexOf(a) - MTG_WUBRG.indexOf(b));
  const rows: FacetRow[] = (uniq.length ? uniq : ['C']).map((v) => ({ cardId: id, facet: 'color', value: v }));
  rows.push({ cardId: id, facet: 'color_combo', value: uniq.join('') || 'C' });
  // Prefer MTGJSON's structured types[] over Scryfall's type_line substring scan.
  const kinds = mt.types?.length ? mt.types : (sf.type_line?.split(/\s+/) ?? []);
  const kind = kinds.map((t: string) => t.replace(/[^A-Za-z]/g, '')).find((t: string) => MTG_KINDS.includes(t)) ?? 'Other';
  rows.push({ cardId: id, facet: 'kind', value: kind });
  return rows;
};

const mtgAttrsFor = (mtj: MtgjsonCard | null | undefined, sfall: any) => {
  const mt: any = mtj ?? {};
  const sf: any = sfall ?? {};
  const ids = mt.identifiers ?? {};
  // Per-face: MTGJSON fields (camelCase) merged with Scryfall image URIs (snake_case).
  const faceFromMtg = (f: any) => ({
    name: f.name,
    mana_cost: f.manaCost ?? null,
    type_line: f.type ?? null,
    oracle_text: f.text ?? null,
    power: f.power ?? null,
    toughness: f.toughness ?? null,
    loyalty: f.loyalty ?? null,
    flavor_text: f.flavorText ?? null,
    security_stamp: f.securityStamp ?? null,
    color_indicator: f.colorIndicator ?? null,
  });
  const faceFromSfall = (f: any) => ({
    image_small: f?.image_uris?.small ?? null,
    image_large: f?.image_uris?.large ?? null,
    image_art_crop: f?.image_uris?.art_crop ?? null,
  });
  const mtjFaces = mt.cardFaces ?? [];
  const sfallFaces = sf.card_faces ?? [];
  const cardFaces = mtjFaces.length
    ? mtjFaces.map((f: any, i: number) => ({ ...faceFromMtg(f), ...faceFromSfall(sfallFaces[i]) }))
    : sfallFaces.map((f: any) => ({ ...faceFromSfall(f) }));
  return {
    // Tier-2 fields, MTGJSON primary, Scryfall fallback
    mana_cost: mt.manaCost ?? sf.mana_cost ?? null,
    cmc: mt.manaValue ?? sf.cmc ?? null,
    type_line: mt.type ?? sf.type_line ?? null,
    types: mt.types ?? null,
    subtypes: mt.subtypes ?? null,
    supertypes: mt.supertypes ?? null,
    colors: mt.colors ?? null,
    color_identity: mt.colorIdentity ?? null,
    color_indicator: mt.colorIndicator ?? null,
    keywords: mt.keywords?.length ? mt.keywords : (sf.keywords ?? undefined),
    oracle_text: mt.text ?? sf.oracle_text ?? null,
    power: mt.power ?? sf.power ?? null,
    toughness: mt.toughness ?? sf.toughness ?? null,
    loyalty: mt.loyalty ?? sf.loyalty ?? null,
    flavor_text: mt.flavorText ?? sf.flavor_text ?? null,
    card_faces: cardFaces.length ? cardFaces : undefined,
    legalities: mt.legalities ?? sf.legalities ?? null,
    security_stamp: mt.securityStamp ?? sf.security_stamp ?? null,
    promo_types: mt.promoTypes ?? sf.promo_types ?? null,
    frame: mt.frame ?? sf.frame ?? null,
    border_color: mt.borderColor ?? sf.border_color ?? null,
    booster_types: mt.boosterTypes ?? null,
    is_reserved: mt.isReserved ?? sf.reserved ?? null,
    is_online_only: mt.isOnlineOnly ?? sf.isOnlineOnly ?? null,
    // MTGJSON-only fields
    artist_ids: mt.artistIds ?? null,
    identifiers: Object.keys(ids).length ? ids : null,
    rulings: mt.rulings ?? null,
    leadership_skills: mt.leadershipSkills ?? null,
    foreign_data: mt.foreignData ?? null,
    purchase_urls: mt.purchaseUrls ?? null,
    edhrec_rank: mt.edhrecRank ?? null,
    // Cross-reference keys preserved for traceability
    scryfall_id: ids.scryfallId ?? null,
    scryfall_oracle_id: ids.scryfallOracleId ?? null,
    mtg_uuid: mt.uuid ?? null,
  };
};

// One row per MTGJSON uuid (base/foil/promo/foreign). cardId is the matched Scryfall id.
// Skips the "primary" printing chosen for the cards.attrs blob — both primary and alternates
// land in mtg_card_printings; the primary just happens to also drive cards.attrs.
export const mtgPrintingFor = (mtj: MtgjsonCard, cardId: string): MtgPrintingRow => {
  const finishes: string[] = [];
  if (mtj.isFoil) finishes.push('foil');
  if (mtj.isNonFoil !== false && !mtj.isFoil) finishes.push('nonfoil');
  // MTGJSON's `finishes` is implicit; fall back to ['nonfoil'] for the common base case.
  const finalFinishes = finishes.length ? finishes : ['nonfoil'];
  return {
    cardId,
    mtgUuid: mtj.uuid,
    lang: mtj.lang ?? 'English',
    finishes: finalFinishes,
    promoTypes: mtj.promoTypes ?? null,
    isReserved: mtj.isReserved ?? null,
    frame: mtj.frame ?? null,
    borderColor: mtj.borderColor ?? null,
    securityStamp: mtj.securityStamp ?? null,
    artist: mtj.artist ?? null,
    flavorText: mtj.flavorText ?? null,
  };
};

export function mtgRowsFor(
  mtj: MtgjsonCard | null,
  sfall: any,
  asOf: string,
): { card: CardRow; facets: FacetRow[]; prices: PriceRow[] } {
  const id: string = sfall.id;
  const sfImg = sfall.image_uris ?? sfall.card_faces?.[0]?.image_uris;
  const mt: any = mtj ?? {};
  const card: CardRow = {
    id,
    gameId: 'mtg',
    setId: sfall.set_id,
    name: mt.name ?? sfall.name,
    collectorNumber: sfall.collector_number,
    sortKey: sortKey(sfall.collector_number),
    rarityRaw: mt.rarity ?? sfall.rarity ?? null,
    rarityTier: MTG_RARITY_TIER[mt.rarity ?? sfall.rarity] ?? 3,
    imageSmall: sfImg?.small ?? null,
    imageLarge: sfImg?.large ?? sfImg?.normal ?? null,
    imageArtCrop: sfImg?.art_crop ?? null,
    artist: mt.artist ?? sfall.artist ?? null,
    finishes: sfall.finishes ?? ['nonfoil'],
    attrs: mtgAttrsFor(mtj, sfall),
    oracleId: sfall.oracle_id ?? sfall.card_faces?.[0]?.oracle_id ?? mt.identifiers?.scryfallOracleId ?? null,
  };
  const prices: PriceRow[] = [];
  for (const [key, finish] of [['usd', 'nonfoil'], ['usd_foil', 'foil'], ['usd_etched', 'etched']] as const) {
    if (sfall.prices?.[key]) prices.push({ cardId: id, finish, usd: sfall.prices[key], asOf });
  }
  return { card, facets: mtgFacetsFor(mtj, sfall), prices };
}

export async function refreshMtgSetMetadata(crossoverIds?: string[]): Promise<number> {
  await client`
    update sets s set legalities = l.leg
    from (
      select set_id, jsonb_object_agg(fmt, 'Legal') as leg
      from (
        select c.set_id, f.fmt
        from cards c, jsonb_each_text(c.attrs->'legalities') as f(fmt, status)
        where c.game_id = 'mtg'
        group by c.set_id, f.fmt
        having avg((f.status = 'legal')::int) > 0.5
      ) x
      group by set_id
    ) l
    where s.id = l.set_id`;

  const ids = crossoverIds ?? (await client`
    select set_id
    from (
      select c.set_id,
             (count(*) filter (
                where c.attrs->>'security_stamp' = 'triangle'
                   or c.attrs->'promo_types' ? 'universesbeyond'
             ))::float / nullif(count(*), 0) as ratio
      from cards c
      where c.game_id = 'mtg'
      group by c.set_id
    ) x
    where ratio > 0.5
  `).map((r: any) => r.set_id as string);

  await client`update sets set crossover = false where game_id = 'mtg'`;
  if (ids.length) await client`update sets set crossover = true where id = any(${ids})`;
  return ids.length;
}

export async function upsertCards(cardRows: CardRow[], facetRows: FacetRow[], priceRows: PriceRow[]) {
  if (!cardRows.length) return;
  await db.insert(cards).values(cardRows).onConflictDoUpdate({
    target: cards.id,
    set: {
      name: sql`excluded.name`,
      imageSmall: sql`excluded.image_small`,
      imageLarge: sql`excluded.image_large`,
      imageArtCrop: sql`excluded.image_art_crop`,
      finishes: sql`excluded.finishes`,
      attrs: sql`excluded.attrs`,
      rarityRaw: sql`excluded.rarity_raw`,
      rarityTier: sql`excluded.rarity_tier`,
      oracleId: sql`excluded.oracle_id`,
    },
  });
  // ponytail: facets are insert-only; card reclassifications don't happen in practice.
  // Delete-and-reinsert per card if one ever does.
  for (let i = 0; i < facetRows.length; i += 5000) {
    await db.insert(cardFacets).values(facetRows.slice(i, i + 5000)).onConflictDoNothing();
  }
  for (let i = 0; i < priceRows.length; i += 5000) {
    await db.insert(prices).values(priceRows.slice(i, i + 5000)).onConflictDoNothing();
  }
  // ponytail: printings are insert-only keyed on (card_id, mtg_uuid). Re-runs produce the
  // same rows; no UPDATE needed because the data shape is immutable per uuid.
  // Caller batches via upsertPrintings separately to keep the printings array sized independently.
}

// Upsert helper for mtg_card_printings. Insert-only — primary key is (card_id, mtg_uuid);
// idempotent re-runs land in onConflictDoNothing.
export async function upsertPrintings(rows: MtgPrintingRow[]) {
  for (let i = 0; i < rows.length; i += 5000) {
    await db.insert(mtgCardPrintings).values(rows.slice(i, i + 5000)).onConflictDoNothing();
  }
}

// Stream MTGJSON AllPrintings.json.gz set-by-set. Calls onSet(code, setObj) for each parsed
// set where setObj has { baseSetSize, cards, tokens, … }. Returns the number of sets seen.
// ponytail: buffer-trim strategy is required — without it the 650MB decompressed stream OOMs.
// Caller must not retain per-set refs longer than the callback (setObj is reconstructed per set).
export async function streamMtgjsonAll(
  onSet: (code: string, setObj: any) => void | Promise<void>,
): Promise<number> {
  const localPath = path.join(DATA_DIR, MTGJSON_FILE);
  if (!existsSync(localPath)) throw new Error(`Missing ${localPath} — run \`npm run import:mtg\` once to populate it`);
  const input = createReadStream(localPath).pipe(createGunzip());

  let buf = Buffer.alloc(0);
  let bufStart = 0;
  let pos = 0;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let pastMeta = false;
  let inData = false;
  let setStart = -1;
  let keyStart = -1;
  let setsSeen = 0;

  for await (const chunk of input) {
    const c = chunk as Buffer;
    buf = Buffer.concat([buf, c]);
    for (let i = 0; i < c.length; i++) {
      const ch = c[i];
      const abs = pos++;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === 0x5c) esc = true;
        else if (ch === 0x22) inStr = false;
        continue;
      }
      if (ch === 0x22) {
        if (depth === 2 && !inStr && keyStart === -1 && pastMeta && inData) keyStart = abs;
        inStr = true;
        continue;
      }
      if (ch === 0x7b || ch === 0x5b) {
        depth++;
        if (pastMeta && !inData && depth === 2) inData = true;
        else if (inData && depth === 3 && keyStart !== -1) setStart = keyStart;
        continue;
      }
      if (ch === 0x7d || ch === 0x5d) {
        if (inData && depth === 3 && setStart !== -1) {
          const slice = buf.subarray(setStart - bufStart, abs - bufStart + 1).toString('utf8');
          try {
            const wrapper = JSON.parse('{' + slice + '}');
            const code = Object.keys(wrapper)[0];
            await onSet(code, wrapper[code]);
            setsSeen++;
          } catch (e) {
            console.error(`mtj parse fail at offset ${setStart}: ${(e as Error).message}`);
          }
          setStart = -1;
          keyStart = -1;
        } else if (inData && depth === 2) {
          inData = false;
        } else if (!pastMeta && depth === 2) {
          pastMeta = true;
        }
        depth--;
        continue;
      }
    }
    const keepFrom = Math.max(pastMeta ? setStart - bufStart : 0, 0);
    if (keepFrom > 0) {
      buf = buf.subarray(keepFrom);
      bufStart += keepFrom;
    }
  }
  console.log(`  ${setsSeen} MTGJSON sets parsed`);
  return setsSeen;
}

import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sql } from 'drizzle-orm';
import { db, client } from '../db/index.ts';
import { cardFacets, cards, prices } from '../db/schema.ts';

export const DATA_DIR = path.resolve('data');
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

const MTG_RARITY_TIER: Record<string, number> = { common: 1, uncommon: 2, rare: 3, mythic: 4, special: 5, bonus: 5 };
const MTG_WUBRG = 'WUBRG';
const MTG_KINDS = ['Battle', 'Planeswalker', 'Creature', 'Sorcery', 'Instant', 'Artifact', 'Enchantment',
  'Land', 'Kindred', 'Tribal', 'Conspiracy', 'Phenomenon', 'Plane', 'Scheme', 'Vanguard', 'Emblem',
  'Token', 'Card'];

const mtgFacetsFor = (c: any): FacetRow[] => {
  const colors: string[] = c.colors ?? c.card_faces?.flatMap((f: any) => f.colors ?? []) ?? [];
  const uniq = [...new Set(colors)].sort((a, b) => MTG_WUBRG.indexOf(a) - MTG_WUBRG.indexOf(b));
  const rows: FacetRow[] = (uniq.length ? uniq : ['C']).map((v) => ({ cardId: c.id, facet: 'color', value: v }));
  rows.push({ cardId: c.id, facet: 'color_combo', value: uniq.join('') || 'C' });
  rows.push({ cardId: c.id, facet: 'kind', value: MTG_KINDS.find((k) => c.type_line?.includes(k)) ?? 'Other' });
  return rows;
};

const mtgAttrsFor = (c: any) => {
  const face = (f: any) => ({
    name: f.name, mana_cost: f.mana_cost, type_line: f.type_line, oracle_text: f.oracle_text,
    power: f.power, toughness: f.toughness, loyalty: f.loyalty, flavor_text: f.flavor_text,
    security_stamp: f.security_stamp, promo_types: f.promo_types,
    image_small: f.image_uris?.small, image_large: f.image_uris?.large, image_art_crop: f.image_uris?.art_crop,
  });
  return {
    mana_cost: c.mana_cost, cmc: c.cmc, type_line: c.type_line, oracle_text: c.oracle_text,
    power: c.power, toughness: c.toughness, loyalty: c.loyalty, flavor_text: c.flavor_text,
    keywords: c.keywords?.length ? c.keywords : undefined,
    card_faces: c.card_faces?.map(face),
    legalities: c.legalities,
    security_stamp: c.security_stamp, promo_types: c.promo_types,
    frame: c.frame, border_color: c.border_color,
  };
};

export function mtgRowsFor(c: any, asOf: string): { card: CardRow; facets: FacetRow[]; prices: PriceRow[] } {
  const img = c.image_uris ?? c.card_faces?.[0]?.image_uris;
  const card: CardRow = {
    id: c.id, gameId: 'mtg', setId: c.set_id, name: c.name,
    collectorNumber: c.collector_number, sortKey: sortKey(c.collector_number),
    rarityRaw: c.rarity, rarityTier: MTG_RARITY_TIER[c.rarity] ?? 3,
    imageSmall: img?.small ?? null, imageLarge: img?.large ?? img?.normal ?? null, imageArtCrop: img?.art_crop ?? null,
    artist: c.artist ?? null, finishes: c.finishes ?? ['nonfoil'], attrs: mtgAttrsFor(c),
    oracleId: c.oracle_id ?? c.card_faces?.[0]?.oracle_id ?? null,
  };
  const prices: PriceRow[] = [];
  for (const [key, finish] of [['usd', 'nonfoil'], ['usd_foil', 'foil'], ['usd_etched', 'etched']] as const) {
    if (c.prices?.[key]) prices.push({ cardId: c.id, finish, usd: c.prices[key], asOf });
  }
  return { card, facets: mtgFacetsFor(c), prices };
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
}

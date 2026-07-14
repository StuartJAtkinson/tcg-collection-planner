import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
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

export async function upsertCards(cardRows: CardRow[], facetRows: FacetRow[], priceRows: PriceRow[]) {
  if (!cardRows.length) return;
  await db.insert(cards).values(cardRows).onConflictDoUpdate({
    target: cards.id,
    set: {
      name: sql`excluded.name`,
      imageSmall: sql`excluded.image_small`,
      imageLarge: sql`excluded.image_large`,
      finishes: sql`excluded.finishes`,
      attrs: sql`excluded.attrs`,
      rarityRaw: sql`excluded.rarity_raw`,
      rarityTier: sql`excluded.rarity_tier`,
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

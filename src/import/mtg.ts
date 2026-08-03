import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { sql } from 'drizzle-orm';
import { client, db } from '../db/index.ts';
import { games, sets } from '../db/schema.ts';
import { download, getJson, mtgRowsFor, refreshMtgSetMetadata, upsertCards } from './util.ts';
import type { CardRow, FacetRow, PriceRow } from './util.ts';

const today = new Date().toISOString().slice(0, 10);

async function importSets(): Promise<Set<string>> {
  const ids = new Set<string>();
  const rows: (typeof sets.$inferInsert)[] = [];
  let url: string | null = 'https://api.scryfall.com/sets';
  while (url) {
    const page: any = await getJson(url);
    for (const s of page.data) {
      if (s.digital) continue;
      ids.add(s.id);
      rows.push({
        id: s.id, gameId: 'mtg', code: s.code, name: s.name,
        releaseDate: s.released_at ?? null, series: s.block ?? null, setType: s.set_type ?? null,
        cardCount: s.card_count ?? null, iconUrl: s.icon_svg_uri ?? null,
      });
    }
    url = page.has_more ? page.next_page : null;
  }
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(sets).values(rows.slice(i, i + 500)).onConflictDoUpdate({
      target: sets.id,
      set: {
        name: sql`excluded.name`, releaseDate: sql`excluded.release_date`, series: sql`excluded.series`,
        setType: sql`excluded.set_type`, cardCount: sql`excluded.card_count`, iconUrl: sql`excluded.icon_url`,
      },
    });
  }
  console.log(`  ${rows.length} paper sets`);
  return ids;
}

async function main() {
  await db.insert(games).values({ id: 'mtg', name: 'Magic: The Gathering' }).onConflictDoNothing();

  console.log('mtg: sets');
  const setIds = await importSets();

  console.log('mtg: cards');
  const bulk: any = await getJson('https://api.scryfall.com/bulk-data');
  const entry = bulk.data.find((d: any) => d.type === 'default_cards');
  const file = await download(entry.download_uri, 'scryfall-default-cards.json');

  let cardBatch: CardRow[] = [];
  let facetBatch: FacetRow[] = [];
  let priceBatch: PriceRow[] = [];
  let imported = 0;
  let skippedNonPaper = 0;
  let skippedNoSet = 0;

  async function flush() {
    await upsertCards(cardBatch, facetBatch, priceBatch);
    imported += cardBatch.length;
    cardBatch = []; facetBatch = []; priceBatch = [];
  }

  // crossover/Universes Beyond has no set-level flag on Scryfall, but UB *cards* are marked:
  // the 2022-2024 era carries a triangle security stamp, and the 2025+ UB Standard sets
  // (which dropped the triangle for a normal oval) carry promo_types: ['universesbeyond'].
  // A set where most cards match either signal is a crossover set.
  const stampCounts = new Map<string, { tri: number; total: number }>();

  // scryfall bulk files put one card object per line inside a JSON array
  const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }) });
  for await (const raw of rl) {
    const line = raw.trim().replace(/,$/, '');
    if (!line || line === '[' || line === ']') continue;
    const c = JSON.parse(line);
    if (!c.games?.includes('paper')) { skippedNonPaper++; continue; }
    if (!setIds.has(c.set_id)) { skippedNoSet++; continue; }

    const sc = stampCounts.get(c.set_id) ?? { tri: 0, total: 0 };
    sc.total++;
    if (c.security_stamp === 'triangle' || c.promo_types?.includes('universesbeyond')) sc.tri++;
    stampCounts.set(c.set_id, sc);

    const shaped = mtgRowsFor(c, today);
    cardBatch.push(shaped.card);
    facetBatch.push(...shaped.facets);
    priceBatch.push(...shaped.prices);

    if (cardBatch.length >= 1000) {
      await flush();
      if (imported % 10000 === 0) console.log(`  ${imported}…`);
    }
  }
  await flush();

  console.log(`  ${imported} paper cards (skipped ${skippedNonPaper} non-paper, ${skippedNoSet} in digital sets)`);

  console.log('mtg: set legalities');
  const crossoverIds = [...stampCounts]
    .filter(([, v]) => v.total > 0 && v.tri / v.total > 0.5)
    .map(([id]) => id);
  const crossoverCount = await refreshMtgSetMetadata(crossoverIds);
  console.log(`  ${crossoverCount} crossover (Universes Beyond) sets flagged`);

  // Scryfall has no set key-art, so the binder cover marquee falls back to the set's
  // highest-value card image (its most iconic/expensive card reads as the "face" of the set)
  console.log('mtg: cover art (highest-value card per set)');
  await client`
    update sets s set logo_url = best.image_large
    from (
      select distinct on (c.set_id) c.set_id, c.image_large
      from cards c
      left join lateral (
        select usd from prices p where p.card_id = c.id order by p.as_of desc limit 1
      ) p on true
      where c.game_id = 'mtg' and c.image_large is not null
      order by c.set_id, coalesce(p.usd, 0) desc
    ) best
    where s.id = best.set_id`;

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

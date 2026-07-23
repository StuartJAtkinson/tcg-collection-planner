// Nightly MTG price refresh — separate from the bulk mtg importer so the catalogue job
// doesn't re-stream ~700MB just to update today's USD. Fetches Scryfall's bulk metadata,
// downloads the JSONL only when Scryfall says it's newer than our local cache, then
// upserts today's price snapshot per card+finish.
//
// Run: `npm run db:prices` (or via cron / Task Scheduler). Idempotent — prices PK is
// (card_id, finish, as_of), so re-running the same day is a no-op.
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { prices } from '../db/schema.ts';
import { download, getJson } from './util.ts';

const today = new Date().toISOString().slice(0, 10);

async function main() {
  console.log('mtg prices: checking scryfall bulk metadata');
  const meta: any = await getJson('https://api.scryfall.com/bulk-data');
  const entry = meta.data.find((d: any) => d.type === 'default_cards');
  if (!entry) throw new Error('default_cards bulk entry not found');

  // Scryfall emits a fresh filename per refresh (e.g. ...-20260723090259.json); download()
  // caches by local mtime, so reusing it here means we only redownload when Scryfall's
  // updated_at actually moved — `maxAgeHours=0` because the mtime check is what matters.
  const file = await download(entry.download_uri, 'scryfall-default-cards.json', 0);

  // pull the set of card ids we actually imported (the bulk file contains digital-only cards
  // and a few paper cards in digital sets that the catalogue importer skips). Filter the price
  // stream against this set so the FK doesn't blow up on rows we'd never display.
  console.log('mtg prices: loading known card ids');
  const known: Set<string> = new Set(
    (await db.execute(sql`select id from cards where game_id = 'mtg'`)).map((r: any) => r.id as string),
  );
  console.log(`mtg prices: streaming ${entry.download_uri} (${known.size} known cards)`);

  let batch: (typeof prices.$inferInsert)[] = [];
  let total = 0;
  const flush = async () => {
    if (!batch.length) return;
    await db.insert(prices).values(batch).onConflictDoNothing();
    total += batch.length;
    batch = [];
  };

  // jsonl only — one card per line, no array brackets, stream-parse without loading the file
  const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }) });
  for await (const raw of rl) {
    const line = raw.trim().replace(/,$/, '');
    if (!line || line === '[' || line === ']') continue;
    const c = JSON.parse(line);
    if (!c.games?.includes('paper')) continue;
    if (!known.has(c.id)) continue;
    for (const [key, finish] of [['usd', 'nonfoil'], ['usd_foil', 'foil'], ['usd_etched', 'etched']] as const) {
      if (c.prices?.[key]) batch.push({ cardId: c.id, finish, usd: c.prices[key], asOf: today });
    }
    if (batch.length >= 5000) await flush();
  }
  await flush();
  console.log(`mtg prices: wrote ${total} rows for ${today}`);
  // ponytail: skip a delete-old-prices retention policy; the table is small at one row per
  // card×finish×day (~300k/day) and the analytics sparkline queries filter by date range.
}

main().catch((e) => { console.error(e); process.exit(1); });

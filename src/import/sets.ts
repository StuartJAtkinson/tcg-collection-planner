// Targeted MTG set importer — pulls one or more sets that aren't in the local cache yet
// (the cached bulk file is downstream-cached and may not include sets Scryfall shipped since
// the last bulk snapshot, e.g. Universes Beyond releases where the parent sets and tokens
// land in the API before the next daily bulk update). Idempotent: re-importing an existing
// set just re-upserts the same rows.
//
// Usage:
//   node src/import/sets.ts --codes trk,ttrk,trc
//   node src/import/sets.ts --codes trk            # single set
//
// Side effects: pulls card data per code via /cards/search?q=set:CODE+game:paper (paginated),
// fetches full set metadata via /sets/<uuid>, then upserts via the shared helpers in util.ts.
// Re-derives MTG set legalities and crossover flags after the targeted import.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { client, db } from '../db/index.ts';
import { sets, games } from '../db/schema.ts';
import { getJson, mtgRowsFor, refreshMtgSetMetadata, sortKey, upsertCards, type CardRow, type FacetRow, type PriceRow } from './util.ts';

const today = new Date().toISOString().slice(0, 10);

function parseCodes() {
  const { values } = parseArgs({
    options: {
      codes: { type: 'string', multiple: true },
      file: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node src/import/sets.ts --codes trk,ttrk,trc | --file file.txt');
    process.exit(0);
  }
  const codes = (values.codes ?? []).flatMap((v) => v.split(',').map((c) => c.trim()).filter(Boolean));
  if (values.file) {
    codes.push(...readFileSync(values.file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')));
  }
  if (!codes.length) {
    console.error('pass --codes x,y or --file list.txt (one code per line)');
    process.exit(1);
  }
  return codes;
}

// --- per-code import ------------------------------------------------------------
async function importSet(code: string) {
  console.log(`\n[${code}] pulling from /cards/search?q=set:${code}+game:paper`);
  const c: CardRow[] = []; const f: FacetRow[] = []; const p: PriceRow[] = [];
  let url: string | null = `https://api.scryfall.com/cards/search?q=set%3A${encodeURIComponent(code)}+game%3Apaper&unique%3Dcards&order%3Dset&page%3D1`;
  let pageCount = 0;
  let setMeta: any = null;

  while (url) {
    const page: any = await getJson(url);
    pageCount++;
    for (const card of page.data ?? []) {
      if (!card.games?.includes('paper')) continue;
      if (!setMeta) setMeta = await getJson(card.set_uri); // first card carries the set reference
      const shaped = mtgRowsFor(card, today);
      c.push(shaped.card);
      f.push(...shaped.facets);
      p.push(...shaped.prices);
    }
    url = page.has_more ? page.next_page : null;
  }

  if (!setMeta) {
    console.warn(`[${code}] no paper cards found — maybe digital-only or non-MTG code, skipping`);
    return 0;
  }

  await db.insert(games).values({ id: 'mtg', name: 'Magic: The Gathering' }).onConflictDoNothing();
  await db.insert(sets).values({
    id: setMeta.id, gameId: 'mtg', code: setMeta.code, name: setMeta.name,
    releaseDate: setMeta.released_at ?? null, series: setMeta.block ?? null,
    setType: setMeta.set_type ?? null, cardCount: setMeta.card_count ?? null,
    iconUrl: setMeta.icon_svg_uri ?? null,
  }).onConflictDoUpdate({
    target: sets.id,
    set: {
      name: sql`excluded.name`,
      releaseDate: sql`excluded.release_date`,
      setType: sql`excluded.set_type`,
      cardCount: sql`excluded.card_count`,
      iconUrl: sql`excluded.icon_url`,
    },
  });

  await upsertCards(c, f, p);
  console.log(`[${code}] ${setMeta.name} (${setMeta.set_type}) — ${c.length} cards across ${pageCount} page(s)`);
  return c.length;
}

async function main() {
  const codes = parseCodes();
  let total = 0;
  for (const code of codes) total += await importSet(code);
  console.log(`\nDone. Imported ${total} cards across ${codes.length} set(s).`);

  // Re-derive set legalities + crossover flags after a fresh import, mirroring mtg.ts.
  console.log('\nmtg: set legalities (post-targeted-import)');
  console.log('mtg: crossover flags (post-targeted-import)');
  const crossoverCount = await refreshMtgSetMetadata();
  console.log(`  ${crossoverCount} crossover sets flagged`);

  await client.end();
  await db.$client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

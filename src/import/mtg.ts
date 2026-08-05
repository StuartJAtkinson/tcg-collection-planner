import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { createGunzip } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { client, db } from '../db/index.ts';
import { games, sets } from '../db/schema.ts';
import {
  download, getJson,
  MTGJSON_FILE, MTGJSON_URL,
  mtgPrintingFor, mtgRowsFor,
  refreshMtgSetMetadata, streamMtgjsonAll,
  upsertCards, upsertPrintings,
} from './util.ts';
import type { CardRow, FacetRow, MtgjsonCard, MtgPrintingRow, PriceRow } from './util.ts';

const today = new Date().toISOString().slice(0, 10);
const PAPER_BATCH = 1000;
const PRINTING_BATCH = 5000;

// Bulk download switched from default_cards → all_cards so the MTGJSON stream can cross-ref
// every printing (default_cards dropped ~9k foreign/promo entries that MTGJSON tracks).

type SetInfo = { ids: Set<string>; codeToUuid: Map<string, string> };

async function importSets(): Promise<SetInfo> {
  const ids = new Set<string>();
  const codeToUuid = new Map<string, string>();
  const rows: (typeof sets.$inferInsert)[] = [];
  let url: string | null = 'https://api.scryfall.com/sets';
  while (url) {
    const page: any = await getJson(url);
    for (const s of page.data) {
      if (s.digital) continue;
      ids.add(s.id);
      codeToUuid.set(s.code, s.id);
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
  return { ids, codeToUuid };
}

// Stream Scryfall all_cards (gzipped JSONL) into an in-memory Map keyed by Scryfall id.
// No DB writes — the import cross-references MTGJSON to this index. ~250MB resident.
async function buildScryfallIndex(file: string): Promise<Map<string, any>> {
  const byId = new Map<string, any>();
  const rl = readline.createInterface({ input: createReadStream(file).pipe(createGunzip()) });
  let lines = 0;
  for await (const raw of rl) {
    const line = raw.trim().replace(/,$/, '');
    if (!line || line === '[' || line === ']') continue;
    lines++;
    const c = JSON.parse(line);
    byId.set(c.id, c);
  }
  console.log(`  ${lines} lines, ${byId.size} unique Scryfall ids`);
  return byId;
}

// Per MTGJSON set, populate the 8 new sets columns. Skips sets Scryfall doesn't carry.
// ponytail: MTGJSON set codes are uppercase ("MH2"), Scryfall codes are lowercase ("mh2").
// codes are stored lowercase in the DB so we lowercase-strip the map's keys during import.
async function enrichSetFromMtgjson(code: string, set: any, codeToUuid: Map<string, string>): Promise<boolean> {
  const id = codeToUuid.get(code.toLowerCase());
  if (!id) return false;
  await db.update(sets).set({
    blockCode: set.blockCode ?? null,
    parentCode: set.parentCode ?? null,
    mtgoCode: set.mtgoCode ?? null,
    arenaCode: set.arenaCode ?? null,
    isFoilOnly: set.isFoilOnly ?? null,
    isOnlineOnly: set.isOnlineOnly ?? null,
    languages: Array.isArray(set.languages) ? set.languages : null,
    translations: set.translations ?? null,
  }).where(sql`${sets.id} = ${id}`);
  return true;
}

// Pick the "primary" MTGJSON printing per Scryfall card — English nonfoil base, falling back
// to the first MTGJSON uuid in stream order. All other printings still land in mtg_card_printings.
function pickPrimary(printings: MtgjsonCard[]): MtgjsonCard {
  const ideal = printings.find((p) => p.lang === 'English' && (p.isNonFoil !== false || !p.isFoil) && !p.promoTypes?.length);
  return ideal ?? printings[0];
}

async function main() {
  await db.insert(games).values({ id: 'mtg', name: 'Magic: The Gathering' }).onConflictDoNothing();

  console.log('mtg: sets');
  const { ids: setIds, codeToUuid } = await importSets();

  console.log('mtg: scryfall index (all_cards)');
  const bulk: any = await getJson('https://api.scryfall.com/bulk-data');
  const entry = bulk.data.find((d: any) => d.type === 'all_cards');
  // ponytail: Scryfall renamed download_uri → jsonl_download_uri (and gzipped the payload) sometime
  // after this script was first written — fall back to the legacy field for older snapshots.
  const scryUrl = entry.jsonl_download_uri ?? entry.download_uri;
  const scryFile = await download(scryUrl, 'scryfall-all-cards.jsonl.gz');
  const scryById = await buildScryfallIndex(scryFile);

  console.log('mtg: mtgjson');
  await download(MTGJSON_URL, MTGJSON_FILE);

  let cardBatch: CardRow[] = [];
  let facetBatch: FacetRow[] = [];
  let priceBatch: PriceRow[] = [];
  let printingBatch: MtgPrintingRow[] = [];
  let imported = 0;
  let setCardsImported = 0;
  let skippedNonPaper = 0;
  let skippedNoSet = 0;
  let setsEnriched = 0;

  async function flush() {
    if (cardBatch.length) {
      await upsertCards(cardBatch, facetBatch, priceBatch);
      imported += cardBatch.length;
      cardBatch = []; facetBatch = []; priceBatch = [];
    }
    if (printingBatch.length) {
      await upsertPrintings(printingBatch);
      printingBatch = [];
    }
  }

  // MTGJSON's securityStamp/promoTypes are the canonical crossover signal; fall back to
  // Scryfall's per-card fields for cards MTGJSON doesn't carry a primary printing for.
  const stampCounts = new Map<string, { tri: number; total: number }>();

  // Group MTGJSON cards by Scryfall id so we can pick a single primary printing per Scryfall card.
  const byScryfallId = new Map<string, MtgjsonCard[]>();

  await streamMtgjsonAll(async (code, set) => {
    if (await enrichSetFromMtgjson(code, set, codeToUuid)) setsEnriched++;

    for (const mtjCard of [...(set.cards ?? []), ...(set.tokens ?? [])]) {
      const sid = mtjCard.identifiers?.scryfallId;
      if (!sid) continue;
      const sfall = scryById.get(sid);
      if (!sfall) { skippedNonPaper++; continue; }
      if (!setIds.has(sfall.set_id)) { skippedNoSet++; continue; }
      if (!sfall.games?.includes('paper')) { skippedNonPaper++; continue; }

      // Crossover tracking — prefer MTGJSON's canonical fields, fall back to Scryfall.
      const stamp = mtjCard.securityStamp ?? sfall.security_stamp;
      const isUb = (mtjCard.promoTypes ?? sfall.promo_types ?? []).includes('universesbeyond');
      const sc = stampCounts.get(sfall.set_id) ?? { tri: 0, total: 0 };
      sc.total++;
      if (stamp === 'triangle' || isUb) sc.tri++;
      stampCounts.set(sfall.set_id, sc);

      // Accumulate printings for the Scryfall id; we'll flush per set after picking the primary.
      if (!byScryfallId.has(sid)) byScryfallId.set(sid, []);
      byScryfallId.get(sid)!.push(mtjCard);
      printingBatch.push(mtgPrintingFor(mtjCard, sid));
      if (printingBatch.length >= PRINTING_BATCH) {
        await upsertPrintings(printingBatch);
        printingBatch = [];
      }
    }

    // Per set: emit one cards row per Scryfall id (the primary printing).
    setCardsImported = 0;
    for (const [sid, printings] of byScryfallId) {
      const sfall = scryById.get(sid)!;
      const primary = pickPrimary(printings);
      const shaped = mtgRowsFor(primary, sfall, today);
      cardBatch.push(shaped.card);
      facetBatch.push(...shaped.facets);
      priceBatch.push(...shaped.prices);
      setCardsImported++;

      if (cardBatch.length >= PAPER_BATCH) await flush();
    }
    byScryfallId.clear();
    console.log(`  ${code} +${setCardsImported} cards`);
    await flush();
  });
  await flush();

  console.log(`  ${imported} cards imported (skipped ${skippedNonPaper} non-paper / no-scryfall, ${skippedNoSet} in digital sets)`);
  console.log(`  ${setsEnriched} sets enriched with MTGJSON fields`);

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
    update sets s set logo_url = best.image_art_crop
    from (
      select distinct on (c.set_id) c.set_id, c.image_art_crop
      from cards c
      left join lateral (
        select usd from prices p where p.card_id = c.id order by p.as_of desc limit 1
      ) p on true
      where c.game_id = 'mtg' and c.image_art_crop is not null
      order by c.set_id, coalesce(p.usd, 0) desc
    ) best
    where s.id = best.set_id`;

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

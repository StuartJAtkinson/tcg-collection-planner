import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { sql } from 'drizzle-orm';
import { client, db } from '../db/index.ts';
import { games, sets } from '../db/schema.ts';
import { download, getJson, sortKey, upsertCards } from './util.ts';
import type { CardRow, FacetRow, PriceRow } from './util.ts';

const RARITY_TIER: Record<string, number> = { common: 1, uncommon: 2, rare: 3, mythic: 4, special: 5, bonus: 5 };
const WUBRG = 'WUBRG';
// order matters: first match in type_line wins ("Artifact Creature" → Creature)
const KINDS = ['Battle', 'Planeswalker', 'Creature', 'Sorcery', 'Instant', 'Artifact', 'Enchantment',
  'Land', 'Kindred', 'Tribal', 'Conspiracy', 'Phenomenon', 'Plane', 'Scheme', 'Vanguard', 'Emblem',
  'Token', 'Card'];
const today = new Date().toISOString().slice(0, 10);

function facetsFor(c: any): FacetRow[] {
  const colors: string[] = c.colors ?? c.card_faces?.flatMap((f: any) => f.colors ?? []) ?? [];
  const uniq = [...new Set(colors)].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
  const rows: FacetRow[] = (uniq.length ? uniq : ['C']).map((v) => ({ cardId: c.id, facet: 'color', value: v }));
  rows.push({ cardId: c.id, facet: 'color_combo', value: uniq.join('') || 'C' });
  rows.push({ cardId: c.id, facet: 'kind', value: KINDS.find((k) => c.type_line?.includes(k)) ?? 'Other' });
  return rows;
}

function attrsFor(c: any) {
  const face = (f: any) => ({
    name: f.name, mana_cost: f.mana_cost, type_line: f.type_line, oracle_text: f.oracle_text,
    power: f.power, toughness: f.toughness, loyalty: f.loyalty, flavor_text: f.flavor_text,
    image_small: f.image_uris?.small, image_large: f.image_uris?.large,
  });
  return {
    mana_cost: c.mana_cost, cmc: c.cmc, type_line: c.type_line, oracle_text: c.oracle_text,
    power: c.power, toughness: c.toughness, loyalty: c.loyalty, flavor_text: c.flavor_text,
    keywords: c.keywords?.length ? c.keywords : undefined,
    card_faces: c.card_faces?.map(face),
    legalities: c.legalities,
  };
}

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

  // scryfall bulk files put one card object per line inside a JSON array
  const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }) });
  for await (const raw of rl) {
    const line = raw.trim().replace(/,$/, '');
    if (!line || line === '[' || line === ']') continue;
    const c = JSON.parse(line);
    if (!c.games?.includes('paper')) { skippedNonPaper++; continue; }
    if (!setIds.has(c.set_id)) { skippedNoSet++; continue; }

    const img = c.image_uris ?? c.card_faces?.[0]?.image_uris;
    cardBatch.push({
      id: c.id, gameId: 'mtg', setId: c.set_id, name: c.name,
      collectorNumber: c.collector_number, sortKey: sortKey(c.collector_number),
      rarityRaw: c.rarity, rarityTier: RARITY_TIER[c.rarity] ?? 3,
      imageSmall: img?.small ?? null, imageLarge: img?.large ?? img?.normal ?? null,
      artist: c.artist ?? null, finishes: c.finishes ?? ['nonfoil'], attrs: attrsFor(c),
      oracleId: c.oracle_id ?? c.card_faces?.[0]?.oracle_id ?? null,
    });
    facetBatch.push(...facetsFor(c));
    for (const [key, finish] of [['usd', 'nonfoil'], ['usd_foil', 'foil'], ['usd_etched', 'etched']] as const) {
      if (c.prices?.[key]) priceBatch.push({ cardId: c.id, finish, usd: c.prices[key], asOf: today });
    }

    if (cardBatch.length >= 1000) {
      await flush();
      if (imported % 10000 === 0) console.log(`  ${imported}…`);
    }
  }
  await flush();

  console.log(`  ${imported} paper cards (skipped ${skippedNonPaper} non-paper, ${skippedNoSet} in digital sets)`);

  // a set is format-legal iff most of its cards are (banned singles don't disqualify a set)
  console.log('mtg: set legalities');
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

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

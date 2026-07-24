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
// Run mtg: crossover flags afterwards by re-running src/import/mtg.ts (its crossover derivation
// operates on freshly-imported cards and will pick these up automatically).

import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { client, db } from '../db/index.ts';
import { sets, games } from '../db/schema.ts';
import { getJson, sortKey, upsertCards, type CardRow, type FacetRow, type PriceRow } from './util.ts';

const WUBRG = 'WUBRG';
const RARITY_TIER: Record<string, number> = { common: 1, uncommon: 2, rare: 3, mythic: 4, special: 5, bonus: 5 };
const KINDS = ['Battle', 'Planeswalker', 'Creature', 'Sorcery', 'Instant', 'Artifact', 'Enchantment',
  'Land', 'Kindred', 'Tribal', 'Conspiracy', 'Phenomenon', 'Plane', 'Scheme', 'Vanguard', 'Emblem',
  'Token', 'Card'];

const today = new Date().toISOString().slice(0, 10);

// --- argv parsing ----------------------------------------------------------------
async function parseArgs() {
  const args = process.argv.slice(2);
  let i = 0;
  const codes: string[] = [];
  let file: string | null = null;
  while (i < args.length) {
    const a = args[i++];
    if (a === '--codes') codes.push(...(args[i++] ?? '').split(',').filter(Boolean));
    else if (a === '--file') file = args[i++] ?? null;
    else if (a === '--help') {
      console.log('Usage: node src/import/sets.ts --codes trk,ttrk,trc | --file file.txt');
      process.exit(0);
    }
  }
  if (!codes.length && !file) {
    console.error('pass --codes x,y or --file list.txt (one code per line)');
    process.exit(1);
  }
  if (file) {
    const lines = (await import('node:fs')).readFileSync(file, 'utf8').split(/\r?\n/);
    for (const l of lines) {
      const c = l.trim();
      if (c && !c.startsWith('#')) codes.push(c);
    }
  }
  return codes;
}

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
    legalities: c.legalities, security_stamp: c.security_stamp, promo_types: c.promo_types,
    frame: c.frame, border_color: c.border_color,
  };
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
      const img = card.image_uris ?? card.card_faces?.[0]?.image_uris;
      c.push({
        id: card.id, gameId: 'mtg', setId: card.set_id, name: card.name,
        collectorNumber: card.collector_number, sortKey: sortKey(card.collector_number),
        rarityRaw: card.rarity, rarityTier: RARITY_TIER[card.rarity] ?? 3,
        imageSmall: img?.small ?? null, imageLarge: img?.large ?? img?.normal ?? null,
        artist: card.artist ?? null, finishes: card.finishes ?? ['nonfoil'],
        attrs: attrsFor(card), oracleId: card.oracle_id ?? card.card_faces?.[0]?.oracle_id ?? null,
      });
      f.push(...facetsFor(card));
      for (const [k, finish] of [['usd', 'nonfoil'], ['usd_foil', 'foil'], ['usd_etched', 'etched']] as const) {
        if (card.prices?.[k]) p.push({ cardId: card.id, finish, usd: card.prices[k], asOf: today });
      }
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
      name: (await import('drizzle-orm')).sql`excluded.name`,
      releaseDate: (await import('drizzle-orm')).sql`excluded.release_date`,
      setType: (await import('drizzle-orm')).sql`excluded.set_type`,
      cardCount: (await import('drizzle-orm')).sql`excluded.card_count`,
      iconUrl: (await import('drizzle-orm')).sql`excluded.icon_url`,
    },
  });

  await upsertCards(c, f, p);
  console.log(`[${code}] ${setMeta.name} (${setMeta.set_type}) — ${c.length} cards across ${pageCount} page(s)`);
  return c.length;
}

async function main() {
  const codes = await parseArgs();
  let total = 0;
  for (const code of codes) total += await importSet(code);
  console.log(`\nDone. Imported ${total} cards across ${codes.length} set(s).`);

  // Re-derive set legalities + crossover flags after a fresh import, mirroring mtg.ts.
  console.log('\nmtg: set legalities (post-targeted-import)');
  await client`
    update sets s set legalities = l.leg from (
      select set_id, jsonb_object_agg(fmt, 'Legal') as leg
      from (select c.set_id, f.fmt from cards c, jsonb_each_text(c.attrs->'legalities') as f(fmt, status)
            where c.game_id='mtg' group by c.set_id, f.fmt
            having avg((f.status='legal')::int) > 0.5) x
      group by set_id) l where s.id = l.set_id`;

  console.log('mtg: crossover flags (post-targeted-import)');
  // Crossover = the SET where most cards carry the triangle stamp or the `universesbeyond`
  // promo signal. This is the only signal that gets used. It picks up every UB set as long as
  // Scryfall tags the cards (which they have done since the UB program began in 2022). Name
  // heuristics are too imprecise — see "Legends" matching "Marvel Legends" — so we don't add
  // a name fallback. (Ponytail note: leave a signal alone once it works; the 2022 stamp-based
  // detection also covers the 2025+ UB Standard sets that dropped the triangle in favour of a
  // promo_types: universesbeyond flag, since both bits are checked here.)
  const crossoverIds = (await client`
    select set_id
    from (
      select c.set_id,
             (count(*) filter (
                where c.attrs->>'security_stamp' = 'triangle'
                   or c.attrs->'promo_types' ? 'universesbeyond'
             ))::float / nullif(count(*),0) as ratio
      from cards c
      where c.game_id='mtg'
      group by c.set_id
    ) x
    where ratio > 0.5
  `).map((r: any) => r.set_id);

  await client`update sets set crossover = false where game_id = 'mtg'`;
  if (crossoverIds.length) await client`update sets set crossover = true where id = any(${crossoverIds})`;
  console.log(`  ${crossoverIds.length} crossover sets flagged`);

  await client.end();
  await db.$client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

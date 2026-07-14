import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { client, db } from '../db/index.ts';
import { games, sets } from '../db/schema.ts';
import { DATA_DIR, download, sortKey, upsertCards } from './util.ts';
import type { CardRow, FacetRow } from './util.ts';

const REPO_TGZ = 'https://codeload.github.com/PokemonTCG/pokemon-tcg-data/tar.gz/refs/heads/master';

const TIER: Record<string, number> = {
  'Common': 1,
  'Uncommon': 2,
  'Rare': 3, 'Rare Holo': 3, 'Promo': 3, 'Classic Collection': 3, 'Rare BREAK': 3,
  'Double Rare': 4, 'Ultra Rare': 4, 'Rare Ultra': 4, 'Rare Holo EX': 4, 'Rare Holo GX': 4,
  'Rare Holo V': 4, 'Rare Holo VSTAR': 4, 'Rare Holo VMAX': 4, 'Rare Prime': 4, 'Rare ACE': 4,
  'ACE SPEC Rare': 4, 'Rare Prism Star': 4, 'Radiant Rare': 4, 'Amazing Rare': 4,
  'Illustration Rare': 4, 'Trainer Gallery Rare Holo': 4, 'Shiny Rare': 4, 'Rare Shining': 4,
  'Rare Secret': 5, 'Rare Rainbow': 5, 'Rare Shiny': 5, 'Rare Shiny GX': 5, 'Shiny Ultra Rare': 5,
  'Special Illustration Rare': 5, 'Hyper Rare': 5, 'LEGEND': 5,
};

function facetsFor(c: any): FacetRow[] {
  const types: string[] = c.types ?? [];
  const rows: FacetRow[] = types.map((t) => ({ cardId: c.id, facet: 'color', value: t }));
  if (types.length) rows.push({ cardId: c.id, facet: 'color_combo', value: [...types].sort().join('/') });
  rows.push({ cardId: c.id, facet: 'kind', value: c.supertype ?? 'Other' });
  return rows;
}

async function main() {
  await db.insert(games).values({ id: 'pokemon', name: 'Pokémon TCG' }).onConflictDoNothing();

  console.log('pokemon: data');
  const tgz = await download(REPO_TGZ, 'pokemon-tcg-data.tar.gz');
  const root = path.join(DATA_DIR, 'pokemon-tcg-data-master');
  // relative path: GNU tar on Windows reads "H:\…" as a remote host
  if (!existsSync(root)) execSync(`tar -xzf "${path.basename(tgz)}"`, { cwd: DATA_DIR });

  console.log('pokemon: sets');
  const setList: any[] = JSON.parse(readFileSync(path.join(root, 'sets', 'en.json'), 'utf8'));
  const setRows = setList.map((s) => ({
    id: s.id, gameId: 'pokemon', code: s.ptcgoCode ?? s.id, name: s.name,
    releaseDate: s.releaseDate?.replaceAll('/', '-') ?? null, series: s.series ?? null,
    setType: null, cardCount: s.total ?? s.printedTotal ?? null, iconUrl: s.images?.symbol ?? null,
    legalities: s.legalities ?? null,
  }));
  await db.insert(sets).values(setRows).onConflictDoUpdate({
    target: sets.id,
    set: {
      name: sql`excluded.name`, releaseDate: sql`excluded.release_date`, series: sql`excluded.series`,
      cardCount: sql`excluded.card_count`, iconUrl: sql`excluded.icon_url`,
      legalities: sql`excluded.legalities`,
    },
  });
  console.log(`  ${setRows.length} sets`);

  console.log('pokemon: cards');
  const cardDir = path.join(root, 'cards', 'en');
  let cardBatch: CardRow[] = [];
  let facetBatch: FacetRow[] = [];
  let imported = 0;

  for (const f of readdirSync(cardDir)) {
    const setId = path.basename(f, '.json');
    const list: any[] = JSON.parse(readFileSync(path.join(cardDir, f), 'utf8'));
    for (const c of list) {
      cardBatch.push({
        id: c.id, gameId: 'pokemon', setId, name: c.name,
        collectorNumber: c.number, sortKey: sortKey(c.number),
        rarityRaw: c.rarity ?? null, rarityTier: c.rarity ? TIER[c.rarity] ?? 3 : null,
        imageSmall: c.images?.small ?? null, imageLarge: c.images?.large ?? null,
        artist: c.artist ?? null,
        // ponytail: variant detection (reverse holo, 1st ed) deferred to phase 3 holdings
        finishes: ['normal'],
        // no true oracle id for pokemon. Pokédex number is a stable species identity that
        // survives 27 years of name-formatting drift (Farfetch'd's apostrophe, δ-species,
        // "Mr. Mime" spacing…) so it wins for actual Pokémon cards — including multi-number
        // fusion cards (Tag Team GX). Trainer/Energy cards carry no dex number and fall back
        // to normalized name. Either way this only ever drives a display hint, never completion.
        oracleId: c.nationalPokedexNumbers?.length
          ? `dex:${[...c.nationalPokedexNumbers].sort((a: number, b: number) => a - b).join(',')}`
          : c.name.trim().toLowerCase(),
        attrs: {
          hp: c.hp, types: c.types, subtypes: c.subtypes, evolvesFrom: c.evolvesFrom,
          abilities: c.abilities, attacks: c.attacks, weaknesses: c.weaknesses,
          resistances: c.resistances, retreatCost: c.retreatCost, rules: c.rules,
          flavorText: c.flavorText, regulationMark: c.regulationMark,
          nationalPokedexNumbers: c.nationalPokedexNumbers, legalities: c.legalities,
        },
      });
      facetBatch.push(...facetsFor(c));
    }
    if (cardBatch.length >= 1000) {
      imported += cardBatch.length;
      await upsertCards(cardBatch, facetBatch, []);
      cardBatch = []; facetBatch = [];
    }
  }
  imported += cardBatch.length;
  await upsertCards(cardBatch, facetBatch, []);

  console.log(`  ${imported} cards (prices come from the phase-5 nightly job)`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

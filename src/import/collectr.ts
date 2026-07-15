// Imports a Collectr CSV export (Settings -> Export -> CSV in the Collectr app) into holdings.
//
// Collectr's exact native column names aren't publicly documented anywhere I could verify —
// only vague secondary-source descriptions ("card number, name, set, rarity, foil/normal,
// condition, grading, purchase price, quantity, date"), no confirmed literal headers. So this
// reads the CSV's own header row and matches it against a list of aliases per field, case-
// insensitively, and PRINTS what it matched before touching the database. If a column you
// have doesn't show up in the "detected columns" line, tell me its exact header text and I'll
// add the alias — much cheaper than guessing wrong and silently mis-importing your collection.
//
// Rows that can't be confidently matched are written to <file>-unmatched.csv for manual
// review — resolve them at /resolve in the app (candidate search + a mock-card preview per
// candidate), or hand-fix and re-run.
//
// Usage: node src/import/collectr.ts path/to/export.csv
import { readFileSync, writeFileSync } from 'node:fs';
import { client } from '../db/index.ts';
import { bestFuzzySetMatch, GAME_MAP, money, normalizeGrade, norm, parseCsv, pickFinish, portfolioToContainer, resolveHeaders } from './csv.ts';

// containers get created lazily as portfolios appear; cache what's been ensured already
const ensuredContainers = new Set<string>();
async function ensureContainer(c: { id: string; name: string; kind: string }): Promise<string> {
  if (!ensuredContainers.has(c.id)) {
    await client`
      insert into containers (id, user_id, name, kind)
      values (${c.id}, 'stuart', ${c.name}, ${c.kind})
      on conflict (id) do nothing`;
    ensuredContainers.add(c.id);
  }
  return c.id;
}

async function main() {
  const path = process.argv[2];
  if (!path) { console.error('usage: node src/import/collectr.ts path/to/export.csv'); process.exit(1); }

  const rows = parseCsv(readFileSync(path, 'utf8'));
  const [header, ...dataRows] = rows;
  const idx = resolveHeaders(header);

  console.log('detected columns:');
  for (const [field, i] of Object.entries(idx)) console.log(`  ${field.padEnd(15)} <- "${header[i]}"`);
  const missingCore = ['name', 'set'].filter((f) => !(f in idx));
  if (missingCore.length) {
    console.error(`\nCouldn't find required column(s): ${missingCore.join(', ')}. Header row was:`);
    console.error('  ' + header.map((h) => `"${h}"`).join(', '));
    console.error('Tell me the exact header text for these fields and I\'ll add the alias.');
    process.exit(1);
  }
  console.log(`\n${dataRows.length} rows to import`);
  console.log('note: quantities ADD on re-run — re-running the same file twice will double-count.');
  console.log('If you need a clean retry (e.g. fixed a column mismatch), clear holdings first.\n');

  const setCache = new Map<string, { id: string; gameId: string }[]>(); // norm(name)|code -> candidate sets
  const allSets = await client`select id, game_id, code, name from sets`;
  for (const s of allSets) {
    for (const key of [norm(s.name), norm(s.code)]) {
      if (!setCache.has(key)) setCache.set(key, []);
      setCache.get(key)!.push({ id: s.id, gameId: s.game_id });
    }
  }

  const unmatched: { row: string[]; reason: string }[] = [];
  let matched = 0, skipped = 0, watchlisted = 0, fuzzySets = 0;
  const TRUTHY = new Set(['true', '1', 'yes']);

  for (const row of dataRows) {
    const get = (f: string) => (f in idx ? row[idx[f]]?.trim() : undefined);
    const name = get('name');
    const setName = get('set');
    const setCode = get('setCode');
    const number = get('number');
    if (!name || !setName) { skipped++; continue; }
    if (get('watchlist') && TRUTHY.has(get('watchlist')!.toLowerCase())) { watchlisted++; continue; }

    const gameField = get('game');
    const gameHint = gameField ? GAME_MAP[norm(gameField)] : undefined;
    if (gameField && !gameHint) { unmatched.push({ row, reason: `unsupported game: "${gameField}"` }); continue; }
    let setCandidates = setCache.get(norm(setName)) ?? (setCode ? setCache.get(norm(setCode)) : undefined) ?? [];
    if (gameHint) setCandidates = setCandidates.filter((s) => s.gameId === gameHint);
    if (!setCandidates.length) {
      const pool = gameHint ? allSets.filter((s) => s.game_id === gameHint) : allSets;
      const fuzzy = bestFuzzySetMatch(setName, pool.map((s) => ({ id: s.id, gameId: s.game_id, name: s.name })));
      if (fuzzy) { setCandidates = [fuzzy]; fuzzySets++; }
    }
    if (!setCandidates.length) { unmatched.push({ row, reason: `no set matching "${setName}"` }); continue; }
    // ambiguous set name across games with no game hint: try both, prefer exact card match below
    const setIds = [...new Set(setCandidates.map((s) => s.id))];

    let card: { id: string; finishes: string[] } | undefined;
    if (number) {
      const byNumber = await client`
        select id, finishes from cards
        where set_id = any(${setIds}) and lower(collector_number) = ${number.toLowerCase()}`;
      card = byNumber[0];
    }
    if (!card) {
      const byName = await client`
        select id, finishes from cards
        where set_id = any(${setIds}) and lower(name) = ${name.toLowerCase()}`;
      if (byName.length === 1) card = byName[0];
      else if (byName.length > 1) { unmatched.push({ row, reason: `"${name}" ambiguous in "${setName}" (${byName.length} matches, no/bad number)` }); continue; }
    }
    if (!card) { unmatched.push({ row, reason: `"${name}" not found in "${setName}"` }); continue; }

    const finish = pickFinish(card.finishes, get('variant'));
    const quantity = get('quantity') ? parseInt(get('quantity')!, 10) || 1 : 1;
    const paidRaw = get('purchasePrice');
    const paid = paidRaw ? money(paidRaw) : null;
    const condition = get('condition') || null;
    const grade = normalizeGrade(get('grade'), get('gradingCompany'));
    const containerId = await ensureContainer(portfolioToContainer(get('portfolio')));

    await client`
      insert into holdings (user_id, card_id, finish, container_id, quantity, condition, grade, paid)
      values ('stuart', ${card.id}, ${finish}, ${containerId}, ${quantity}, ${condition}, ${grade}, ${paid})
      on conflict (user_id, card_id, finish, container_id)
      do update set quantity = holdings.quantity + excluded.quantity,
                     condition = coalesce(excluded.condition, holdings.condition),
                     grade = coalesce(excluded.grade, holdings.grade),
                     paid = coalesce(holdings.paid, excluded.paid)`;
    matched++;
  }

  const containerCount = ensuredContainers.size;
  console.log(`containers: ${containerCount} (Main + ${Math.max(0, containerCount - 1)} decks)`);

  console.log(`imported: ${matched} (of which via fuzzy set-name matching: ${fuzzySets})`);
  console.log(`skipped (blank row): ${skipped}`);
  console.log(`skipped (watchlist, not owned): ${watchlisted}`);
  console.log(`unmatched: ${unmatched.length}`);

  if (unmatched.length) {
    const reviewPath = path.replace(/\.csv$/i, '') + '-unmatched.csv';
    const out = [
      [...header, 'reason'].join(','),
      ...unmatched.map((u) => [...u.row, u.reason].map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    writeFileSync(reviewPath, out);
    console.log(`unmatched rows written to ${reviewPath} for manual review — or resolve them at /resolve?file=${encodeURIComponent(reviewPath)}`);
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

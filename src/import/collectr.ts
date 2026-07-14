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
// Usage: node src/import/collectr.ts path/to/export.csv
import { readFileSync, writeFileSync } from 'node:fs';
import { client } from '../db/index.ts';

const ALIASES: Record<string, string[]> = {
  game: ['game', 'tcg', 'category', 'sport'],
  name: ['card name', 'name', 'item name', 'card', 'title', 'product name'],
  set: ['set name', 'set', 'edition', 'series'],
  setCode: ['set code', 'code', 'set abbreviation'],
  number: ['card number', 'collector number', 'number', 'card #', '#', 'no.'],
  rarity: ['rarity'],
  variant: ['variant', 'variance', 'foil', 'finish', 'foil/normal', 'printing'],
  condition: ['condition', 'card condition'],
  gradingCompany: ['grading company', 'grader', 'graded by'],
  grade: ['grade', 'grading', 'grade value'],
  quantity: ['quantity', 'qty', 'count'],
  purchasePrice: ['purchase price', 'paid', 'price paid', 'cost', 'cost basis', 'average cost paid'],
  dateAdded: ['date added', 'date', 'purchase date', 'date acquired'],
  watchlist: ['watchlist', 'wishlist'],
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

const DIACRITIC_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(DIACRITIC_MARKS, '').replace(/[^a-z0-9]/g, '');
const money = (s: string) => { const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };

function resolveHeaders(headerRow: string[]) {
  const normed = headerRow.map(norm);
  const idx: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const i = normed.findIndex((h) => aliases.some((a) => norm(a) === h));
    if (i !== -1) idx[field] = i;
  }
  return idx;
}

const GAME_MAP: Record<string, string> = {
  magic: 'mtg', mtg: 'mtg', magicthegathering: 'mtg',
  pokemon: 'pokemon', pokemontcg: 'pokemon',
};

// exporters vary in set-name spelling ("10th Edition" vs "Tenth Edition", "Commander: X" vs
// "X Commander", "Universes Beyond: X" vs "X") too much to enumerate by hand, so exact/code
// lookup falls back to token-overlap scoring rather than a hardcoded alias table.
const ORDINALS: Record<string, string> = {
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth',
  '6th': 'sixth', '7th': 'seventh', '8th': 'eighth', '9th': 'ninth', '10th': 'tenth',
  '11th': 'eleventh', '12th': 'twelfth',
};
const stem = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokenize = (s: string) =>
  new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => stem(ORDINALS[w] ?? w)));

function bestFuzzySetMatch(setName: string, candidates: { id: string; gameId: string; name: string }[]) {
  const target = tokenize(setName);
  let best: { id: string; gameId: string; name: string; score: number } | undefined;
  let secondScore = 0;
  for (const c of candidates) {
    const tokens = tokenize(c.name);
    const intersection = [...target].filter((t) => tokens.has(t)).length;
    const union = new Set([...target, ...tokens]).size;
    const score = union ? intersection / union : 0;
    if (!best || score > best.score) { secondScore = best?.score ?? 0; best = { ...c, score }; }
    else if (score > secondScore) secondScore = score;
  }
  return best && best.score >= 0.4 && best.score - secondScore >= 0.1 - 1e-9 ? best : undefined;
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

    const variant = get('variant')?.toLowerCase() ?? '';
    const finish = card.finishes.find((f) => variant.includes(f.toLowerCase()))
      ?? (variant.includes('foil') || variant.includes('holo') ? card.finishes.find((f) => f !== 'nonfoil' && f !== 'normal') : undefined)
      ?? card.finishes[0] ?? 'normal';

    const quantity = get('quantity') ? parseInt(get('quantity')!, 10) || 1 : 1;
    const paidRaw = get('purchasePrice');
    const paid = paidRaw ? money(paidRaw) : null;
    const condition = get('condition') || null;
    const gradeRaw = get('grade');
    const grade = !gradeRaw || gradeRaw.toLowerCase() === 'ungraded' ? null
      : get('gradingCompany') ? `${get('gradingCompany')} ${gradeRaw}` : gradeRaw;

    await client`
      insert into holdings (user_id, card_id, finish, quantity, condition, grade, paid)
      values ('stuart', ${card.id}, ${finish}, ${quantity}, ${condition}, ${grade}, ${paid})
      on conflict (user_id, card_id, finish)
      do update set quantity = holdings.quantity + excluded.quantity,
                     condition = coalesce(excluded.condition, holdings.condition),
                     grade = coalesce(excluded.grade, holdings.grade),
                     paid = coalesce(holdings.paid, excluded.paid)`;
    matched++;
  }

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
    console.log(`unmatched rows written to ${reviewPath} for manual review`);
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

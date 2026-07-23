// Collectr parse + catalogue-match core, shared by the CLI (src/import/collectr.ts) and the
// in-app import server action. This function does NO writes: it returns the matched holdings,
// the unmatched rows, and the portfolio containers it would create (with a presumed kind). The
// caller decides what to persist — the CLI commits directly; the app stages the result and
// only commits when you click Import.
import { client } from '../db/index.ts';
import { bestFuzzySetMatch, GAME_MAP, money, norm, normalizeGrade, parseCsv, parseDate, pickFinish, portfolioToContainer, resolveHeaders } from './csv.ts';

export type MatchedHolding = {
  card_id: string; finish: string; quantity: number;
  condition: string | null; grade: string | null; paid: number | null;
  container_id: string; container_name: string;
  held_since?: string | null; // YYYY-MM-DD; null if CSV's Date Added cell was unparseable
};
export type UnmatchedRow = { fields: Record<string, string>; reason: string };
export type StagedContainer = { id: string; name: string; count: number; presumedKind: 'binder' | 'deck' };

// the parsed Collectr columns we keep on an unmatched row so it can be re-searched and, once
// resolved, turned into a holding (mirrors what resolveImportRows consumes)
const KEEP_FIELDS = ['name', 'set', 'setCode', 'number', 'rarity', 'variant', 'quantity', 'purchasePrice', 'dateAdded', 'condition', 'grade', 'gradingCompany', 'portfolio', 'game'];
const TRUTHY = new Set(['true', '1', 'yes']);

export async function runCollectrImport(csvText: string): Promise<{
  matched: MatchedHolding[]; unmatched: UnmatchedRow[]; containers: StagedContainer[];
  skipped: number; watchlisted: number;
}> {
  const rows = parseCsv(csvText);
  const [header, ...dataRows] = rows;
  const idx = resolveHeaders(header ?? []);
  const missing = ['name', 'set'].filter((f) => !(f in idx));
  if (missing.length) throw new Error(`CSV missing required column(s): ${missing.join(', ')}. Header: ${(header ?? []).join(', ')}`);

  const setCache = new Map<string, { id: string; gameId: string }[]>();
  const allSets = await client`select id, game_id, code, name from sets`;
  for (const s of allSets) {
    for (const key of [norm(s.name), norm(s.code)]) {
      if (!setCache.has(key)) setCache.set(key, []);
      setCache.get(key)!.push({ id: s.id, gameId: s.game_id });
    }
  }

  const matched: MatchedHolding[] = [];
  const unmatched: UnmatchedRow[] = [];
  let skipped = 0, watchlisted = 0;

  for (const row of dataRows) {
    const get = (f: string) => (f in idx ? row[idx[f]]?.trim() : undefined);
    const fieldsOf = () => Object.fromEntries(KEEP_FIELDS.map((f) => [f, get(f) ?? '']));
    const name = get('name');
    const setName = get('set');
    const setCode = get('setCode');
    const number = get('number');
    if (!name || !setName) { skipped++; continue; }
    if (get('watchlist') && TRUTHY.has(get('watchlist')!.toLowerCase())) { watchlisted++; continue; }

    const gameField = get('game');
    const gameHint = gameField ? GAME_MAP[norm(gameField)] : undefined;
    if (gameField && !gameHint) { unmatched.push({ fields: fieldsOf(), reason: `unsupported game: "${gameField}"` }); continue; }
    let setCandidates = setCache.get(norm(setName)) ?? (setCode ? setCache.get(norm(setCode)) : undefined) ?? [];
    if (gameHint) setCandidates = setCandidates.filter((s) => s.gameId === gameHint);
    if (!setCandidates.length) {
      const pool = gameHint ? allSets.filter((s) => s.game_id === gameHint) : allSets;
      const fuzzy = bestFuzzySetMatch(setName, pool.map((s) => ({ id: s.id, gameId: s.game_id, name: s.name })));
      if (fuzzy) setCandidates = [fuzzy];
    }
    if (!setCandidates.length) { unmatched.push({ fields: fieldsOf(), reason: `no set matching "${setName}"` }); continue; }
    const setIds = [...new Set(setCandidates.map((s) => s.id))];

    let card: { id: string; finishes: string[] } | undefined;
    if (number) {
      const byNumber = await client`select id, finishes from cards where set_id = any(${setIds}) and lower(collector_number) = ${number.toLowerCase()}`;
      card = byNumber[0] as unknown as { id: string; finishes: string[] };
    }
    if (!card) {
      const byName = await client`select id, finishes from cards where set_id = any(${setIds}) and lower(name) = ${name.toLowerCase()}`;
      if (byName.length === 1) card = byName[0] as unknown as { id: string; finishes: string[] };
      else if (byName.length > 1) { unmatched.push({ fields: fieldsOf(), reason: `"${name}" ambiguous in "${setName}" (${byName.length} matches, no/bad number)` }); continue; }
    }
    if (!card) { unmatched.push({ fields: fieldsOf(), reason: `"${name}" not found in "${setName}"` }); continue; }

    const paidRaw = get('purchasePrice');
    const container = portfolioToContainer(get('portfolio'));
    matched.push({
      card_id: card.id,
      finish: pickFinish(card.finishes, get('variant')),
      quantity: get('quantity') ? parseInt(get('quantity')!, 10) || 1 : 1,
      condition: get('condition') || null,
      grade: normalizeGrade(get('grade'), get('gradingCompany')),
      paid: paidRaw ? money(paidRaw) : null,
      container_id: container.id,
      container_name: container.name,
      held_since: parseDate(get('dateAdded')),
    });
  }

  // presume each portfolio's kind by summed quantity (>100 = a set/collection binder, else a
  // play deck); the global unsorted pool isn't a choosable location so it's excluded.
  const counts = new Map<string, { name: string; count: number }>();
  for (const m of matched) {
    if (m.container_id === 'unsorted') continue;
    const c = counts.get(m.container_id) ?? { name: m.container_name, count: 0 };
    c.count += m.quantity;
    counts.set(m.container_id, c);
  }
  const containers: StagedContainer[] = [...counts]
    .map(([id, v]) => ({ id, name: v.name, count: v.count, presumedKind: (v.count > 100 ? 'binder' : 'deck') as 'binder' | 'deck' }))
    .sort((a, b) => b.count - a.count);

  return { matched, unmatched, containers, skipped, watchlisted };
}

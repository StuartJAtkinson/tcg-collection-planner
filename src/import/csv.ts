// CSV parsing + fuzzy set-name matching shared between the Collectr CLI importer and the
// web-based /resolve unmatched-row tool, so both use identical matching logic.

export const ALIASES: Record<string, string[]> = {
  portfolio: ['portfolio name', 'portfolio', 'folder', 'deck name', 'collection name'],
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

export function parseCsv(text: string): string[][] {
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

const DIACRITIC_MARKS = /[̀-ͯ]/g;
export const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(DIACRITIC_MARKS, '').replace(/[^a-z0-9]/g, '');
export const money = (s: string) => { const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };

// Best-effort date parser for Collectr's "Date Added" / "Purchase Date" column. Returns a UTC
// ISO `YYYY-MM-DD` string or null if the cell has no recognisable date. Accepts the four
// shapes we see in the wild: ISO, YYYY/MM/DD, M/D/YYYY and MM/DD/YYYY (US). Ambiguous 3- and
// 4-digit numbers are not attempted — the user-provided header is the signal to try.
export function parseDate(s: string | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // ISO already YYYY-MM-DD
  let m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return pad(+m[1], +m[2], +m[3]);
  // YYYY/MM/DD
  m = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return pad(+m[1], +m[2], +m[3]);
  // M/D/YYYY (US — first part is the month if <= 12)
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return pad(yy(+m[3]), +m[1], +m[2]);
  return null;
}
const pad = (y: number, mo: number, d: number) =>
  Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d) && mo >= 1 && mo <= 12 && d >= 1 && d <= 31
    ? `${y.toString().padStart(4, '0')}-${mo.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`
    : null;
const yy = (n: number) => (n < 100 ? 2000 + n : n);

export function resolveHeaders(headerRow: string[]) {
  const normed = headerRow.map(norm);
  const idx: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const i = normed.findIndex((h) => aliases.some((a) => norm(a) === h));
    if (i !== -1) idx[field] = i;
  }
  return idx;
}

export const GAME_MAP: Record<string, string> = {
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

export function tokenScore(a: string, b: string): number {
  const ta = tokenize(a), tb = tokenize(b);
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union ? intersection / union : 0;
}

// picks which finish a "Foil"/"Variance"-type column value refers to, among a card's actual
// finishes — shared so the CLI importer and the /resolve web tool agree on the same card.
export function pickFinish(finishes: string[], variantRaw: string | undefined): string {
  const variant = variantRaw?.toLowerCase() ?? '';
  return finishes.find((f) => variant.includes(f.toLowerCase()))
    ?? (variant.includes('foil') || variant.includes('holo') ? finishes.find((f) => f !== 'nonfoil' && f !== 'normal') : undefined)
    ?? finishes[0] ?? 'normal';
}

export function normalizeGrade(gradeRaw: string | undefined, gradingCompany: string | undefined): string | null {
  if (!gradeRaw || gradeRaw.toLowerCase() === 'ungraded') return null;
  return gradingCompany ? `${gradingCompany} ${gradeRaw}` : gradeRaw;
}

// Collectr's Portfolio Name -> container. Initial import classifies conservatively: "Main"
// (or blank/unknown) becomes the 'unsorted' pool — cards you own but haven't physically filed
// into a binder — and every other portfolio becomes a 'deck'. Whether a portfolio is really a
// deck vs a binder is refined afterwards on the portfolio-interpretation step (/binders →
// Interpret portfolios), which just changes container.kind.
export function portfolioToContainer(portfolio: string | undefined): { id: string; name: string; kind: string } {
  const name = portfolio?.trim();
  if (!name || norm(name) === 'main') return { id: 'unsorted', name: 'Unsorted collection', kind: 'unsorted' };
  return { id: norm(name), name, kind: 'deck' };
}

export function bestFuzzySetMatch<T extends { name: string }>(setName: string, candidates: T[]) {
  let best: (T & { score: number }) | undefined;
  let secondScore = 0;
  for (const c of candidates) {
    const score = tokenScore(setName, c.name);
    if (!best || score > best.score) { secondScore = best?.score ?? 0; best = { ...c, score }; }
    else if (score > secondScore) secondScore = score;
  }
  return best && best.score >= 0.4 && best.score - secondScore >= 0.1 - 1e-9 ? best : undefined;
}

// Probe: is `(setId, collectorNumber, lang)` a universal unique key across
// Scryfall and MTGJSON? Streams both cached bulk files, builds counts under
// three key shapes per side, and writes docs/composite-key-probe.json.
//
//   Key A: setId|collectorNumber                 (no language)
//   Key B: setId|collectorNumber|lang            (lang from c.lang / foreignData)
//   Key C: setId|collectorNumber|finishes[]      (one row per finish in c.finishes)
//
// For each shape, log: total rows, distinct keys, duplicate count (groups >1),
// top-5 example duplicates. Also counts cross-side coverage: how many MTGJSON
// rows have a matching Scryfall row by scryfallId, then by composite.
//
// Usage: npm run probe:composite-key
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import readline from 'node:readline';
import path from 'node:path';

const SCRY = path.resolve('data/scryfall-all-cards.jsonl.gz');
const MTJ = path.resolve('data/AllPrintings.json.gz');
const OUT = path.resolve('docs/composite-key-probe.json');
mkdirSync(path.dirname(OUT), { recursive: true });

if (!existsSync(SCRY)) throw new Error(`Missing ${SCRY}`);
if (!existsSync(MTJ)) throw new Error(`Missing ${MTJ}`);

type DupGroup = { key: string; count: number; sample: any[] };
type Counts = {
  rows: number;
  distinctKeys: number;
  duplicateGroups: number;
  top5: DupGroup[];
  exampleKeys: { scryfallId?: string; set: string; num: string; lang: string; finishes?: string[] }[];
};

function summarize(map: Map<string, any[]>): {
  total: number; distinct: number; dupCount: number; top5: DupGroup[];
} {
  const groups: DupGroup[] = [];
  let dupCount = 0;
  for (const [key, items] of map) {
    if (items.length > 1) {
      dupCount++;
      if (groups.length < 5) groups.push({ key, count: items.length, sample: items.slice(0, 3) });
    }
  }
  groups.sort((a, b) => b.count - a.count);
  return { total: [...map.values()].reduce((s, v) => s + v.length, 0), distinct: map.size, dupCount, top5: groups.slice(0, 5) };
}

// ---------- Scryfall side ----------
console.log('Scryfall: scanning default_cards...');
const scryKeyA = new Map<string, any[]>();
const scryKeyB = new Map<string, any[]>();
const scryKeyC = new Map<string, any[]>();
const scryByScryfallId = new Map<string, any>();
let scryRows = 0;
let scryPaper = 0;
let scryNonPaper = 0;
let scryLangHisto = new Map<string, number>();

const rl = readline.createInterface({ input: createReadStream(SCRY).pipe(createGunzip()) });
for await (const raw of rl) {
  const line = raw.trim().replace(/,$/, '');
  if (!line || line === '[' || line === ']') continue;
  scryRows++;
  const c = JSON.parse(line);
  const paper = c.games?.includes('paper');
  if (!paper) { scryNonPaper++; continue; }
  scryPaper++;
  const set = c.set_id;
  const num = c.collector_number;
  const lang = c.lang ?? '';
  const finishes: string[] = c.finishes ?? ['nonfoil'];
  scryLangHisto.set(lang, (scryLangHisto.get(lang) ?? 0) + 1);
  const sample = { scryfallId: c.id, set, num, lang, finishes };
  scryByScryfallId.set(c.id, sample);
  const a = `${set}|${num}`;
  if (!scryKeyA.has(a)) scryKeyA.set(a, []);
  scryKeyA.get(a)!.push(sample);
  const b = `${a}|${lang}`;
  if (!scryKeyB.has(b)) scryKeyB.set(b, []);
  scryKeyB.get(b)!.push(sample);
  for (const f of finishes) {
    const k = `${a}|${f}`;
    if (!scryKeyC.has(k)) scryKeyC.set(k, []);
    scryKeyC.get(k)!.push(sample);
  }
}
console.log(`  ${scryRows} total lines, ${scryPaper} paper cards, ${scryNonPaper} non-paper skipped`);
const scryA = summarize(scryKeyA);
const scryB = summarize(scryKeyB);
const scryC = summarize(scryKeyC);
console.log(`  Key A (set|num):               ${scryA.distinct} distinct, ${scryA.dupCount} duplicate groups (of ${scryA.total} rows)`);
console.log(`  Key B (set|num|lang):          ${scryB.distinct} distinct, ${scryB.dupCount} duplicate groups (of ${scryB.total} rows)`);
console.log(`  Key C (set|num|finishes):      ${scryC.distinct} distinct, ${scryC.dupCount} duplicate groups (of ${scryC.total} rows)`);

// ---------- MTGJSON side (streaming parser) ----------
console.log('MTGJSON: scanning AllPrintings.json.gz...');
const mtjKeyA = new Map<string, any[]>();
const mtjKeyB = new Map<string, any[]>();
const mtjKeyD = new Map<string, any[]>();  // (set|num|mtgUuid)
const mtjKeyE = new Map<string, any[]>();  // (set|num|scryfallId)
const mtjByScryfallId = new Map<string, any>();
const mtjByUuid = new Map<string, any>();
let mtjSets = 0;
let mtjCards = 0;
let mtjTokens = 0;
let mtjMissingScryfall = 0;
let mtjMissingUuid = 0;
let mtjLangHisto = new Map<string, number>();

// Minimal copy of the depth-tracking parser from scripts/count_schema_fields.ts.
// On per-set completion, iterate cards+tokens and emit keys.
const stream = createReadStream(MTJ).pipe(createGunzip());
let buf = Buffer.alloc(0);
let bufStart = 0;
let pos = 0;
let depth = 0;
let inStr = false;
let esc = false;
let pastMeta = false;
let inData = false;
let setStart = -1;
let keyStart = -1;

async function processSet(slice: string) {
  let set: any;
  try { set = JSON.parse('{' + slice + '}'); }
  catch { return; }
  const code = Object.keys(set)[0];
  const setObj = set[code];
  if (!setObj) return;
  mtjSets++;
  for (const arr of [setObj.cards ?? [], setObj.tokens ?? []]) {
    for (const card of arr) {
      if (arr === setObj.cards) mtjCards++; else mtjTokens++;
      const num = card.number ?? '';
      const langs: string[] = [];
      if (Array.isArray(card.foreignData) && card.foreignData.length) {
        for (const f of card.foreignData) langs.push(f.language ?? '');
      } else {
        langs.push('English');
      }
      for (const lang of langs) {
        mtjLangHisto.set(lang, (mtjLangHisto.get(lang) ?? 0) + 1);
      }
      const sample = {
        uuid: card.uuid, scryfallId: card.identifiers?.scryfallId ?? null,
        set: code, num, langs,
      };
      const sid = card.identifiers?.scryfallId;
      const uuid = card.uuid;
      if (!uuid) mtjMissingUuid++;
      if (!sid) mtjMissingScryfall++;
      else if (!mtjByScryfallId.has(sid)) mtjByScryfallId.set(sid, sample);
      if (uuid && !mtjByUuid.has(uuid)) mtjByUuid.set(uuid, sample);
      const a = `${code}|${num}`;
      if (!mtjKeyA.has(a)) mtjKeyA.set(a, []);
      mtjKeyA.get(a)!.push(sample);
      for (const lang of langs) {
        const b = `${a}|${lang}`;
        if (!mtjKeyB.has(b)) mtjKeyB.set(b, []);
        mtjKeyB.get(b)!.push(sample);
      }
      if (uuid) {
        const d = `${a}|${uuid}`;
        if (!mtjKeyD.has(d)) mtjKeyD.set(d, []);
        mtjKeyD.get(d)!.push(sample);
      }
      if (sid) {
        const e = `${a}|${sid}`;
        if (!mtjKeyE.has(e)) mtjKeyE.set(e, []);
        mtjKeyE.get(e)!.push(sample);
      }
    }
  }
}

for await (const chunk of stream) {
  const c = chunk as Buffer;
  buf = Buffer.concat([buf, c]);
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    const abs = pos++;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === 0x5c) esc = true;
      else if (ch === 0x22) inStr = false;
      continue;
    }
    if (ch === 0x22) {
      if (depth === 2 && !inStr && keyStart === -1 && pastMeta && inData) keyStart = abs;
      inStr = true;
      continue;
    }
    if (ch === 0x7b || ch === 0x5b) {
      depth++;
      if (pastMeta && !inData && depth === 2) inData = true;
      else if (inData && depth === 3 && keyStart !== -1) setStart = keyStart;
      continue;
    }
    if (ch === 0x7d || ch === 0x5d) {
      if (inData && depth === 3 && setStart !== -1) {
        const slice = buf.subarray(setStart - bufStart, abs - bufStart + 1).toString('utf8');
        await processSet(slice);
        setStart = -1; keyStart = -1;
      } else if (inData && depth === 2) inData = false;
      else if (!pastMeta && depth === 2) pastMeta = true;
      depth--;
      continue;
    }
  }
  const keepFrom = Math.max(pastMeta ? setStart - bufStart : 0, 0);
  if (keepFrom > 0) { buf = buf.subarray(keepFrom); bufStart += keepFrom; }
}

const mtjA = summarize(mtjKeyA);
const mtjB = summarize(mtjKeyB);
const mtjD = summarize(mtjKeyD);
const mtjE = summarize(mtjKeyE);
console.log(`  ${mtjSets} sets parsed, ${mtjCards} cards, ${mtjTokens} tokens`);
console.log(`  Key A (set|num):                  ${mtjA.distinct} distinct, ${mtjA.dupCount} duplicate groups (of ${mtjA.total} rows)`);
console.log(`  Key B (set|num|lang):             ${mtjB.distinct} distinct, ${mtjB.dupCount} duplicate groups (of ${mtjB.total} rows)`);
console.log(`  Key D (set|num|mtgUuid):          ${mtjD.distinct} distinct, ${mtjD.dupCount} duplicate groups (of ${mtjD.total} rows)`);
console.log(`  Key E (set|num|scryfallId):       ${mtjE.distinct} distinct, ${mtjE.dupCount} duplicate groups (of ${mtjE.total} rows)`);
console.log(`  ${mtjMissingScryfall} MTGJSON rows missing scryfallId`);
console.log(`  ${mtjMissingUuid} MTGJSON rows missing uuid`);

// ---------- Cross-side coverage ----------
let mtjWithScryfall = 0;
let mtjMatchedByScryfallId = 0;
let mtjMatchedByComposite = 0;
let mtjUnmatched = 0;
let mtjWithUuid = mtjByUuid.size;
let mtjUuidDistinct = mtjByUuid.size;
for (const [sid, sample] of mtjByScryfallId) {
  mtjWithScryfall++;
  if (scryByScryfallId.has(sid)) { mtjMatchedByScryfallId++; continue; }
  // Try composite fallback
  const a = `${sample.set}|${sample.num}`;
  const scryGroups = scryKeyA.get(a);
  if (scryGroups && scryGroups.length) mtjMatchedByComposite++; else mtjUnmatched++;
}
console.log(`  cross-side: ${mtjWithScryfall} MTGJSON cards with scryfallId; ${mtjMatchedByScryfallId} matched by id, ${mtjMatchedByComposite} matched by composite, ${mtjUnmatched} unmatched`);
console.log(`  MTGUUID uniqueness: ${mtjUuidDistinct} distinct uuids across ${mtjCards + mtjTokens} rows`);

// ---------- Save report ----------
const report = {
  scryfall: {
    totalLines: scryRows,
    paperCards: scryPaper,
    nonPaperSkipped: scryNonPaper,
    langHistogram: Object.fromEntries(scryLangHisto),
    keyA: scryA,
    keyB: scryB,
    keyC: scryC,
  },
  mtgjson: {
    sets: mtjSets, cards: mtjCards, tokens: mtjTokens,
    missingScryfallId: mtjMissingScryfall,
    missingUuid: mtjMissingUuid,
    uuidDistinct: mtjUuidDistinct,
    langHistogram: Object.fromEntries(mtjLangHisto),
    keyA: mtjA,
    keyB: mtjB,
    keyD: mtjD,
    keyE: mtjE,
  },
  crossSide: {
    mtjWithScryfallId: mtjWithScryfall,
    matchedByScryfallId: mtjMatchedByScryfallId,
    matchedByComposite: mtjMatchedByComposite,
    unmatched: mtjUnmatched,
  },
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\nReport → ${OUT}`);

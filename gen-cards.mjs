// Regenerates cards.json.gz from data/scryfall-default-cards.jsonl.gz — the real
// catalogue the page renders, in place of the hand-written CARD_ROWS mocks.
// Run: node gen-cards.mjs   (the bulk file is what `npm run import` already downloads)
//
// ponytail: generated and committed like sets.js, not fetched from Scryfall at
// runtime. Unlike sets.js it is too big to inline in index.html, so it ships as
// one gzipped file the page fetches once — serve.py sends it with
// Content-Encoding: gzip, which means fetch().json() decompresses it for free and
// no client-side gunzip is needed.
//
// The split is what keeps it affordable. 107k printings share 37.5k distinct
// cards, so the rules text — the expensive field by a distance — is stored once
// per ORACLE and pointed at by index. Flat, every printing carrying its own copy
// of the text, is 10.2 MB gzipped; split it is 5.3 MB with the same information.
import { createReadStream, writeFileSync, statSync } from 'node:fs';
import { createGunzip, gzipSync } from 'node:zlib';
import readline from 'node:readline';

// the page's rarity tiers: MockCard draws the set symbol in one of five inks
const RAR = { common: 1, uncommon: 2, rare: 3, mythic: 4, special: 5, bonus: 5 };

const oracleIdx = new Map();
const oracles = [];      // [name, manaCost, typeLine, rulesText, pt, colours, cmc]
const printings = [];    // [oracle, set, number, rarity, artId, usd]

const rl = readline.createInterface({
  input: createReadStream('data/scryfall-default-cards.jsonl.gz').pipe(createGunzip()),
});

let lines = 0, skipped = 0;
for await (const raw of rl) {
  const line = raw.trim().replace(/,$/, '');
  if (!line || line === '[' || line === ']') continue;
  lines++;
  let c;
  try { c = JSON.parse(line); } catch { skipped++; continue; }
  // paper only, to match sets.js — the app imports with game:paper
  if (c.digital || !c.games?.includes('paper')) { skipped++; continue; }

  // a double-faced card renders its front; the back is a printing detail the
  // mock never drew either, so it stays out rather than doubling the file
  const f = c.card_faces?.[0] ?? c;
  const oid = c.oracle_id ?? `x${c.id}`;

  let i = oracleIdx.get(oid);
  if (i === undefined) {
    i = oracles.length;
    oracleIdx.set(oid, i);
    oracles.push([
      c.name,
      f.mana_cost ?? '',
      f.type_line ?? c.type_line ?? '',
      f.oracle_text ?? '',
      f.power != null ? `${f.power}/${f.toughness}` : '',
      (c.colors ?? f.colors ?? []).join(''),
      c.cmc ?? 0,
    ]);
  }
  printings.push([
    i,
    (c.set || '').toUpperCase(),
    c.collector_number,
    RAR[c.rarity] ?? 1,
    c.id,                                    // cards.scryfall.io keys art by this
    +(c.prices?.usd ?? 0) || 0,
  ]);
}

const json = JSON.stringify({ o: oracles, p: printings });
writeFileSync('cards.json.gz', gzipSync(json, { level: 9 }));

const kb = statSync('cards.json.gz').size;
console.log(`cards.json.gz — ${oracles.length.toLocaleString('en-GB')} cards · ${
  printings.length.toLocaleString('en-GB')} printings · ${
  (json.length / 1e6).toFixed(1)} MB raw · ${(kb / 1e6).toFixed(2)} MB gzipped${
  skipped ? ` · skipped ${skipped.toLocaleString('en-GB')} digital/unparsed of ${lines.toLocaleString('en-GB')}` : ''}`);

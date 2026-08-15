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
// The split is what keeps it affordable. 107k printings share ~37.5k distinct
// cards, so the rules text — the expensive field by a distance — is stored once
// per ORACLE and pointed at by index. Flat, every printing carrying its own copy
// of the text, is 10.2 MB gzipped; split it is ~5.3 MB with the same information.
import { createReadStream, writeFileSync, statSync } from 'node:fs';
import { createGunzip, gzipSync } from 'node:zlib';
import readline from 'node:readline';

// the page's rarity tiers: MockCard draws the set symbol in one of five inks
const RAR = { common: 1, uncommon: 2, rare: 3, mythic: 4, special: 5, bonus: 5 };

/* CARD ANATOMY — the thing this file used to throw away.
   MockCard was written for the overwhelming majority: one name, one art window,
   one type line, one rules box. That is 85,145 of 107,214 paper printings and
   nothing else. The other 22,069 are a different SHAPE of card, and the shape is
   two independent facts that the source reports separately:

     layout     how many faces there are and where they sit — one side, two
                halves of one side, or two sides you physically turn over.
     treatment  how the illustration relates to the frame — in a window, bleeding
                past it, to the card's edge, or under the whole card with the
                text laid over it.

   Neither was carried, so a Saga, a split card, a transform and a full-art
   basic all arrived here as "normal" and drew as the same rectangle. Both are
   read off the source, never inferred: `layout` is Scryfall's own field, and
   treatment falls out of full_art / textless / border_color / frame_effects in
   that order of precedence — most-containing wins, because a borderless
   showcase is still borderless as far as the frame is concerned. */
const treatOf = (c) => {
  const fe = new Set(c.frame_effects || []);
  if (c.textless) return 'textless';            // no rules box at all
  if (c.full_art) return 'fullart';             // art under the whole card
  if (c.border_color === 'borderless') return 'borderless';
  if (fe.has('extendedart')) return 'extendedart';  // art past the window, frame intact
  if (fe.has('showcase')) return 'showcase';        // an alternate frame, same anatomy
  return 0;                                     // 0, not 'framed' — see the note below
};

/* A face, in the same field order as the oracle's own front slots so the page
   can hand either to the same renderer. Loyalty is here and was not before:
   the mock rows have always carried `loy`, the catalogue never did, so every
   planeswalker in the real data drew with an empty badge. */
const faceOf = (f, c) => [
  f.name ?? c.name ?? '',
  f.mana_cost ?? '',
  f.type_line ?? c.type_line ?? '',
  f.oracle_text ?? c.oracle_text ?? '',
  f.power != null ? `${f.power}/${f.toughness}` : '',
  f.loyalty ?? f.defense ?? '',
  (f.colors ?? c.colors ?? []).join(''),
];

const oracleIdx = new Map();
const oracles = [];      // [name, cost, type, text, pt, col, cmc, layout, loy, faces]
const printings = [];    // [oracle, set, number, rarity, artId, usd, treatment]

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

  /* The front's fields still sit in slots 1..5, because every list, sort and
     filter in the page reads them there and a two-faced card is sorted by its
     front. What changed is that the BACK is no longer dropped on the floor:
     `faces` carries every face, so a transform can be turned over and a split
     can draw both halves. Falling back to the root when a face has none is the
     other half of that fix — 3,250 printings (art series, some tokens, a few
     DFCs) hang their type line off the root and were arriving with a bare
     "Card" and no rules text. */
  const faces = c.card_faces?.length ? c.card_faces.map(f => faceOf(f, c)) : 0;
  const f = c.card_faces?.[0] ?? c;

  /* Keyed by oracle AND layout, not oracle alone. The same card is printed in
     more than one anatomy — Ghalta is a normal card in RIX and a reversible_card
     in Secret Lair, sharing one oracle_id — so an oracle-only key would let
     whichever printing was read first decide the shape of all of them. */
  const oid = `${c.oracle_id ?? `x${c.id}`}:${c.layout}`;

  let i = oracleIdx.get(oid);
  if (i === undefined) {
    i = oracles.length;
    oracleIdx.set(oid, i);
    oracles.push([
      c.name,                                   // the identity: "A // B" for two faces
      f.mana_cost ?? '',
      f.type_line ?? c.type_line ?? '',
      f.oracle_text ?? c.oracle_text ?? '',
      f.power != null ? `${f.power}/${f.toughness}` : '',
      (c.colors ?? f.colors ?? []).join(''),
      c.cmc ?? 0,
      c.layout || 'normal',
      f.loyalty ?? f.defense ?? c.loyalty ?? '',
      faces,
    ]);
  }
  printings.push([
    i,
    (c.set || '').toUpperCase(),
    c.collector_number,
    RAR[c.rarity] ?? 1,
    c.id,                                    // cards.scryfall.io keys art by this
    +(c.prices?.usd ?? 0) || 0,
    /* 0 rather than 'framed' for the 85,145 ordinary cards. The treatment is a
       per-printing field, so it is written 107,214 times; a one-character
       falsy marker for the default case is the difference between a tail that
       compresses to nothing and one that does not. */
    treatOf(c),
  ]);
}

const json = JSON.stringify({ o: oracles, p: printings });
writeFileSync('cards.json.gz', gzipSync(json, { level: 9 }));

// The anatomy census, printed because it is the input to the /anatomy page and
// to every "does this render" judgement made from it — a class that quietly
// stops appearing should be visible here, not three screens later.
const census = new Map();
for (const p of printings) {
  const k = `${oracles[p[0]][7]} | ${p[6] || 'framed'}`;
  census.set(k, (census.get(k) || 0) + 1);
}
const kb = statSync('cards.json.gz').size;
console.log(`cards.json.gz — ${oracles.length.toLocaleString('en-GB')} cards · ${
  printings.length.toLocaleString('en-GB')} printings · ${
  (json.length / 1e6).toFixed(1)} MB raw · ${(kb / 1e6).toFixed(2)} MB gzipped${
  skipped ? ` · skipped ${skipped.toLocaleString('en-GB')} digital/unparsed of ${lines.toLocaleString('en-GB')}` : ''}`);
console.log(`anatomy — ${census.size} classes, ${
  [...census.values()].filter(n => n >= 6).length} of them with six printings or more`);
for (const [k, n] of [...census].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(6)}  ${k}`);

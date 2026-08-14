// Regenerates boosters/<CODE>.json from MTGJSON's `set.booster` — the real
// collation, weights included. Run: node gen-boosters.mjs
//
// Until now the page drew packs from a hand-written rarity-tier table (`SHEET`,
// `PACK_KINDS` in index.html), which is a plausible imitation of a booster and
// not a booster. MTGJSON carries what the packs actually contain:
//
//   set.booster.<kind>.boosters[]  [{ weight, contents: { sheet: count } }]
//   set.booster.<kind>.sheets      { name: { totalWeight, foil, cards: { uuid: weight } } }
//
// so a pack is: pick a recipe by weight, then for each sheet slot pick a card by
// its own weight on that sheet. No rarity tiers, no guessing which cards can
// appear — the sheets say, per card, and a card on two sheets carries a
// different weight on each.
//
// ponytail: one file PER SET, fetched when you open the window, not one bundle.
// Every sheet of every set is ~90k entries; sets.js is loaded on every page and
// has no business carrying the collation for 186 sets you are not opening.
//
// THE UUID PROBLEM. Sheets are keyed by MTGJSON uuid; the static page's
// catalogue is Scryfall printings keyed by set + collector number, and carries
// no MTGJSON id. Rather than widen 107k catalogue rows to carry one, the
// generator resolves uuid -> "SET:number" here and emits that.
//
// SET, not just number, because A SHEET IS NOT LIMITED TO ITS OWN SET: the Play
// Booster's List slot and the Special Guest slot deal cards from other sets
// entirely, and they are 16% of all sheet entries. Resolving numbers only while
// scanning the owning set silently threw every one of them away.
import { writeFileSync, mkdirSync, readdirSync, rmSync, statSync, createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

const scanBraces = (s, st) => {   // advance st over s; return index past the close, or -1
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (st.inStr) {
      if (st.esc) st.esc = false;
      else if (ch === '\\') st.esc = true;
      else if (ch === '"') st.inStr = false;
      continue;
    }
    if (ch === '"') { st.inStr = true; continue; }
    if (ch === '{') st.depth++;
    else if (ch === '}') { st.depth--; if (st.depth === 0) return i + 1; }
  }
  return -1;
};

/* Which configurations are worth emitting. `play`/`draft`/`default` are what a
   set is drafted with — the same preference order packsFor() uses — and
   `collector` is the one a Booster pull may reach for. The rest (`set`,
   `arena`, `prerelease`, `jumpstart`) are products nobody drafts. */
const KINDS = ['play', 'draft', 'default', 'collector'];

const sets = new Map();     // code -> { kinds: {kind: {...}} }
const uuidAt = new Map();   // uuid -> "SET:number", every card in the file

function takeBooster(code, booster) {
  const kinds = {};
  for (const kind of KINDS) {
    const cfg = booster[kind];
    if (!cfg?.boosters?.length || !cfg.sheets) continue;
    const sheets = {};
    for (const [name, sheet] of Object.entries(cfg.sheets)) {
      const cards = Object.entries(sheet.cards ?? {});
      if (!cards.length) continue;
      sheets[name] = {
        total: sheet.totalWeight || cards.reduce((t, [, w]) => t + w, 0),
        foil: sheet.foil ? 1 : 0,
        cards: Object.fromEntries(cards),        // uuid -> weight, resolved later
      };
    }
    if (!Object.keys(sheets).length) continue;
    kinds[kind] = {
      total: cfg.boostersTotalWeight || (cfg.boosters ?? []).reduce((t, b) => t + (b.weight || 0), 0),
      recipes: (cfg.boosters ?? []).map((b) => [b.weight || 0, b.contents || {}]),
      sheets,
    };
  }
  if (Object.keys(kinds).length) sets.set(code, { kinds });
}

/* One pass. Two things are read out of it and they interleave: a set's booster
   block (before its cards) and the uuid -> number of the cards a sheet asked
   for. Pairing is sequential rather than per-card JSON: within one card object
   MTGJSON's keys are alphabetical, so `number` always precedes `uuid`, and the
   only other `"uuid":` in the file is on the same card. `variations` and
   `otherFaceIds` are bare uuid STRINGS in arrays, not `"uuid":` keys, so they
   cannot desynchronise the pairing. */
async function scan() {
  /* ONE regex, matched in document order. Splitting it into a set pass and a
     card pass reads a chunk's cards against whichever set's booster block that
     chunk happened to end on, which silently resolved 16% of sheet entries
     against the wrong set and dropped them. Order is the whole correctness
     argument here — `booster` precedes `cards` within a set, and `number`
     precedes `uuid` within a card, both because MTGJSON's keys are alphabetical. */
  const rx = /"([A-Z0-9_]{2,8})":\{"baseSetSize"|"booster":\{|"number":"((?:[^"\\]|\\.)*)"|"uuid":"([0-9a-f-]{36})"/g;
  let tail = '', cur = null, acc = null, num = null, resumeAt = 0;
  const stream = createReadStream('data/AllPrintings.json.gz').pipe(createGunzip());
  for await (const chunk of stream) {
    // while capturing, the tail would be re-read and doubled into the block
    const text = acc ? chunk.toString('latin1') : tail + chunk.toString('latin1');
    tail = text.slice(-2100);

    let from = 0;
    if (acc) {
      const end = scanBraces(text, acc);
      acc.parts.push(end < 0 ? text : text.slice(0, end));
      if (end < 0) continue;
      finish();
      from = resumeAt;
    }

    let m; rx.lastIndex = from;
    while ((m = rx.exec(text))) {
      if (m[1] !== undefined) { cur = m[1]; num = null; continue; }   // a new set starts
      if (m[2] !== undefined) { num = m[2]; continue; }
      // a card ends: pair it. Every card in the file, because a sheet may name
      // one from any set — filtering to the owning set's own uuids is what lost
      // the List and Special Guest slots.
      if (m[3] !== undefined) {
        // CONSUME the number. A card carries exactly one `number` then one
        // `uuid`, but a set also carries `decks[].mainBoard[]` entries
        // ({uuid, count, isFoil}) and sealedProduct uuids, none of which have a
        // number of their own — left uncleared they inherit the previous card's,
        // and MKM's last card ended up wearing 287 uuids.
        if (num !== null && cur) { uuidAt.set(m[3], `${cur}:${num}`); num = null; }
        continue;
      }
      // "booster":{ — capture the block whole, then carry on from past it
      if (!cur || sets.has(cur)) continue;         // chunk overlap re-reads the block
      acc = { code: cur, parts: [], depth: 0, inStr: false, esc: false };
      const rest = text.slice(m.index + '"booster":'.length);
      const end = scanBraces(rest, acc);
      acc.parts.push(end < 0 ? rest : rest.slice(0, end));
      if (end < 0) { resumeAt = 0; break; }
      finish();
      rx.lastIndex = m.index + '"booster":'.length + end;
    }
  }

  function finish() {
    try { takeBooster(acc.code, JSON.parse(acc.parts.join(''))); }
    catch { /* a block we cannot read is a set with no collation, which is honest */ }
    resumeAt = acc.parts.at(-1).length;            // resume the scan past the block
    acc = null;
  }
}

await scan();

/* Resolve uuid -> number and drop what did not resolve. A sheet entry with no
   printing behind it is a card the page cannot draw, and leaving it in would
   make the weights add up to a pack that cannot be dealt. */
/* CONFLUX IS CALLED CON, AND WINDOWS WILL NOT HAVE A FILE CALLED THAT. `CON`,
   `PRN`, `AUX`, `NUL`, `COM1-9` and `LPT1-9` are device names reserved since DOS,
   extension and all — Node's fs reaches past the Win32 layer and writes one
   anyway, and then nothing else can read it: `git add` failed with "No such file
   or directory" on a file `ls` was quite happy to list, and serve.py's open()
   would have failed the same way. A trailing underscore is the escape, and it has
   to be applied in all three places that name these files — here, the fetch in
   index.html, and serve.py's allow-list — or the set silently has no collation. */
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const packFile = (code) => RESERVED.test(code) ? `${code}_` : code;

mkdirSync('boosters', { recursive: true });
for (const f of readdirSync('boosters')) if (f.endsWith('.json')) rmSync(`boosters/${f}`);

let written = 0, bytes = 0, entries = 0, dropped = 0, emptySheets = 0;
const index = {};
for (const [code, { kinds }] of sets) {
  const out = {};
  for (const [kind, cfg] of Object.entries(kinds)) {
    const sheets = {};
    for (const [name, sheet] of Object.entries(cfg.sheets)) {
      const cards = {};
      let total = 0;
      for (const [uuid, w] of Object.entries(sheet.cards)) {
        const n = uuidAt.get(uuid);
        if (n === undefined) { dropped++; continue; }
        // two uuids can share a number (a card and its foil-only variant), so
        // the weights add rather than the later one winning
        cards[n] = (cards[n] || 0) + w;
        total += w;
      }
      if (!total) { emptySheets++; continue; }
      sheets[name] = { total, foil: sheet.foil, cards };
      entries += Object.keys(cards).length;
    }
    // a recipe naming a sheet that did not survive cannot be dealt
    const recipes = cfg.recipes.filter(([, c]) => Object.keys(c).every((s) => sheets[s]));
    if (!recipes.length || !Object.keys(sheets).length) continue;
    out[kind] = { total: recipes.reduce((t, [w]) => t + w, 0), recipes, sheets };
  }
  if (!Object.keys(out).length) continue;
  const json = JSON.stringify({ code, kinds: out });
  writeFileSync(`boosters/${packFile(code)}.json`, json);
  index[code] = Object.keys(out);
  written++; bytes += json.length;
}

writeFileSync('boosters/index.json', JSON.stringify(index));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`${written} sets · ${entries.toLocaleString()} sheet entries · ${kb(bytes)} total · ${kb(bytes / written)} avg`);
console.log(`${dropped.toLocaleString()} sheet entries had no printing behind them · ${emptySheets} sheets dropped whole`);
const counts = Object.values(index).flat().reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
console.log(Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(' · '));
console.log(`index ${kb(statSync('boosters/index.json').size)}`);

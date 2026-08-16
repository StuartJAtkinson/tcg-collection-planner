// Writes data/lang-index.json - which LANGUAGES each printing was actually
// printed in, keyed by "SET/collector_number".
//
// WHY IT IS A SEPARATE PASS OVER A DIFFERENT FILE. The catalogue is built from
// `default-cards`, which is ONE ROW PER PRINTING: measured, 0 of 107,347
// set/number pairs carry more than one language row, and 104,713 of them are
// English. So the app has never been able to answer "does this printing exist
// in Japanese" - the language on a catalogue row is the language that row was
// catalogued in, not the set of languages the card was printed in.
//
// `all-cards` is the file that can answer it: every language of every printing,
// 373 MB on disk against default-cards' 74 MB. It is read here rather than in
// gen-cards.mjs so the expensive pass is one you run when you want it - the
// index it writes is small, and gen-cards folds it in whenever it is present.
//
// A DIM PIP IS A CLAIM, which is the whole reason this exists. Drawing the pips
// off the catalogue alone would have shown 18 dim and 1 lit on every card in
// the app, i.e. "this card was never printed in Japanese" about several
// thousand cards that were. Absent data has to look absent, so where this file
// is missing the column says so rather than drawing a row of dim pips.
import { createReadStream, writeFileSync, existsSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import readline from 'node:readline';

const SRC = 'data/scryfall-all-cards.jsonl.gz';
if (!existsSync(SRC)) {
  console.error(`${SRC} is not here. Config's Scryfall row names the file and the command.`);
  process.exit(1);
}

const rl = readline.createInterface({ input: createReadStream(SRC).pipe(createGunzip()) });

// "SET/num" -> Set of language codes. A Set rather than a mask while reading,
// because the vocabulary is not known until the file is finished - it is
// counted out of the data below rather than declared here.
const seen = new Map();
let lines = 0, kept = 0;
for await (const raw of rl) {
  const line = raw.trim().replace(/,$/, '');
  if (!line || line === '[' || line === ']') continue;
  lines++;
  let c;
  try { c = JSON.parse(line); } catch { continue; }
  // the same gate gen-cards.mjs uses, so the two indexes cover the same rows
  if (c.digital || !c.games?.includes('paper')) continue;
  kept++;
  const k = `${(c.set || '').toUpperCase()}/${c.collector_number}`;
  (seen.get(k) || seen.set(k, new Set()).get(k)).add(c.lang || 'en');
  if (lines % 500000 === 0) console.log(`  ${lines} lines · ${seen.size} printings`);
}

// The vocabulary, most-printed first, taken from the data - a hand-typed list of
// Magic's languages is a list that goes stale the next time one is added, and
// the order decides the pip column's order.
const freq = new Map();
for (const s of seen.values()) for (const l of s) freq.set(l, (freq.get(l) || 0) + 1);
const LANGS = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);

const at = new Map(LANGS.map((l, i) => [l, i]));
const index = {};
for (const [k, s] of seen) {
  let mask = 0;
  for (const l of s) mask |= 1 << at.get(l);
  index[k] = mask;
}

writeFileSync('data/lang-index.json', JSON.stringify({ langs: LANGS, index }));
console.log(`data/lang-index.json - ${seen.size} printings, ${LANGS.length} languages`);
console.log(LANGS.map(l => `${l} ${freq.get(l)}`).join(' · '));
const multi = [...seen.values()].filter(s => s.size > 1).length;
console.log(`${multi} printings exist in more than one language`);

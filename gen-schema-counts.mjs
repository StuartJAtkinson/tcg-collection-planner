/* Fills the 23 real gaps in docs/schema-counts.json - rows whose coverage was
   never measured (see ISSUES.md, "23 schema variables name a vendor field
   whose coverage was never counted"). The other 16 null rows are app
   constants with no vendor field behind them and stay null; they are not
   touched here.

   Run: node gen-schema-counts.mjs    (rewrites docs/schema-counts.json) */
import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import readline from 'node:readline';

const path = 'docs/schema-counts.json';
const doc = JSON.parse(readFileSync(path, 'utf8'));

/* ---------- Scryfall: two passes over the flat per-printing bulk file.
   Pass 1 collects, per set code, whether ANY card in it carries the signal
   three "Sets" rows aggregate (legalities / crossover / logo art); pass 2
   counts printings against that aggregate. Cheap - 77 MB gz, twice. */
const SC = 'data/scryfall-default-cards.jsonl.gz';
const crossover = (c) => c.security_stamp === 'triangle' || !!c.promo_types?.includes('universesbeyond');
async function scryfallPass(onCard) {
  const rl = readline.createInterface({ input: createReadStream(SC).pipe(createGunzip()) });
  for await (const raw of rl) {
    const t = raw.trim().replace(/,$/, '');
    if (!t || t === '[' || t === ']') continue;
    let c; try { c = JSON.parse(t); } catch { continue; }
    onCard(c);
  }
}

const setAgg = new Map(); // code -> { legal, crossover, art }
await scryfallPass((c) => {
  const a = setAgg.get(c.set) ?? setAgg.set(c.set, { legal: false, crossover: false, art: false }).get(c.set);
  if (c.legalities && Object.keys(c.legalities).length) a.legal = true;
  if (crossover(c)) a.crossover = true;
  if (c.image_uris?.art_crop) a.art = true;
});

/* Set.printed_size and Set.tcgplayer_id live only on the /sets object, not on
   any card row - the same live call gen-sets.mjs already makes. Paper only,
   matching the app's own import scope. */
const res = await fetch('https://api.scryfall.com/sets', {
  headers: { 'User-Agent': 'card-collection-draft/1.0', Accept: 'application/json' },
});
const { data: allSets } = await res.json();
const setMeta = new Map(allSets.filter((s) => !s.digital).map((s) => [s.code,
  { printedSize: s.printed_size != null, tcgplayerId: s.tcgplayer_id != null }]));

const sf = {
  sortKey: 0, hasFoil: 0, hasNonfoil: 0, rulingsUri: 0, starter: 0, explorer: 0,
  legalPresent: 0, setSearchUri: 0, setScryUri: 0, setUri: 0, printedSize: 0,
  tcgplayerSetId: 0, legalAgg: 0, crossoverAgg: 0, logoAgg: 0, deckTypes: 0, total: 0,
};
await scryfallPass((c) => {
  sf.total++;
  if (c.collector_number) sf.sortKey++;
  if (c.finishes?.includes('foil')) sf.hasFoil++;
  if (c.finishes?.includes('nonfoil')) sf.hasNonfoil++;
  if (c.rulings_uri) sf.rulingsUri++;
  if ('booster' in c) sf.starter++;
  if (c.legalities?.explorer) sf.explorer++;
  if (c.legalities && Object.keys(c.legalities).length) sf.legalPresent++;
  if (c.set_search_uri) sf.setSearchUri++;
  if (c.scryfall_set_uri) sf.setScryUri++;
  if (c.set_uri) sf.setUri++;
  if (setMeta.get(c.set)?.printedSize) sf.printedSize++;
  if (setMeta.get(c.set)?.tcgplayerId) sf.tcgplayerSetId++;
  const a = setAgg.get(c.set);
  if (a?.legal) sf.legalAgg++;
  if (a?.crossover) sf.crossoverAgg++;
  if (a?.art) sf.logoAgg++;
  if (c.set_type) sf.deckTypes++;
});

/* ---------- MTGJSON: stream AllPrintings set-by-set, brace-matching each
   "CODE":{...} block whole (same technique as gen-sets.mjs/gen-boosters.mjs -
   one set's cards array parses fine in memory; the whole 1.5 GB+ file does
   not). hasFoil/hasNonFoil/isStarter/numberSort are v4 field names: this
   file is v5.3.0 and none of the four exist in it any more (grepped the
   full decompressed stream to confirm). The four are NOT one case, though:
   foil/nonfoil are answered by v5's `finishes`, the same array the Scryfall
   side already reads, so those two are measured off it and compare properly.
   numberSort and isStarter have no v5 equivalent at all, so they stay a blank
   rather than a zero - the same treatment as a row with no vendor field. */
const scanBraces = (s, st) => {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (st.inStr) { if (st.esc) st.esc = false; else if (ch === '\\') st.esc = true; else if (ch === '"') st.inStr = false; continue; }
    if (ch === '"') { st.inStr = true; continue; }
    if (ch === '{') st.depth++;
    else if (ch === '}') { st.depth--; if (st.depth === 0) return i + 1; }
  }
  return -1;
};

const mj = {
  sortKey: 0, rulings: 0, hasFoil: 0, hasNonfoil: 0, starter: 0, explorer: 0,
  leadership: 0, tcgplayerSetId: 0, legalPresent: 0, legalAgg: 0, deckTypes: 0, total: 0,
};
function takeSet(setObj) {
  const cards = setObj.cards ?? [];
  const anyLegal = cards.some((c) => c.legalities && Object.keys(c.legalities).length);
  const hasType = setObj.type != null;
  for (const c of cards) {
    mj.total++;
    /* numberSort and isStarter are v4 names with no v5 equivalent at all, unlike
       hasFoil below. The probe stays so a reinstated field is counted rather
       than assumed absent forever; until then it is 0, and `|| null` at the
       write below turns that into "no field to measure", which is what the
       schema row now says in words. */
    if (c.numberSort != null) mj.sortKey++;
    if (c.rulings?.length) mj.rulings++;
    // v4's hasFoil/hasNonFoil are gone from v5; finishes is the field that
    // answers the same question, and it is the one the Scryfall side already
    // reads - so both columns count the same array under the same name.
    if (c.finishes?.includes('foil')) mj.hasFoil++;
    if (c.finishes?.includes('nonfoil')) mj.hasNonfoil++;
    if (c.isStarter != null) mj.starter++;
    if (c.legalities?.explorer) mj.explorer++;
    if (c.legalities && Object.keys(c.legalities).length) mj.legalPresent++;
    if (c.leadershipSkills != null) mj.leadership++;
    if (c.identifiers?.tcgplayerProductId != null) mj.tcgplayerSetId++;
    if (anyLegal) mj.legalAgg++;
    if (hasType) mj.deckTypes++;
  }
}

{
  const rx = /"([A-Z0-9_]{2,8})":\{"baseSetSize"/g;
  let tail = '', cur = null, acc = null, resumeAt = 0;
  const stream = createReadStream('data/AllPrintings.json.gz').pipe(createGunzip());
  for await (const chunk of stream) {
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
      cur = m[1];
      const rest = text.slice(m.index + m[1].length + 3); // past `"CODE":`
      acc = { code: cur, parts: [], depth: 0, inStr: false, esc: false };
      const end = scanBraces(rest, acc);
      acc.parts.push(end < 0 ? rest : rest.slice(0, end));
      if (end < 0) { resumeAt = 0; break; }
      finish();
      rx.lastIndex = m.index + m[1].length + 3 + end;
    }
  }
  function finish() {
    try { takeSet(JSON.parse(acc.parts.join(''))); }
    catch { /* an unparseable set block contributes nothing, not a wrong count */ }
    resumeAt = acc.parts.at(-1).length;
    acc = null;
  }
}

/* ---------- write the 23 rows. Everything else in the file is untouched. */
const set = (key, s, m) => { doc.counts[key] = { scryfall: s, mtgjson: m }; };

set('Identity::Sort key', sf.sortKey, mj.sortKey || null);
set('Card text::Rulings (date)', null, mj.rulings);        // scryfall bulk carries no rulings, only a live-API link
set('Card text::Rulings (text)', null, mj.rulings);
set('Faces::Face 1 UUID', 0, null);                         // Card.face_one_id is not a real Scryfall field
set('Faces::Face 2 UUID', 0, null);
set('Frame & finish::Has foil', sf.hasFoil, mj.hasFoil);
set('Frame & finish::Has nonfoil', sf.hasNonfoil, mj.hasNonfoil);
set('Print::Rulings URI', sf.rulingsUri, null);
set('Promo & content::Starter card', sf.starter, mj.starter || null);
set('Prices::as_of', sf.total, mj.total);                   // stamped once per import row, so this IS full coverage
set('Legalities::Explorer', sf.explorer, mj.explorer);
set('Leadership & roles::Leadership skills object', null, mj.leadership);
set('Sets::Set search URI', sf.setSearchUri, null);
set('Sets::Set scry URI', sf.setScryUri, null);
set('Sets::Set URI (Scryfall)', sf.setUri, null);
set('Sets::Printed size', sf.printedSize, null);
set('Sets::TCGplayer set id', sf.tcgplayerSetId, mj.tcgplayerSetId);
set('Sets::Set legalities (aggregated)', sf.legalAgg, mj.legalAgg);
set('Sets::Set crossover flag', sf.crossoverAgg, sf.crossoverAgg); // mtgjson row reuses this same Scryfall-derived signal
set('Sets::Set logo URL', sf.logoAgg, null);
set('Taxonomy (app)::MTG_DECK_TYPES', sf.deckTypes, mj.deckTypes);
set('Taxonomy (app)::FORMAT_LIST (mtg)', sf.legalPresent, mj.legalPresent);
set('Not imported::Rulings', null, mj.rulings);

writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`${path} - filled 23 rows. Scryfall ${sf.total.toLocaleString('en-GB')} printings, MTGJSON ${mj.total.toLocaleString('en-GB')} cards.`);
console.log(`mtgjson isStarter/numberSort are blank: v4 field names, this file is v5.3.0 and neither exists in it any more with nothing standing in for them. hasFoil/hasNonFoil are also gone but v5's finishes answers the same question, so they are measured off it (${mj.hasFoil.toLocaleString()} foil / ${mj.hasNonfoil.toLocaleString()} nonfoil).`);

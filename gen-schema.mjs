/* GENERATES schema.js — the app's data-variable schema, from the two documents
   that already enumerate it.

   docs/schema-rows.json is the field-by-field map of what the app stores and
   which vendor supplies it; docs/schema-counts.json is how many rows actually
   carry each field, counted off the real bulk files. Config's schema table used
   to carry a HAND-WRITTEN SUMMARY of thirteen "elements" — which is not the
   schema, it is a description of one. 174 variables were enumerated in a
   document nothing read, so the page could not show the app's own shape and
   nothing could tell it had drifted.

   The route options are DERIVED from the columns, not typed here: a variable is
   routable to a vendor when that vendor's column names a field for it. A
   variable neither vendor supplies is computed by the app, and its only honest
   route is None — which is why those rows exist rather than being dropped.

   Run:  node gen-schema.mjs        (writes schema.js) */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const rows = JSON.parse(readFileSync('docs/schema-rows.json', 'utf8'));
const { counts, totalScryfall, totalMtgjson } = JSON.parse(readFileSync('docs/schema-counts.json', 'utf8'));
const implemented = JSON.parse(readFileSync('docs/schema-implemented.json', 'utf8'));

const DASH = /^\s*(—|-|)\s*$/;                       // the doc's "no such field"
const has = v => v != null && !DASH.test(String(v));

/* WHAT THE APP ACTUALLY HAS. docs/schema-implemented.json says which of the
   document's variables the app implements and what it calls them - the
   catalogue field it lands in, the constant the page declares, the function
   that derives it. The document enumerates what the VENDORS publish; this says
   what the APP has, and a variable that is in neither is a decision to make
   rather than an oversight to find.

   Every entry is CHECKED against the code that owns it, so a name that stops
   existing fails the build rather than quietly claiming the app has it:
     - a catalogue field must be one gen-cards.mjs writes into the row
     - anything else must be a name the page declares
   A row that is not in the file is not implemented. That is the whole point of
   the file: the absence is the answer, and it is written down rather than
   inferred. */
const CATALOGUE_FIELDS = ['art', 'art_id', 'cmc', 'col', 'cost', 'dfc', 'faces', 'fin', 'flav',
  'foil', 'kw', 'lang', 'layout', 'legal', 'lmask', 'loy', 'meld', 'n', 'num', 'pt', 'qty', 'rar',
  'rest', 'set', 'text', 'treat', 'type', 'usd'];
const appCode = readFileSync('index.html', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');   // a name in a comment is not a name
const bad = [];
for (const [key, where] of Object.entries(implemented)) {
  if (key.startsWith('//')) continue;
  if (!rows.some(r => `${r.group}::${r.element}` === key)) { bad.push(`${key} is not a document row`); continue; }
  if (!where) { bad.push(`${key} has no name`); continue; }
  if (CATALOGUE_FIELDS.includes(where)) continue;
  const bare = where.replace(/\[\].*$/, '').replace(/\(.*\)$/, '');
  if (!appCode.includes(bare)) bad.push(`${key} names ${where}, which the page does not declare`);
}
if (bad.length) {
  console.error(`docs/schema-implemented.json does not match the code:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}

/* WHICH SOURCE KEYS CAN SERVE A VARIABLE.

   For text the vendor columns answer it directly: a column that names a field
   is a source that carries the variable.

   AN IMAGE IS THE EXCEPTION, and getting it wrong is what made the picture rows
   read as nonsense. `Card.image_uris.small` is a URL sitting in a bulk JSON -
   the FIELD is in default_cards, the PIXELS are not, and offering
   "Thumbnail from scryfall - default_cards 78 MB" invites you to route an image
   at a text file that contains no images. So a row whose field is an
   `image_uris` member routes to the image source alone, and the bulk file that
   carries its URL stays visible as the field name under the variable.
   The same applies to the set symbol, which sfsym publishes one SVG per.

   `Illustration id` lives in the Picture group and is NOT an image - it is an
   identifier - so it follows the columns like any other text field. Testing the
   field rather than the group is what tells them apart. */
const isImageField = r => /image_uris|imageSmallUrl|imageLargeUrl/i.test(String(r.scryfall) + String(r.mtgjson));
const sourcesFor = (r) => {
  if (/set icon|symbol/i.test(r.element)) return ['sfsym'];
  if (isImageField(r)) return ['sfart'];
  const out = [];
  if (has(r.scryfall)) out.push('scryfall');
  if (has(r.mtgjson)) out.push('mtgjson');
  /* Prices keeps BOTH: MTGJSON publishes a price history file, and Scryfall's
     bulk rows carry the current price inline - two real routes to one number. */
  if (r.group === 'Prices') out.push('prices');
  return [...new Set(out)];
};

/* THE SAME VARIABLE LISTED TWICE. The document files some variables under two
   groups, and two of those are the SAME variable in both places - identical
   field on both vendors, so routing them separately would mean two rows that
   must always agree and nothing making them:
     Collector number   Identity / Print   both Card.collector_number
     WUBRG order        Colors / Constants  an app constant, no field either side
   The first occurrence wins and the second is dropped. A name that repeats with
   DIFFERENT fields is not this case and is kept - see below. */
const seen = new Map();
const dropped = [];
const deduped = rows.filter(r => {
  const sig = `${r.element}|${r.scryfall}|${r.mtgjson}`;
  if (seen.has(sig)) { dropped.push(`${r.group}::${r.element} (already in ${seen.get(sig)})`); return false; }
  seen.set(sig, r.group);
  return true;
});

/* A NAME THAT REPEATS WITH DIFFERENT FIELDS IS TWO VARIABLES, and six of them
   are: `Set code` is `Card.set` on a printing and `Set.code` on a set, which is
   the card's reference to its set versus the set's own identity. They are
   genuinely separate rows - but they read identically in a sorted list, so the
   scope is appended from the field's own root object rather than typed. */
const nameCount = {};
for (const r of deduped) nameCount[r.element] = (nameCount[r.element] || 0) + 1;
const scopeOf = (r) => {
  const f = `${has(r.scryfall) ? r.scryfall : ''} ${has(r.mtgjson) ? r.mtgjson : ''}`;
  if (/\bCard\./.test(f) && !/\bSet\./.test(f)) return 'on the card';
  if (/\bSet\./.test(f) && !/\bCard\./.test(f)) return 'on the set';
  /* The two vendors disagree about scope - Print's `Set UUID` is Scryfall's
     Card.set_id but MTGJSON's Set.uuid "via /sets cross-ref". The group settles
     it, and the collision is always the same one: a printing's REFERENCE to its
     set (Print) against the set's OWN field (Sets). */
  return r.group === 'Sets' ? 'on the set' : 'on the card';
};
const labelFor = r => nameCount[r.element] > 1 ? `${r.element} (${scopeOf(r)})` : r.element;

const out = deduped.map(r => {
  const k = `${r.group}::${r.element}`, n = counts[k] || {};
  /* WHAT THE APP HAS, as the app names it - the catalogue field it lands in or
     the constant the page declares. Empty means the app does not have it, and
     the Config table sorts those below the ones it does. */
  const impl = implemented[k] || '';
  return [r.group, labelFor(r), has(r.scryfall) ? r.scryfall : '', has(r.mtgjson) ? r.mtgjson : '',
          n.scryfall ?? null, n.mtgjson ?? null, sourcesFor(r).join(' '), impl];
});

const groups = [...new Set(rows.map(r => r.group))];
const unsourced = out.filter(r => !r[6]).length;

/* REPLACED, NOT TRUNCATED - the same rule as every other generated file here:
   a write that dies half way leaves a broken file under the live name, and a
   broken schema.js is a page with no data variables in it. */
writeFileSync('schema.js.part', `// GENERATED by gen-schema.mjs - do not hand-edit.
// The app's data variables, from docs/schema-rows.json + docs/schema-counts.json.
// [group, element, scryfallField, mtgjsonField, scryfallCount, mtgjsonCount, sourceKeys, implemented]
// sourceKeys is space-separated and may be '' - a variable the app computes has
// no vendor and no route but None, which is a fact about it, not a gap.
// implemented is the app's own name for the variable - the catalogue field it
// lands in, or the constant the page declares - and '' means the app does not
// have it. It is read from docs/schema-implemented.json and checked against the
// code that owns it, so it cannot claim a field that stopped existing.
// ${out.length} variables in ${groups.length} groups; ${unsourced} are app-derived; ${out.filter(r => r[7]).length} the app implements.
// Counted over ${totalScryfall.toLocaleString('en-GB')} Scryfall and ${totalMtgjson.toLocaleString('en-GB')} MTGJSON rows.
const SCHEMA_TOTALS = { scryfall: ${totalScryfall}, mtgjson: ${totalMtgjson} };
const SCHEMA_ROWS = [
${out.map(r => JSON.stringify(r)).join(',\n')}
];
`);
renameSync('schema.js.part', 'schema.js');

console.log(`schema.js: ${out.length} variables, ${groups.length} groups, ${unsourced} app-derived, ${out.filter(r => r[7]).length} implemented`);
if (dropped.length) console.log(`  dropped ${dropped.length} duplicate row(s): ${dropped.join('; ')}`);
/* A MAPPING FOR A ROW THAT WAS DROPPED IS DEAD. The duplicate rows are the
   same variable filed twice, so the second one never reaches the table - and a
   map entry for it says nothing, which is worse than saying nothing because it
   looks like a decision. Said here rather than failing: the row was dropped
   on purpose and the map is still right about the variable. */
const droppedKeys = new Set(dropped.map(d => d.split(' (already in')[0]));
const dead = Object.keys(implemented).filter(k => !k.startsWith('//') && droppedKeys.has(k));
if (dead.length) console.log(`  ${dead.length} mapping(s) for a dropped row: ${dead.join(', ')}`);
const disambiguated = out.filter(r => /\(on the (card|set)\)/.test(r[1]));
if (disambiguated.length) console.log(`  disambiguated ${disambiguated.length}: ${disambiguated.map(r => r[1]).join(', ')}`);
/* A field named with no measured coverage is a gap in the DOCUMENT, not the
   app - the table draws no number rather than a wrong one, which is the right
   behaviour, but the count of them should not be silent. */
const uncounted = out.filter(r => (r[2] || r[3]) && r[4] == null && r[5] == null);
console.log(`  ${uncounted.length} variables have a field but no measured coverage`);
for (const g of groups) {
  const rs = out.filter(r => r[0] === g);
  console.log(`  ${String(rs.length).padStart(3)}  ${g}  (${rs.filter(r => r[6]).length} routable)`);
}

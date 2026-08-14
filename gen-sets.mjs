// Regenerates draft/sets.js from api.scryfall.com/sets — the same endpoint
// src/import/sets.ts already uses. Run: node gen-sets.mjs
//
// ponytail: generated once and committed, not fetched at runtime. The draft is a
// static file served by serve.py and check.mjs runs with no network; a live fetch
// would make both of those conditional on Scryfall being up.
import { writeFileSync, statSync, createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

/* Which sets actually print a booster is NOT derivable from Scryfall: it lives in
   MTGJSON's `set.booster`, reverse-engineered by the community from opened packs
   (Wizards publishes no collation). 198 of 868 sets have it. Rather than parse
   1.4 GB, anchor on the fact that `data` is keyed by set code and a set object's
   first key is alphabetically "baseSetSize" — "booster" sorts straight after it. */
/* The same pass also picks up the pack ART, which is a different fact in the same
   file: `sealedProduct` lists the physical products, and a `booster_pack` one
   carries `contents.pack[].code` — the SAME string as the collation variant above,
   so the join is exact rather than by name — next to a pile of vendor ids. MTGJSON
   hosts no images; TCGplayer's CDN serves one per product id. 486 pack products
   over 190 sets, 421 with that id. Keys are alphabetical within a product, so
   category → contents → identifiers → setCode is one window, ~2000 chars wide;
   the tail carries that much between chunks and the Map drops the re-reads. */
/* The third fact in the same pass is the COLLATION itself. `set.booster` is an
   object of named configurations — "draft", "play", "collector", "set", "arena",
   "prerelease", one per physical product — and each carries `boosters[]` (the
   weighted pack recipes) and `sheets` (`{cards:{uuid: weight}, totalWeight}`).
   That is enough to compute, for any card, the expected copies per pack:

     rate(card) = Σ over recipes  (recipeWeight / boostersTotalWeight)
                                × (how many of that sheet the recipe takes)
                                × (cardWeight / sheetTotalWeight)

   Reading it means balancing braces rather than matching a regex, so the scan
   captures the block: a set object's keys are alphabetical, so "booster" lands
   within a few hundred chars of "baseSetSize" and the whole block is captured
   before "cards" (the 100k-entry part) is ever reached.

   ponytail: which booster a set is DRAFTED with is read here, not guessed from
   the release date. Play Boosters are usually dated to Outlaws of Thunder
   Junction (2024-04-19), but MTGJSON has MKM (2024-02-09) shipping "play" and
   no "draft" at all — the date rule got that set wrong. The file knows. */
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

/* One drafted config -> [name, distinct cards, packs per copy of the rarest card].
   Three names, in order: `play` (2024 on), `draft` (the decade before it), and
   `default` — an unnamed config that is what the sets predating the vocabulary
   carry, Ice Age and Fallen Empires and Fourth Edition among them. Reading only
   play/draft dropped 21 sets that plainly print a booster. Configs deliberately
   NOT drafted: `jumpstart` (a themed 20-card deck, not a pack you pick from),
   `collector`, `set`, `arena`, `prerelease`, `starter`, `box-topper`. */
function collation(booster) {
  const drafted = ['play', 'draft', 'default'].find((k) => booster[k]);
  if (!drafted) return null;
  const cfg = booster[drafted];
  const total = cfg.boostersTotalWeight || 1;
  const rate = new Map();
  for (const recipe of cfg.boosters ?? []) {
    const p = (recipe.weight || 0) / total;
    for (const [name, count] of Object.entries(recipe.contents ?? {})) {
      const sheet = cfg.sheets?.[name];
      if (!sheet) continue;
      const tw = sheet.totalWeight || 1;
      for (const [uuid, w] of Object.entries(sheet.cards ?? {}))
        rate.set(uuid, (rate.get(uuid) || 0) + (p * count * w) / tw);
    }
  }
  if (!rate.size) return null;
  const rarest = Math.min(...rate.values());
  return [drafted, rate.size, Math.round(1 / rarest)];
}

async function scanPrintings() {
  const rx = /"([A-Z0-9_]{2,8})":\{"baseSetSize"|"booster":\{/g;
  const pack = /"category":"booster_pack"[\s\S]{0,2000}?"setCode":"([A-Z0-9_]{2,8})"/g;
  const hits = new Set(), art = new Map(), coll = new Map();
  let tail = '', cur = null, acc = null;
  const stream = createReadStream('data/AllPrintings.json.gz').pipe(createGunzip());
  for await (const chunk of stream) {
    // while capturing, the tail would be re-read and double-counted into the block
    const text = acc ? chunk.toString('latin1') : tail + chunk.toString('latin1');
    tail = text.slice(-2100);

    if (acc) {
      const end = scanBraces(text, acc);
      acc.parts.push(end < 0 ? text : text.slice(0, end));
      if (end < 0) continue;                       // block spans another chunk
      finishBlock();
    }

    let m; rx.lastIndex = 0;
    while ((m = rx.exec(text))) {
      if (m[1]) { cur = m[1]; continue; }
      if (!cur) continue;
      hits.add(cur);
      if (coll.has(cur)) continue;                 // chunk overlap re-reads the same block
      acc = { code: cur, parts: [], depth: 0, inStr: false, esc: false };
      const rest = text.slice(m.index + '"booster":'.length);
      const end = scanBraces(rest, acc);
      acc.parts.push(end < 0 ? rest : rest.slice(0, end));
      if (end < 0) break;                          // resume on the next chunk
      finishBlock();
      rx.lastIndex = m.index + '"booster":'.length + end;
    }

    pack.lastIndex = 0;
    while ((m = pack.exec(text))) {
      const id = (m[0].match(/"tcgplayerProductId":"(\d+)"/) || [])[1];
      const code = (m[0].match(/"pack":\[\{"code":"([^"]+)"/) || [])[1];
      if (id && code) art.set(id, [m[1], code]);   // by id: chunk overlap re-reads
    }
  }

  function finishBlock() {
    try { coll.set(acc.code, collation(JSON.parse(acc.parts.join('')))); }
    catch { coll.set(acc.code, null); }            // a block we couldn't read is not a draft
    acc = null;
  }

  const bySet = new Map();
  for (const [id, [set, code]] of art) {
    const one = bySet.get(set) ?? bySet.set(set, {}).get(set);
    one[code] ??= +id;                             // first printing of a variant wins
  }
  return [hits, bySet, coll];
}
const [BOOSTERS, ART, COLLATION] = await scanPrintings();

const res = await fetch('https://api.scryfall.com/sets', {
  headers: { 'User-Agent': 'card-collection-draft/1.0', Accept: 'application/json' },
});
const { data } = await res.json();

// paper only: the app imports with game:paper, so Alchemy/Arena sets aren't ours
const paper = data.filter((s) => !s.digital);
const byCode = new Map(paper.map((s) => [s.code, s]));
// A block is the ROOT ancestor, not the immediate parent: Scryfall nests two
// deep (Marvel Super Heroes › ... Commander › ... Commander Tokens), and taking
// one level made the middle set both a block of its own and a child of another,
// so it rendered twice. Scryfall's own list indents one level, and so do we.
const blockOf = (s) => {
  let cur = s;
  for (let i = 0; cur.parent_set_code && byCode.has(cur.parent_set_code) && i < 8; i++)
    cur = byCode.get(cur.parent_set_code);
  return cur;
};

const blocks = new Map();
for (const s of paper) {
  const b = blockOf(s).code;
  (blocks.get(b) ?? blocks.set(b, []).get(b)).push(s);
}
// blocks newest first by the parent's release; inside a block, parent then children
const ordered = [...blocks.keys()]
  .sort((a, b) => byCode.get(b).released_at.localeCompare(byCode.get(a).released_at) || a.localeCompare(b))
  .flatMap((code) => {
    const kids = blocks.get(code)
      .filter((r) => r.code !== code)
      .sort((x, y) => x.released_at.localeCompare(y.released_at) || x.code.localeCompare(y.code));
    return [byCode.get(code), ...kids];
  });

// Mock holdings, hashed from the set code so the Collected bars don't shuffle
// on every regeneration — the draft is about the shape, but a bar that moves
// for no reason reads as data.
const hash = (s) => {
  let n = 2166136261;
  for (const c of s) { n ^= c.charCodeAt(0); n = Math.imul(n, 16777619); }
  return (n >>> 0) / 4294967296;
};
const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const q = (v) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/* The set symbol, which MockCard draws in the rarity's colour. Scryfall serves one
   SVG per set and names it by an icon slug that is USUALLY the set code but often
   is not: sub-sets share their parent's (tmkm, pmkm and amkm are all `mkm`) and
   some have their own (Secret Lair is `star`, The List is `planeswalker`). 666 of
   986 differ, over only 336 distinct icons, so deriving the URL from the code
   404s on two thirds of the rows. Stored only when it differs — the rest fall
   back to the code and cost nothing. */
const iconSlug = (s) => (s.icon_svg_uri || '').replace(/^.*\/sets\//, '').replace(/\.svg.*$/, '');

const rows = ordered.map((s) => {
  const r = hash(s.code);
  const owned = r < 0.42 ? 0 : Math.min(s.card_count, Math.round(s.card_count * (r - 0.4) * 0.9));
  const icon = iconSlug(s);
  return `  [${q(esc(s.name))},${q(s.code.toUpperCase())},'${s.released_at}',${s.card_count},${owned},${
    s.code === blockOf(s).code ? 0 : 1},${q(s.set_type)},${BOOSTERS.has(s.code.toUpperCase()) ? 1 : 0},${
    q(icon === s.code ? '' : icon)}],`;
});
const cards = paper.reduce((t, s) => t + s.card_count, 0);

// Set codes are not all identifiers — 10E, 2X2, 30A start with a digit, and
// `{10E:…}` is a syntax error, not a key. Same for hyphenated variants.
const key = (k) => /^[A-Za-z][A-Za-z0-9]*$/.test(k) ? k : q(k);
const artRows = [...ART.keys()].sort().map((set) =>
  `  ${key(set)}:{${Object.entries(ART.get(set)).map(([c, id]) => `${key(c)}:${id}`).join(',')}},`);

const drafted = [...COLLATION].filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b));
const collRows = drafted.map(([set, [kind, n, rarest]]) =>
  `  ${key(set)}:[${q(kind)},${n},${rarest}],`);

writeFileSync('sets.js', `// GENERATED by gen-sets.mjs — do not hand-edit.
// Every paper Magic set from api.scryfall.com/sets, ordered newest block first
// with sub-sets under their parent — the order the Printings table renders in.
// [name, code, released, cards, owned, is-sub-set, set_type, has-booster, icon]
// icon is Scryfall's set-symbol slug, '' when it is just the lowercased code
// owned is mock holdings; has-booster is MTGJSON's set.booster, which is the only
// thing that says whether a set can actually be drafted.
const SETS = [
${rows.join('\n')}
];
const MTG_CARDS = ${cards};

// Booster pack art, from MTGJSON's sealedProduct: set code -> collation variant ->
// TCGplayer product id, which is what its CDN serves the wrapper photo by. The
// variant key is the same one set.booster uses, so a Play Booster draw can show
// the Play Booster wrapper rather than "a pack from this set".
const PACK_ART = {
${artRows.join('\n')}
};

// The collation itself, from MTGJSON's set.booster: set code -> [kind, cards, rarest].
//   kind   which booster the set is DRAFTED with — "play" or "draft", read from the
//          file rather than guessed from the release date (MKM shipped Play Boosters
//          on 2024-02-09, two months before the date rule expects them).
//   cards  distinct cards on that booster's sheets. Counts showcase/borderless
//          printings separately, as the sheets do, so it can exceed a set's
//          Scryfall card_count — it is a count of printings, not a percentage.
//   rarest packs you would open, on average, for one copy of its least common card.
const BOOSTER = {
${collRows.join('\n')}
};
`);
const kinds = drafted.reduce((a, [, v]) => ((a[v[0]] = (a[v[0]] || 0) + 1), a), {});
console.log(`sets.js — ${drafted.length} drafted sets (${
  Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')})`);
console.log(`sets.js — ${ordered.length} sets · ${cards.toLocaleString('en-GB')} cards · ${
  ordered.filter((s) => BOOSTERS.has(s.code.toUpperCase())).length} with booster collation · ${
  ART.size} sets with pack art (${[...ART.values()].reduce((n, o) => n + Object.keys(o).length, 0)} packs) · ${
  (statSync('sets.js').size / 1024).toFixed(1)} KB`);

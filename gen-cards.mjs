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

/* LEGALITY IS A BITMASK, and it is on the ORACLE because that is what it is a
   property of: a card is Modern-legal, not a printing of it. Nine formats, one
   integer, 37,555 times — against nine strings per printing 107,347 times, which
   is the same fact written 26x over. The order is the order the filter draws
   them in, so the bit index IS the chip index and neither side keeps a map.

   THE PARAGRAPH THAT STOOD HERE WAS WRONG, and it is worth keeping the
   correction rather than quietly deleting it: it argued that only `legal` should
   count, because folding in `restricted` "would overcount Vintage". It undercounts
   it instead. Restricted is not a milder kind of banned — it is legal, at one
   copy — so a Vintage deck may contain Black Lotus and every chip, count and
   card page that said otherwise was wrong about the most famous cards in the
   game. See legalOf/restOf below. */
const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper', 'brawl', 'historic'];
/* FOUR STATES, NOT TWO. The source says not_legal / legal / banned / restricted,
   and counting only `legal` filed every RESTRICTED card as legal in nothing —
   which is the Power Nine, Sol Ring, and 1,024 format-entries in all. Restricted
   means legal, at one copy: a Vintage deck may contain Black Lotus, so a page
   that says otherwise is wrong in the way that matters to the person building
   the deck.

   Two masks rather than one, because "legal" and "legal but limited to one" are
   different answers and folding them together loses the second: `legal` carries
   both so the filter counts what you can actually play, and `rest` carries the
   restriction so the card page can say which it is. `rest` is 0 for all but 355
   oracles, so it costs nothing in the tail. */
const legalOf = (c) => FORMATS.reduce((m, f, i) =>
  m | (/^(legal|restricted)$/.test(c.legalities?.[f] ?? '') ? 1 << i : 0), 0);
const restOf = (c) => FORMATS.reduce((m, f, i) =>
  m | (c.legalities?.[f] === 'restricted' ? 1 << i : 0), 0);

/* THE TURN INDICATOR. A two-sided card carries a small mark in the top-left of
   its title bar saying which way it turns and into what — a sun and a crescent
   for Innistrad's day/night werewolves, a compass for Ixalan's lands, a spark
   for the Origins planeswalkers. Scryfall reports it in `frame_effects`, and
   `treatOf` above drops all of them because it only looks for the four that
   change the ART.

   It is READ rather than derived, and that was measured before it was written:
   only 110 of the 381 `sunmoondfc` printings say Daybound or Nightbound, so the
   271 older Innistrad werewolves — which transform on the same mark with the
   2011 wording — cannot be found in the rules text. 580 of 107,347 printings
   carry one, so the field is 0 on 99.5% of the rows and costs nothing.

   The NAME is stored rather than a flag for the one case the page currently
   draws specially, the same way `treat` stores Scryfall's word: the page maps
   names to marks, so a mark it has no glyph for degrades to the generic
   triangle and naming it in the tooltip still works. */
const DFC = ['sunmoondfc', 'compasslanddfc', 'originpwdfc', 'mooneldrazidfc',
  'waxingandwaningmoondfc', 'fandfc', 'convertdfc', 'upsidedowndfc'];
const dfcOf = (c) => (c.frame_effects || []).find(f => DFC.includes(f)) || 0;

/* Finishes are per PRINTING — the same card is sold nonfoil in one set and
   etched in another — so this one is three bits on the printing row. */
const FINISHES = ['nonfoil', 'foil', 'etched'];
const finishOf = (c) => FINISHES.reduce((m, f, i) =>
  m | (c.finishes?.includes(f) ? 1 << i : 0), 0);

/* ARTIST AND FLAVOUR ARE DICTIONARIES, because both are per-printing strings
   with heavy reuse and gzip cannot see it. Its window is 32 KB and these fields
   run to megabytes, so the second copy of "John Avon" 4 MB later is a fresh
   literal as far as the compressor is concerned. Interning is what turns that
   back into a reference:

     artist   2,527 names over 107,347 printings — 0.36 MB flat, 0.18 interned.
     flavour  27,275 distinct texts over 53,107 printings that have one. Nearly
              2x reuse, because a reprint keeps the same flavour, so it is
              1.23 MB interned against 2.08 flat.

   Index 0 is the empty string in both, so "no artist" (794) and "no flavour"
   (53,496 — half the catalogue) cost one character each and need no sentinel. */
const dict = () => { const a = ['']; return [a, new Map([['', 0]])]; };
const [artists, artistIdx] = dict();
const [flavour, flavourIdx] = dict();
const intern = ([arr, idx], s) => {
  s = s || '';
  let i = idx.get(s);
  if (i === undefined) { i = arr.length; arr.push(s); idx.set(s, i); }
  return i;
};

/* MELD IS THREE CARDS, NOT TWO FACES, which is why it needs a field of its own
   when transform does not. Two fronts are exiled and become one back that spans
   both of them, so Scryfall gives the result its OWN row — `BRO 163b Mishra,
   Lost to Phyrexia` — with no `card_faces` and `all_parts` naming the group.
   Every member is `layout: meld` and single-faced, so without this the result
   sits in the catalogue as an ordinary card with no link to either half, and
   neither half knows what it becomes.

   Not derivable from the rules text, which was worth checking because aftermath
   was: `The Mightstone and Weakstone` says "(Melds with Urza, Lord Protector.)"
   and names its partner but not the result, `Gisela` spells the whole thing out
   in prose instead of a reminder, and `Brisela` — the result — says nothing
   about melding at all.

   Stored as [result, partA, partB] on the ORACLE, because which cards meld
   together is a fact about the card and not about a printing of it. Tokens
   share the group's `all_parts` (a Powerstone, an Eldrazi Horror) and are not
   members, so membership is tested rather than assumed. */
const meldOf = (c) => {
  const all = c.all_parts || [];
  const res = all.find(p => p.component === 'meld_result');
  if (!res) return 0;
  const parts = all.filter(p => p.component === 'meld_part').map(p => p.name);
  if (c.name !== res.name && !parts.includes(c.name)) return 0;
  return [res.name, ...parts];
};

/* KEYWORDS COME FROM THE SOURCE, NOT FROM A REGEX OVER THE RULES TEXT. The page
   was matching /\bFlying\b/ against the oracle text, which counts every card
   that MENTIONS flying — "creatures you control gain flying", "target creature
   with flying" — as having it, and misses the 1,088 cards whose keyword sits in
   a face rather than the root. Scryfall already resolves this: 868 distinct
   keywords across 44,684 of the 107,347 paper printings, its own vocabulary
   (evergreen abilities, keyword actions and ability words alike), which is the
   same list its `keyword:` search uses.

   Stored as ONE interned index per oracle over the joined COMBINATION, not a
   list of word ids: 868 words make 2,944 distinct sets in practice, so the whole
   vocabulary is a 66 KB dictionary and every card is a single integer. A
   per-word id array would have cost more and bought nothing — no card carries a
   combination the dictionary hasn't already seen. */
const [kws, kwIdx] = dict();

const oracleIdx = new Map();
const oracles = [];      // [name, cost, type, text, pt, col, cmc, layout, loy, faces, legal, meld, kw, rest]
const printings = [];    // [oracle, set, number, rarity, artId, usd, treatment, finishes, lang, artist, flavour, dfc]

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
      legalOf(c),
      meldOf(c),
      intern([kws, kwIdx], (c.keywords || []).join('|')),
      restOf(c),
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
    finishOf(c),
    /* READ, NOT ASSUMED. The page wrote `lang: 'en'` on every row, which is a
       literal wearing a field's clothes — it prints in the identity key beside
       the set and collector number, where it reads as a fact about the printing.
       **2,634 of these 107,347 are not English**: Foreign Black Border, Italian
       Rinascimento, Phyrexian, Quenya, and one card each in Latin, Hebrew,
       Arabic and Ancient Greek. `default_cards` is one printing per card
       *preferring* English, not a set of English printings — where a card was
       never printed in English it hands you the language it was.

       'en' is written as 0 for the 104,713 that are, the same trick treatment
       uses: a per-printing field written a hundred thousand times pays for its
       default case in the tail of the gzip. */
    c.lang === 'en' ? 0 : c.lang,
    /* ONE artist per printing, the root's, even though 151 two-faced printings
       credit a different illustrator on each side. The collector bar is drawn
       once per card by design (see FootPlate), so a second name has nowhere to
       go; 0.14% of the catalogue names the front's artist on both sides. */
    intern([artists, artistIdx], c.artist),
    /* Flavour is per FACE when there is more than one, because it is printed on
       the face it belongs to and a transform showing its front's flavour on its
       back would be a lie rather than a gap. 744 printings have flavour ONLY on
       their faces — every "Invasion of" card in March of the Machine — so
       reading the root alone would have left them blank while their single-faced
       neighbours read fine. Root flavour lands on face 0, which is where an
       adventure or a split puts it. Collapses to 0 when no face has any. */
    faces ? (() => {
      const per = c.card_faces.map((fc, k) =>
        intern([flavour, flavourIdx], fc.flavor_text ?? (k ? '' : c.flavor_text)));
      return per.some(Boolean) ? per : 0;
    })() : intern([flavour, flavourIdx], c.flavor_text),
    dfcOf(c),
  ]);
}

const json = JSON.stringify({ o: oracles, p: printings, artists, flavour, kws });
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
console.log(`dictionaries — ${(artists.length - 1).toLocaleString('en-GB')} artists · ${
  (flavour.length - 1).toLocaleString('en-GB')} distinct flavour texts over ${
  printings.filter(p => p[10]).length.toLocaleString('en-GB')} printings that carry one · ${
  (kws.length - 1).toLocaleString('en-GB')} keyword combinations over ${
  new Set(kws.flatMap(s => s.split('|')).filter(Boolean)).size.toLocaleString('en-GB')} distinct keywords`);
console.log(`anatomy — ${census.size} classes, ${
  [...census.values()].filter(n => n >= 6).length} of them with six printings or more`);
for (const [k, n] of [...census].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(6)}  ${k}`);

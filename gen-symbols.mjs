// Pull the set symbols down to disk, so the app draws a card with the network off.
//   node gen-symbols.mjs [--force]
//
// THIS WAS THE LAST UNCONDITIONAL REQUEST IN THE APP. Card art and pack wrappers
// both had a Local side and a Config row; `setIconUrl` had neither — it returned
// an svgs.scryfall.io URL and there was no setting anywhere that could stop it.
// It is also the most FREQUENT one, because a symbol is drawn on every card and
// on every row of the set table, where art is drawn once per card: a 240-card
// page asks for dozens of them. So "every source is set to local" was true of
// the sources and false of the page.
//
// WHAT IT COSTS, measured rather than estimated: 986 sets share 336 DISTINCT
// symbols — promos, tokens and Secret Lair variants all point at their parent's
// icon through the override in column 7 — and a Scryfall set SVG is a couple of
// KB. The whole set is about a megabyte, which is the cheapest local side in
// Config by three orders of magnitude and the reason this one is worth having.
//
// ponytail: sequential with a delay, the same as gen-art.mjs and for the same
// reason — Scryfall asks for 50-100ms between requests, so a worker pool would
// add concurrency code to hit an identical ceiling. 336 files is under a minute.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const force = process.argv.includes('--force');
const OUT = 'sym';

/* sets.js is a browser script, so it is evaluated rather than parsed — the same
   way gen-packs.mjs and gen-import.mjs read it. Column 7 is the icon override
   and column 1 is the code; the fallback below is character-for-character what
   `setIconUrl` does, and check.mjs asserts the two agree. */
const SETS = new Function(`${readFileSync('sets.js', 'utf8')}; return SETS;`)();
const icons = [...new Set(SETS.map(r => (r[7] || r[1].toLowerCase())).filter(Boolean))].sort();

/* Conflux's symbol is `con`, and Windows has reserved that name - with any
   extension - since DOS. This bit here exactly as it bit gen-boosters: node
   "wrote" sym/con.svg 334 times, reported success every time, and never created
   a file, because the path IS the console device. The trailing underscore is the
   same convention boosters/CON_.json uses, and index.html, gen-boosters.mjs and
   serve.py all have to agree on it. */
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const diskName = n => RESERVED.test(n) ? `${n}_` : n;

/* Scryfall 400s any request whose User-Agent it considers "default or generic",
   and node's fetch sends one — the body explains itself but a bare status looks
   like a malformed URL. Same header gen-art.mjs uses. */
const UA = { 'User-Agent': 'card-collection/1.0 (+local set symbols)', Accept: 'image/svg+xml' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
console.log(`${icons.length} distinct symbols for ${SETS.length} sets -> ${OUT}/`);

/* A 404 AND A DROPPED CONNECTION ARE DIFFERENT ANSWERS, and lumping them cost a
   diagnostic round trip: Conflux came back "not published" on one run and 200 on
   the next, because the catch counted a transient network failure as Scryfall
   having no such symbol. "Not published" is a CLAIM - it is what puts a set on
   the plain rarity disc for good - so it is only made when the server made it. */
let got = 0, had = 0, missing = 0, failed = 0, bytes = 0;
const failures = [];
for (const [i, icon] of icons.entries()) {
  const path = `${OUT}/${diskName(icon)}.svg`;
  if (!force && existsSync(path)) { had++; continue; }
  try {
    const res = await fetch(`https://svgs.scryfall.io/sets/${icon}.svg`, { headers: UA });
    /* A 404 is an ANSWER, not a failure: Scryfall has no icon for every code we
       carry, and the page already falls back to the plain rarity disc when the
       URL is empty. Writing a zero-byte file would make "not published" look
       like "fetched", which is the fault this whole change is about. */
    if (res.status === 404) { missing++; }
    else if (!res.ok) { failed++; failures.push(`${icon} (HTTP ${res.status})`); }
    else {
      const svg = Buffer.from(await res.arrayBuffer());
      writeFileSync(path, svg);
      got++; bytes += svg.length;
    }
  } catch (e) { failed++; failures.push(`${icon} (${e.message})`); }
  if (i % 50 === 49) console.log(`  ${i + 1}/${icons.length}`);
  await sleep(80);
}
/* WHAT WAS ACTUALLY WRITTEN, so the page can tell "not published" from "not
   fetched yet". Scryfall serves no symbol for a handful of codes we carry - MBC
   and FRC today - and a set symbol is a CSS mask rather than an <img>, so there
   is no `onerror` to fall back with: a mask whose file 404s renders as a solid
   coloured square, which is worse than the plain rarity disc the page already
   draws when it has no URL at all. The same shape as boosters/index.json. */
const present = icons.filter(i => existsSync(`${OUT}/${diskName(i)}.svg`)).sort();
writeFileSync(`${OUT}/index.json`, JSON.stringify(present));
console.log(`${got} fetched (${(bytes / 1e6).toFixed(2)} MB) · ${had} already here · ${missing} not published (404)`);
console.log(`${OUT}/index.json lists ${present.length}`);
if (failed) {
  // an exit code, because a half-fetched mirror that reports success is how the
  // app ends up quietly drawing discs for sets that do have a symbol
  console.error(`${failed} FAILED and are worth re-running: ${failures.join(', ')}`);
  process.exitCode = 1;
}

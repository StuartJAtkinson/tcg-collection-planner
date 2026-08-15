// Pull card art down to disk so the page renders with the network off.
//   node gen-art.mjs [size] [scope]
//     size    art_crop (default) | small | normal | large | png
//     scope   --anatomy (default) | --set CODE | --all
//
// Config has always offered card art a Local side and always priced it as a
// warning rather than a choice, because nothing implemented it. This is that
// side, and it is the same shape as gen-packs.mjs: fetch once, write a file the
// browser can ask for by name, and let a file that isn't there fall through to
// the CDN rather than break.
//
// WHAT IT COSTS, MEASURED over 24 printings sampled across the catalogue rather
// than estimated — the whole point of the Local chip is choosing with the number
// in front of you:
//
//     small       14 KB    1.5 GB      art_crop     75 KB     8.2 GB
//     normal     104 KB   11.4 GB      large       169 KB    18.5 GB
//     png       1231 KB  135.2 GB
//
// So "the fullest size, local, for the whole catalogue" is 135 GB and about
// three days of requests at the rate Scryfall asks for. `large` is the fullest
// size that is a sensible thing to keep on a disk, and `art_crop` is the one
// the app actually draws — the frame is drawn in HTML here, so the crop is all
// the pixels this UI can use. Nothing below chooses for you; --all with png is
// allowed and will tell you what it is about to do.
//
// ponytail: sequential with a delay, not a worker pool. Scryfall asks for
// 50-100ms between requests, which caps this at ~10/s no matter how many
// sockets you open — a pool would add concurrency code to hit the same ceiling.
// Upgrade path if they ever lift it: a pool of 6 and drop the sleep.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname } from 'node:path';

const SIZES = { art_crop: 'jpg', small: 'jpg', normal: 'jpg', large: 'jpg', png: 'png' };
const args = process.argv.slice(2);
const size = args.find(a => SIZES[a]) || 'art_crop';
const ext = SIZES[size];
if (args.some(a => !a.startsWith('--') && !SIZES[a] && !/^[A-Za-z0-9]{2,8}$/.test(a))) {
  console.error(`size must be one of: ${Object.keys(SIZES).join(', ')}`);
  process.exit(1);
}

/* Scryfall 400s any request whose User-Agent it considers "default or generic",
   and node's fetch sends one. The body says so in plain English, but only if you
   read it — as a bare status it looks like a malformed URL, which cost a
   diagnostic round-trip the first time. */
const UA = { 'User-Agent': 'card-collection/1.0 (+local art cache)', Accept: 'image/*' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* SIDED and the frameable rule come from anatomy.js — the same file the page
   loads with <script src>. They were copied in here with a note saying this
   "has no way to import from a page", which was only ever true of a module:
   these are plain top-level declarations and new Function reads them, which is
   how gen-packs.mjs has always read sets.js. Two copies and two assertions in
   check.mjs, to avoid one line. */
const [SIDED, framableFaces] =
  new Function(`${readFileSync('anatomy.js', 'utf8')}
return [SIDED, framableFaces];`)();

/* 3% of printings have no mana cost, no type line and no rules — art cards,
   Jumpstart theme dividers, punchcards, "Poison Counter". The page gives up on
   drawing a frame for those and shows the whole printed card instead, so the
   crop is the one size that is no use to them: fetch `normal` for those rows
   even when the run asked for art_crop, or Local has a hole exactly where the
   frame cannot cover for it. All this adds to the shared rule is the shape the
   catalogue stores a card in — the oracle tuple, faces at index 9. */
const framable = (or) => framableFaces((or[9]?.length > 1 ? or[9] : [[or[0], or[1], or[2]]])
  .map((f) => ({ cost: f[1], type: f[2] })));

const { o, p } = JSON.parse(gunzipSync(readFileSync('cards.json.gz')));

/* WHICH PRINTINGS. --anatomy is the default and is the useful one: it is
   exactly what #/anatomy draws, so six of every shape of card there is goes
   offline for a few hundred requests instead of a hundred thousand. It has to
   agree with anatomyClasses() in index.html — same key, same stride — or the
   page asks for files this never fetched. */
const SAMPLES = 6;
const key = pr => `${o[pr[0]][7] || 'normal'} | ${pr[6] || 'framed'}`;
const scope = () => {
  const at = args.indexOf('--set');
  if (at >= 0) {
    const code = (args[at + 1] || '').toUpperCase();
    return { what: `set ${code}`, rows: p.filter(pr => pr[1] === code) };
  }
  if (args.includes('--all')) return { what: 'every printing', rows: p };
  const total = new Map();
  for (const pr of p) total.set(key(pr), (total.get(key(pr)) || 0) + 1);
  const seen = new Map(), took = new Map(), rows = [];
  for (const pr of p) {
    const k = key(pr), n = total.get(k), i = seen.get(k) || 0;
    seen.set(k, i + 1);
    const have = took.get(k) || 0;
    if (have < SAMPLES && i >= Math.floor(have * n / SAMPLES)) { took.set(k, have + 1); rows.push(pr); }
  }
  return { what: `the ${total.size} anatomy classes, ${SAMPLES} printings each`, rows };
};

const { what, rows } = scope();
// a double-faced card is two images at the same id, so the count is not the row count
const AVG = { small: 14e3, art_crop: 75e3, normal: 104e3, large: 169e3, png: 1231e3 };
const jobs = [];
let swapped = 0;
for (const pr of rows) {
  const id = pr[4], or = o[pr[0]], layout = or[7] || 'normal';
  // the crop is the illustration alone; a card with nothing but an illustration
  // is drawn whole, so it needs the whole-card size instead
  const q = size === 'art_crop' && !framable(or) ? 'normal' : size;
  if (q !== size) swapped++;
  const qext = SIZES[q];
  const sides = SIDED.has(layout) && or[9] ? ['front', 'back'] : ['front'];
  for (const side of sides)
    jobs.push({ url: `https://cards.scryfall.io/${q}/${side}/${id[0]}/${id[1]}/${id}.${qext}`,
                file: `art/sf/${q}/${side}/${id[0]}/${id[1]}/${id}.${qext}`, avg: AVG[q] });
}
const todo = jobs.filter(j => !existsSync(j.file));

const gb = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
console.log(`${size} · ${what}`);
if (swapped) console.log(`  ${swapped} printing${swapped === 1 ? '' : 's'
  } have no frame to draw, so ${swapped === 1 ? 'it is' : 'they are'} fetched whole at normal`);
console.log(`${jobs.length.toLocaleString('en-GB')} images, ${
  (jobs.length - todo.length).toLocaleString('en-GB')} already on disk · ${
  todo.length.toLocaleString('en-GB')} to fetch ≈ ${gb(todo.reduce((s, j) => s + j.avg, 0))} and ${
  (todo.length / 10 / 60).toFixed(0)} min at the rate Scryfall asks for`);
if (!todo.length) { console.log('nothing to do'); process.exit(0); }

let done = 0, bytes = 0, failed = 0;
for (const j of todo) {
  try {
    const res = await fetch(j.url, { headers: UA });
    if (!res.ok) throw new Error(`${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(j.file), { recursive: true });
    writeFileSync(j.file, buf);
    bytes += buf.length;
    done++;
  } catch (e) {
    // A missing image is a printing without art, not a reason to stop 40
    // minutes into a download. It is counted and named at the end.
    failed++;
    if (failed <= 5) console.warn(`  miss ${j.file} — ${e.message}`);
  }
  if (done % 100 === 0) process.stdout.write(`\r  ${done}/${todo.length} · ${gb(bytes)}   `);
  await sleep(100);
}
console.log(`\nart/sf/${size} — ${done.toLocaleString('en-GB')} written, ${gb(bytes)}${
  failed ? `, ${failed} missing` : ''}`);
console.log(`total on disk for this size: ${gb(jobs.filter(j => existsSync(j.file))
  .reduce((n, j) => n + statSync(j.file).size, 0))}`);

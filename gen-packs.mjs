// Fetch every booster photograph once and TRIM IT ON THE WAY IN.
//   node gen-packs.mjs [size] [--force]   size: 200w (default) | in_1000x1000
//
// ONCE MEANS ONCE, AND THE MANIFEST IS HOW IT KNOWS. Skipping on "is there a
// file with that name" was the whole of the old test, which answers a different
// question: it says a picture was made, not that it was made THE WAY THIS FILE
// MAKES ONE. Change PACK_SAT, or a line of the flood fill, and 388 stale PNGs
// keep being served with nothing to notice — and since Local and Online are
// supposed to be the same picture, that is Config's chip silently changing how
// the app looks, which is the one thing the port below exists to prevent.
//
// RESUME-SAFE BY DESIGN, NOT BY ACCIDENT. Each iteration fetches ONE booster,
// trims it, writes its PNG, and only then advances. The manifest is rewritten
// every 25 boosters, not once at the end. A network drop in the middle of a
// run loses at most ONE booster - the one whose HTTP fetch was in flight at
// the moment the connection died - and the next run picks up exactly there:
// the manifest already records every PNG written so far, and the booster that
// never landed is the only one re-fetched. Ctrl-C is the same story. The on-
// disk state is the source of truth, not the terminal log, and that is why
// this loop's terminal output can be one line per booster - progress is a
// side effect of the write, not the driver of it.
//
// So `packs/.recipe.json` records the fingerprint the files were made with: the
// five constants AND the source of trim() itself, hashed, so editing either is a
// new recipe. A file is skipped only when it is on disk AND the manifest says it
// was made with the recipe now in force. Anything else is reprocessed. --force
// reprocesses regardless.
//
// Config's TCGplayer row has always described a Local side — "388 packs over N
// sets, 10 MB at 200w" — and nothing implemented it, so the row priced a choice
// you could not make. This is that side.
//
// The point is not the download, it is the TRIM. Online, every one of these
// arrives as a JPEG on a white card and the browser has to cut it out per
// picture per page: fetch as an origin, flood fill the border ring to alpha,
// white balance, level, saturate, hand back a data URL. That is a canvas pass
// for a picture that will never change again. Done here it happens once and the
// browser gets a PNG that already has its alpha.
//
// ponytail: no image library. ffmpeg is already a dependency of this repo
// (frames.mjs) and decodes to raw RGBA and encodes PNG, which is the whole job —
// the interesting part is the flood fill, and that is thirty lines either way.
// A native `sharp` install would add a build toolchain to save none of them.
//
// The algorithm is trim.js, the same file the page loads — it was a hand-kept
// copy with three assertions holding the two in step, which is a tax for the
// life of the repo to avoid one shared file. Local and Online are supposed to
// be the same picture; now they cannot be anything else.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SIZES = { '200w': 1, in_1000x1000: 1 };
const args = process.argv.slice(2);
const force = args.includes('--force');
const size = args.find((a) => !a.startsWith('--')) || '200w';
if (!SIZES[size]) { console.error(`size must be one of: ${Object.keys(SIZES).join(', ')}`); process.exit(1); }

/* trim.js and sets.js are plain top-level declarations, not modules, because the
   page loads them with <script src>. new Function is how node reads one: the
   same trick already used for PACK_ART below. */
const shared = (file, ...names) =>
  new Function(`${readFileSync(file, 'utf8')}
return [${names.join(',')}];`)();
const [TRIM_TOL, PACK_SAT, WHITE, MAX_GAIN, LEVELS, trimPixels] =
  shared('trim.js', 'TRIM_TOL', 'PACK_SAT', 'WHITE', 'MAX_GAIN', 'LEVELS', 'trimPixels');
const OUT = 'packs';

// sets.js is a plain script of top-level consts, not a module. Reading it as
// text and asking for the one binding beats maintaining a second copy of the id
// list, which would drift the first time a set is added.
const PACK_ART = new Function(`${readFileSync('sets.js', 'utf8')}\nreturn PACK_ART;`)();
const ids = [...new Set(Object.values(PACK_ART).flatMap((o) => Object.values(o)))];

const ff = (args, input) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args],
  { input, maxBuffer: 1 << 28 });

/* Decode to raw RGBA. -f rawvideo gives pixels with no container, so the only
   thing that has to be known is the frame size, which is why it is asked for
   separately rather than parsed out of a header. */
const probe = (jpg) => {
  const out = execFileSync('ffprobe', ['-hide_banner', '-loglevel', 'error', '-of', 'csv=p=0',
    '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-'], { input: jpg });
  return String(out).trim().split(',').map(Number);
};

mkdirSync(OUT, { recursive: true });
const have = new Set(readdirSync(OUT));

/* THE FINGERPRINT IS THE NUMBERS AND THE CODE. Hashing the five constants alone
   would call a rewritten flood fill the same recipe, which is the more likely
   edit of the two — `trim.toString()` is the function's own source, so any
   change to either side of it is a different recipe and every picture is made
   again. Twelve hex digits is plenty to tell recipes apart; this is not a
   security boundary, it is a cache key. */
const CONSTANTS = { TRIM_TOL, PACK_SAT, WHITE, MAX_GAIN, LEVELS };
const recipe = createHash('sha1').update(JSON.stringify(CONSTANTS))
  .update(trimPixels.toString()).digest('hex').slice(0, 12);
const MANIFEST = `${OUT}/.recipe.json`;
let man = null;
try { man = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { /* first run */ }

/* No manifest but pictures on disk is the ONE case worth special-casing: it is
   every install that predates this file, and re-fetching 770 images to learn
   what we already know is a bad trade. They were made by the recipe that was
   in force when they were made, and nothing has changed it since, so they are
   adopted as current. Said out loud rather than done quietly — if the recipe HAS
   moved on since, --force is the answer and this line is the hint to use it. */
if (!man) {
  const found = readdirSync(OUT).filter((f) => f.endsWith('.png'));
  man = { recipe, constants: CONSTANTS, generated: new Date().toISOString(), files: {} };
  for (const f of found) man.files[f] = 'adopted';
  if (found.length) console.log(`${found.length} image${found.length === 1 ? '' : 's'
    } already on disk with no record of how — adopting as recipe ${recipe}; --force to redo them`);
}
const stale = man.recipe !== recipe;
if (stale) console.log(`recipe changed ${man.recipe} → ${recipe} — every image is remade`);
else if (force) console.log(`recipe ${recipe} — --force, every image is remade`);
else console.log(`recipe ${recipe}`);
// the manifest describes ONE recipe, so a stale one is discarded rather than merged
if (stale || force) man = { recipe, constants: CONSTANTS, generated: new Date().toISOString(), files: {} };

let done = 0, skipped = 0, plain = 0, failed = 0;
const total = ids.length;
const save = () => writeFileSync(MANIFEST,
  `${JSON.stringify({ ...man, recipe, constants: CONSTANTS, size }, null, 1)}\n`);

// i is 1-based for humans reading logs. progress line carries current/total/name
// and the outcome (trimmed, plain: <why>, failed: <msg>) so the bar can name
// what it is doing AND record what happened without a second pass.
let i = 0;
for (const id of ids) {
  i++;
  const name = `${id}_${size}.png`;
  // on disk AND on the record, made by the recipe in force. Two of the three is
  // not enough: a file the manifest has never heard of was made by something else
  if (have.has(name) && man.files[name]) { skipped++; console.log(`${i}/${total} ${id} skipped`); continue; }
  try {
    const res = await fetch(`https://tcgplayer-cdn.tcgplayer.com/product/${id}_${size}.jpg`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const jpg = Buffer.from(await res.arrayBuffer());
    const [w, h] = probe(jpg);
    const raw = ff(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], jpg);
    const d = new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length);
    // a picture we could not cut out is still a picture of a pack: it goes in
    // untrimmed rather than not at all, exactly as the browser path does
    const why = trimPixels(d, w, h);
    if (why) plain++;
    writeFileSync(`${OUT}/${name}`, ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size',
      `${w}x${h}`, '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2', '-c:v', 'png',
      'pipe:1'], Buffer.from(d.buffer, d.byteOffset, d.length)));
    // WHY it came out the way it did, not just that it did: "kept untrimmed"
    // is the outcome worth being able to look up a year later, when a pack in
    // the drawer still has its white card and nobody remembers whether that is
    // this script giving up or the photograph never having had a border.
    man.files[name] = why ? `plain: ${why}` : 'trimmed';
    done++;
    console.log(`${i}/${total} ${id} ${why ? `plain: ${why}` : 'trimmed'}`);
  } catch (e) {
    failed++;
    console.log(`${i}/${total} ${id} failed: ${e.message}`);
  }
  // written as it goes, so an interrupted run keeps what it finished. The other
  // way round — one write at the end — means a Ctrl-C an hour in has done nothing
  if ((done + skipped + failed) % 25 === 0) save();
}
save();

const kb = readdirSync(OUT).reduce((n, f) => n + statSync(`${OUT}/${f}`).size, 0) / 1e6;
console.log(`\n${done} processed, ${skipped} already on disk at this recipe, ${plain} kept untrimmed, ${failed} failed`);
console.log(`${OUT}/ — ${kb.toFixed(1)} MB at ${size}`);
console.log(existsSync('serve.py') ? 'Config → TCGplayer → Local now has files to serve.' : '');

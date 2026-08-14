// Fetch every booster photograph once and TRIM IT ON THE WAY IN.
//   node gen-packs.mjs [size]        size: 200w (default) | in_1000x1000
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
// The algorithm below is a straight port of trimPack() in index.html and must
// stay one: the two produce the same picture, or switching Local/Online in
// Config changes how the app LOOKS, which is not what that chip is for.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';

const SIZES = { '200w': 1, in_1000x1000: 1 };
const size = process.argv[2] || '200w';
if (!SIZES[size]) { console.error(`size must be one of: ${Object.keys(SIZES).join(', ')}`); process.exit(1); }

// same constants as index.html — see the note above about staying in step
const TRIM_TOL = 28, PACK_SAT = 1.3, WHITE = 255, MAX_GAIN = 1.7, LEVELS = 0.02;
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

function trim(d, w, h) {
  /* Seeded from the whole outer RING, not the four corners. Corners alone threw
     away a third of the packs: many of these are cropped tight enough that a
     corner is one pixel of white above fifteen of artwork, and where the white
     survives only as a top and a bottom strip a flood from the corners cannot
     reach the second strip at all — the two are not connected. */
  const ring = [];
  for (let x = 0; x < w; x++) { ring.push(x * 4); ring.push(((h - 1) * w + x) * 4); }
  for (let y = 1; y < h - 1; y++) { ring.push(y * w * 4); ring.push((y * w + w - 1) * 4); }
  const vote = ring.filter((_, i) => !(i % 4));
  const near = (a, b) => Math.abs(d[a] - d[b]) <= TRIM_TOL
    && Math.abs(d[a + 1] - d[b + 1]) <= TRIM_TOL && Math.abs(d[a + 2] - d[b + 2]) <= TRIM_TOL;
  // "most frequent" has to mean most AGREED WITH, not most identical: JPEG noise
  // on a white margin splits one background in two if you quantise it first
  let bg = -1, agree = 0;
  for (const a of vote) {
    let n = 0;
    for (const b of vote) if (near(a, b)) n++;
    if (n > agree) { agree = n; bg = a; }
  }
  if (agree < vote.length / 4) return 'no background';   // not a background, leave it
  const br = d[bg], bgg = d[bg + 1], bb = d[bg + 2];
  const seen = new Uint8Array(w * h), stack = ring.map((i) => i / 4);
  let cleared = 0;
  while (stack.length) {
    const at = stack.pop();
    if (seen[at]) continue;
    seen[at] = 1;
    const i = at * 4;
    if (Math.abs(d[i] - br) > TRIM_TOL || Math.abs(d[i + 1] - bgg) > TRIM_TOL
      || Math.abs(d[i + 2] - bb) > TRIM_TOL) continue;
    d[i + 3] = 0; cleared++;
    const x = at % w;
    if (x) stack.push(at - 1);
    if (x < w - 1) stack.push(at + 1);
    if (at >= w) stack.push(at - w);
    if (at < w * (h - 1)) stack.push(at + w);
  }
  if (cleared > w * h * 0.85) return 'ate the pack';
  /* White balance off the very reference the fill just used: that colour WAS
     white when the pack was photographed, so whatever it came back as is the
     cast. MAX_GAIN is the brake — a reference at 147 or below is a photograph
     this cannot rescue, and below 64 it was never white at all. */
  const top = Math.max(br, bgg, bb);
  const gain = top < 64 ? [1, 1, 1]
    : [br, bgg, bb].map((c) => Math.min(MAX_GAIN, WHITE / Math.max(c, 1)));
  const hist = new Uint32Array(256);
  let opaque = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i] = Math.min(255, d[i] * gain[0]);
    const g = d[i + 1] = Math.min(255, d[i + 1] * gain[1]);
    const b = d[i + 2] = Math.min(255, d[i + 2] * gain[2]);
    hist[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
    opaque++;
  }
  /* Then LEVELS off the pack's own histogram: white balance can only carry a
     photograph as far as its backdrop, and a wrapper with no white in it stays
     flat. A pack with no range to stretch is flat because it IS flat, and
     amplifying that only amplifies the JPEG. */
  let lo = 0, hi = 255, acc = 0;
  const edge = opaque * LEVELS;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= edge) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= edge) { hi = v; break; } }
  const stretch = hi - lo >= 64 ? 255 / (hi - lo) : 1;
  const level = (v) => Math.max(0, Math.min(255, (v - lo) * stretch));
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = level(d[i]), g = level(d[i + 1]), b = level(d[i + 2]);
    // push the colour out from its own luminance, so grey stays grey
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    d[i] = Math.max(0, Math.min(255, l + (r - l) * PACK_SAT));
    d[i + 1] = Math.max(0, Math.min(255, l + (g - l) * PACK_SAT));
    d[i + 2] = Math.max(0, Math.min(255, l + (b - l) * PACK_SAT));
  }
  return null;
}

mkdirSync(OUT, { recursive: true });
const have = new Set(readdirSync(OUT));
let done = 0, skipped = 0, plain = 0, failed = 0;

for (const id of ids) {
  const name = `${id}_${size}.png`;
  if (have.has(name)) { skipped++; continue; }
  try {
    const res = await fetch(`https://tcgplayer-cdn.tcgplayer.com/product/${id}_${size}.jpg`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const jpg = Buffer.from(await res.arrayBuffer());
    const [w, h] = probe(jpg);
    const raw = ff(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], jpg);
    const d = new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length);
    // a picture we could not cut out is still a picture of a pack: it goes in
    // untrimmed rather than not at all, exactly as the browser path does
    const why = trim(d, w, h);
    if (why) plain++;
    writeFileSync(`${OUT}/${name}`, ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size',
      `${w}x${h}`, '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2', '-c:v', 'png',
      'pipe:1'], Buffer.from(d.buffer, d.byteOffset, d.length)));
    done++;
  } catch (e) {
    failed++;
    console.error(`  ${id}: ${e.message}`);
  }
  if ((done + skipped + failed) % 25 === 0) process.stdout.write('.');
}

const kb = readdirSync(OUT).reduce((n, f) => n + statSync(`${OUT}/${f}`).size, 0) / 1e6;
console.log(`\n${done} fetched, ${skipped} already on disk, ${plain} kept untrimmed, ${failed} failed`);
console.log(`${OUT}/ — ${kb.toFixed(1)} MB at ${size}`);
console.log(existsSync('serve.py') ? 'Config → TCGplayer → Local now has files to serve.' : '');

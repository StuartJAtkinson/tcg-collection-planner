// Cutting a booster photograph out of its white card, in ONE place because it
// runs in two: the browser does it live when pack art is Online, and
// gen-packs.mjs does it once on the way to disk when it is Local.
//
// It was written twice for a while, and the second copy carried a note saying it
// "must stay one" with three assertions in check.mjs enforcing it. That is a
// standing tax on an algorithm nobody wants to think about twice, and it only
// ever detects drift after the fact. Loaded from one file, Local and Online
// cannot disagree — which matters because they are supposed to be the same
// picture, and a difference shows up as Config's chip silently changing how the
// app looks.
//
// Plain top-level declarations, no module: the page loads it with <script src>
// exactly as it loads sets.js, and node reads it with new Function(). Making it
// an ES module would buy the page nothing and cost it a fetch waterfall.
//
// THE SHRUNKEN RECT SHIELDS THE CORE. The flood runs from the rim and clears
// everything outside a rectangle, and the rectangle is the wrapper's own bbox
// pulled inward 20% in width and 10% in height. That keeps a strip of wrapper
// around the pack visible - the place where the flood used to leave a thin
// white halo - while protecting the part of the image we actually want to see,
// which is the booster's centre.
const TRIM_TOL = 28, PACK_SAT = 1.3, WHITE = 255, MAX_GAIN = 1.7, LEVELS = 0.02;

/* `d` is RGBA, straight from getImageData or ffmpeg's rawvideo — the same bytes
   either way, which is what makes one implementation possible. Mutated in place.
   Returns null when the pack was cut out, or WHY it was left alone: a photograph
   this cannot cut is still a photograph of a pack, and it goes through untouched
   rather than not at all. */
function trimPixels(d, w, h) {
  /* Sampled and seeded from the whole outer RING, not the four corners. Corners
     alone are the obvious reading and it threw away a third of the packs: many
     of these photographs are cropped tight enough that a corner is one pixel of
     white above fifteen of artwork, and where the white survives only as a top
     and a bottom strip, a flood from the corners cannot reach the second strip
     at all — the two are not connected. The ring is every border pixel; the
     vote takes every fourth of them.

     And "most frequent" has to mean most AGREED WITH, not most identical.
     Quantising into buckets first looked tidier and cost another third: JPEG
     noise on a white margin lands either side of a bucket edge and splits one
     background in two. Counting neighbours within the tolerance the fill itself
     uses doesn't care where the edges fall. */
  const ring = [];
  for (let x = 0; x < w; x++) { ring.push(x * 4); ring.push(((h - 1) * w + x) * 4); }
  for (let y = 1; y < h - 1; y++) { ring.push(y * w * 4); ring.push((y * w + w - 1) * 4); }
  const vote = ring.filter((_, i) => !(i % 4));
  const near = (a, b) => Math.abs(d[a] - d[b]) <= TRIM_TOL
    && Math.abs(d[a + 1] - d[b + 1]) <= TRIM_TOL && Math.abs(d[a + 2] - d[b + 2]) <= TRIM_TOL;
  let bg = -1, agree = 0;
  for (const a of vote) {
    let n = 0;
    for (const b of vote) if (near(a, b)) n++;
    if (n > agree) { agree = n; bg = a; }
  }
  // less than a quarter of the border agreeing on a colour is not a background
  if (agree < vote.length / 4) return 'no background';
  const br = d[bg], bgg = d[bg + 1], bb = d[bg + 2];
  /* WHITE BALANCE FIRST, before the flood. The ring-vote bg colour is what the
     fill will match against, so the fill works on the corrected scale; that
     reference is also corrected, so it still matches itself. Scaling first
     also lets the row-sweep below see a clean difference between the wrapper
     and the white rim - the cast that hid the rim is now removed. */
  const top = Math.max(br, bgg, bb);
  const gain = top < 64 ? [1, 1, 1]
    : [br, bgg, bb].map(c => Math.min(MAX_GAIN, WHITE / Math.max(c, 1)));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * gain[0]);
    d[i + 1] = Math.min(255, d[i + 1] * gain[1]);
    d[i + 2] = Math.min(255, d[i + 2] * gain[2]);
  }
  /* PACK BBOX AFTER WHITE BALANCE. Same row-sweep as before - per row, the
     FIRST non-bg pixel from each side, union across every row. The cast being
     gone is what makes this clean now: pre-WB the wrapper's highlights could
     read the same as the bg, which made a wrapper with no real white margin
     impossible to bbox. The bbox is an intermediate; it is shrunk 20% width
     and 10% height inward to form the no-go rect the flood respects. */
  let bx0 = w, bx1 = -1, by0 = h, by1 = -1;
  for (let y = 0; y < h; y++) {
    let rowL = w, rowR = -1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.abs(d[i] - br) > TRIM_TOL || Math.abs(d[i + 1] - bgg) > TRIM_TOL
        || Math.abs(d[i + 2] - bb) > TRIM_TOL) { rowL = x; break; }
    }
    for (let x = w - 1; x >= 0; x--) {
      const i = (y * w + x) * 4;
      if (Math.abs(d[i] - br) > TRIM_TOL || Math.abs(d[i + 1] - bgg) > TRIM_TOL
        || Math.abs(d[i + 2] - bb) > TRIM_TOL) { rowR = x; break; }
    }
    if (rowL < w) {
      if (rowL < bx0) bx0 = rowL;
      if (rowR > bx1) bx1 = rowR;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }
  // nothing non-bg found: default to the whole image, which is also no protection
  if (bx0 > bx1) { bx0 = 0; bx1 = w - 1; by0 = 0; by1 = h - 1; }
  // shrink the bbox inward to the no-go rect. 20% of width and 10% of height,
  // split equally per side: 10% in from each horizontal edge, 5% from each
  // vertical. The strip between this and the original bbox stays opaque -
  // that is the bit of wrapper the user wants to see, so the flood leaves it.
  const sw = bx1 - bx0, sh = by1 - by0;
  const dx = Math.round(sw * 0.1), dy = Math.round(sh * 0.05);
  const sx0 = bx0 + dx, sx1 = bx1 - dx, sy0 = by0 + dy, sy1 = by1 - dy;
  const seen = new Uint8Array(w * h);
  // mark the shrunken rect as off-limits to the flood
  for (let y = sy0; y <= sy1; y++) {
    const rowBase = y * w;
    for (let x = sx0; x <= sx1; x++) seen[rowBase + x] = 1;
  }
  const stack = ring.map(i => i / 4);
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
  /* Then LEVELS, off the pack's own histogram rather than the paper's. White
     balance can only carry a photograph as far as its backdrop, and a wrapper
     with no white in it stays flat: Doctor Who's red channel tops out at 241
     over the entire pack, so there is nothing there for a white point to find.
     So take the top of the near-black and the bottom of the near-white — the
     LEVELS fraction of pixels at each end — and stretch what lies between to the
     full range. Clipping both ends is the point, not a side effect: whatever the
     brightest thing is, usually the text, comes out white. A washed-out wrapper
     gets washed further, which is the trade.
     One brake: a pack with no range to stretch (span under a quarter) is flat
     because it IS flat, and amplifying that only amplifies the JPEG. */
  const hist = new Uint32Array(256);
  let opaque = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;                       // trimmed away, don't pay for it
    // WB already corrected every channel up top; build the histogram off the
    // corrected pixels and DO NOT apply gain again here, or every channel
    // doubles its correction and clips to white.
    const r = d[i], g = d[i + 1], b = d[i + 2];
    hist[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
    opaque++;
  }
  let lo = 0, hi = 255, acc = 0;
  const edge = opaque * LEVELS;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= edge) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= edge) { hi = v; break; } }
  const stretch = hi - lo >= 64 ? 255 / (hi - lo) : 1;
  const level = v => Math.max(0, Math.min(255, (v - lo) * stretch));
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = level(d[i]), g = level(d[i + 1]), b = level(d[i + 2]);
    // last, push the colour out from its own luminance — the same weights the
    // card frames pick their ink by, so grey stays grey and only hue moves
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    d[i] = Math.max(0, Math.min(255, l + (r - l) * PACK_SAT));
    d[i + 1] = Math.max(0, Math.min(255, l + (g - l) * PACK_SAT));
    d[i + 2] = Math.max(0, Math.min(255, l + (b - l) * PACK_SAT));
  }
  return null;
}

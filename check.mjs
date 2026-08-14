// ponytail: the smallest thing that fails if the draft's rules break. Renders every
// route under a stubbed DOM and asserts the decisions we keep re-making, so they stop
// regressing silently. Run: node check.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';
const MONTHS_3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// sets.js is generated data loaded ahead of the page script — same order as the browser
const page = readFileSync('index.html', 'utf8');   // the markup too: <body> carries the UI scale
const src = readFileSync('sets.js', 'utf8')
  + page.match(/<script>([\s\S]*)<\/script>/)[1];
const js = src
  + '\nglobalThis.__t = { SETS, jsArg, gutterMid, PACK_ROWS, PACK_ART, PACK_SAT, packArt, packUrl, draftPack, SOURCES, setSrc, setQuality, artUrl, bytes, CARDS, MockCard, TitleRow, MANA, frameOf, lum, ink, factsOf, setFace, packsFor, BOOSTER, collationNote, DRAFTABLE, ALL, materialise, costTokens, CARD_LIMIT, openedCard, loadCards, scopedCards, glyphOf, symbolise, nameFit, typeFit, textFit, setZoom, binderDims, zoomPx, setBinderDim, setAcross, views, defaultView, sortCards, GROUPS, SORT_KEY, GROUP_LABEL, BINDER_SORT, setIconUrl, RARITY_DOT, pipOf, askDraw, cancelDraw, draftSet, clearItem, PULL, revealOne, closeDraw, drawn, allDrawn, packAt, pool, setPackMode, discardDraw, pickCard, keepDraw, MODES, packsForMode, LISTS, reDraw, reveal, revealAt, nextPack, packLabel, drawPack, loadBoosters, loadPackIndex, COLLATION, printingAt, selectItem, goTab, cycleSort, openCard, setMatched, dragSort, moveSort, applySort, addSort, setView: v => { P.view = v; }, sortDirty, BUCKETS, namesFit, countsFit, nameRoom, num, toggleCost, pickColour, clearColours, setComboMode, ORDER, PAGES, NAV, P, TABS, LISTS, GAMES, CFG, render, grouping,'
  + ' pickGame, selectItem, clearItem, toggleSelector, picked, selectorOpen,'
  + ' setDebug: v => { DEBUG = v; } };';

/* The collation is generated data, like sets.js — read from disk, not fetched.
   boosters/index.json says which booster kinds each set actually has a sheet
   for, which is what packsFor() reads instead of assuming every play-era set
   also prints a Collector Booster. */
const packIndex = JSON.parse(readFileSync('boosters/index.json', 'utf8'));
let painted = '';
const ctx = vm.createContext({
  // querySelector answers null: render() carries the draw grid's sideways
  // scroll across the innerHTML that destroys it, and in a harness with no
  // layout there is no scroll to carry — "no such element" is the truth here.
  document: { getElementById: () => ({ set innerHTML(v) { painted = v; } }),
              querySelector: () => null, set title(v) {} },
  location: { hash: '' }, addEventListener: () => {}, setInterval: () => {}, console,
});
vm.runInContext(js, ctx);
const t = ctx.__t;
t.loadPackIndex(packIndex);
/* ...and, for the sets the harness draws from, the sheets themselves plus a
   catalogue that covers every printing they name. Both come off disk: a pack is
   now dealt from the real collation, so a draw with no catalogue behind it has
   nothing to resolve "MKM:143" to and comes up empty. Seeding from the sheets'
   own keys is the point — it is exactly the join the page has to make. */
const seedCollation = (code) => {
  const kinds = JSON.parse(readFileSync(`boosters/${code}.json`, 'utf8')).kinds;
  t.loadBoosters(code, kinds);
  const keys = new Set();
  for (const cfg of Object.values(kinds))
    for (const sh of Object.values(cfg.sheets)) for (const k of Object.keys(sh.cards)) keys.add(k);
  const o = [['Alpha Card', '{G}', 'Creature — Elf', 'One.', '1/1', 'G', 1],
             ['Beta Card', '{U}', 'Instant', 'Two.', '', 'U', 1],
             ['Gamma Card', '{R}', 'Sorcery', 'Three.', '', 'R', 2],
             ['Delta Card', '{W}', 'Enchantment', 'Four.', '', 'W', 3]];
  const p = [...keys].map((k, i) => {
    const at = k.lastIndexOf(':');
    return [i % 4, k.slice(0, at), k.slice(at + 1), 1 + (i % 4), `art${i}`, 0.1];
  });
  t.loadCards({ o, p });
  return keys;
};
const header = h => h.slice(0, h.indexOf('</header>'));
// the subheader: everything between the top bar and the scrolling pane
const header2 = h => h.slice(h.indexOf('</header>'), h.includes('<main') ? h.indexOf('<main') : undefined);
// browse tabs open with the selector filling the window, so most assertions
// need a selection made first — that's what puts filter/sort/view on screen
const DEFAULT_PICK = { printings: 'Foundations (FDN)', binders: 'Alara block', decks: 'Mono-Red Burn' };
// the bar stages, Apply commits — tests take the same route a click would
const setSort = list => { t.P.sortDraft = list.map(x => ({ ...x })); t.applySort(); };
/* A binder is not filtered. It was MADE by a filter — a set binder, or a fixed
   combination chosen once — so narrowing it afterwards asks a question it has
   already answered; Search and Printings are where you go looking. */
const FILTERED = r => !r.replace('#/', '').startsWith('binders');
const go = route => {
  ctx.location.hash = route; t.render();
  const pick = DEFAULT_PICK[route.replace('#/', '')];
  if (pick && !t.picked()) t.selectItem(pick);
  return painted;
};

// --- you must pick a game before anything else exists ------------------
assert.strictEqual(t.P.game, null, 'a game is preselected — it must be chosen');
for (const r of ['search', 'decks', 'binders', 'printings', 'io', 'config']) {
  ctx.location.hash = '#/' + r; t.render();
  assert.ok(painted.includes('Pick a game'), `${r} did not fall back to the main`);
  // the main wears the same header, so "Card Collector" doesn't jump when you
  // pick — but with no game there are no tabs and no mark
  assert.ok(painted.includes('>Card Collector</span>'), 'the main lost the wordmark');
  assert.ok(!painted.includes('>Search</a>'), 'the main shows tabs before a game is chosen');
  // (the banners below show both marks — it's the header that must be bare)
  assert.ok(!header(painted).includes('ms-watermark-planeswalker'),
    'the header shows a game mark before one is picked');
}
// a fresh session applies nothing on your behalf
assert.strictEqual(t.P.sort.length, 0, 'sort has a default');
assert.strictEqual(t.P.sortDraft.length, 0, 'the sort bar starts with terms staged');
assert.strictEqual(t.P.view, null, 'display has a default');
assert.strictEqual(t.P.cost.length, 0, 'a mana-cost symbol is preselected');
assert.deepStrictEqual(Object.values(t.P.pick).join(','), ',,', 'something is preselected');
// picking a game locks it in, and resets rather than inheriting
setSort([{ f: 'name', d: 'a' }]); t.P.view = 'grid';
t.pickGame('pokemon');
assert.strictEqual(t.P.game, 'pokemon', 'picking a game did not set it');
assert.strictEqual(t.P.sort.length, 0, 'a new game inherited the old sort');
assert.strictEqual(t.P.view, null, 'a new game inherited the old display');
// the app enters at whatever tab is furthest left — reorder NAV and the
// landing page follows, rather than a second hardcoded route drifting out of sync
assert.strictEqual(ctx.location.hash, `#/${t.NAV[0][0]}`, 'picking a game did not land on the leftmost tab');
assert.strictEqual(t.NAV[0][0], 'printings', 'the leftmost tab is no longer Printings');
t.pickGame('mtg');

// every route resolves to its own page — a missing one falls back and still looks fine
for (const r of t.ORDER) assert.ok(t.PAGES[r], `route "${r}" has no PAGES entry`);

for (const r of t.ORDER.filter(r => r !== 'home')) {
  ctx.location.hash = '#/' + r;
  t.render();
  const h = header(painted);

  assert.ok(painted.trimStart().startsWith('<header'), `${r}: does not open with <header>`);
  // the game logo is top-LEFT and the cog is top-RIGHT — the logo is also the
  // way back to the main, which is the only place the game can change
  // wordmark first, then the game mark, then the tabs — the wordmark holds the
  // same x-position on every screen including the main, so nothing jumps
  assert.ok(h.indexOf('>Card Collector</span>') < h.indexOf('ms-watermark-planeswalker'),
    `${r}: the game mark is not to the right of the wordmark`);
  assert.ok(h.indexOf('ms-watermark-planeswalker') < h.indexOf('>Printings</a>'),
    `${r}: the game mark is not between the wordmark and the tabs`);
  // browse tabs in order, Search last
  const TABS_ORDER = ['Printings', 'Binders', 'Decks', 'Search'];
  const tabOrder = TABS_ORDER.map(l => h.indexOf(`>${l}<`));
  for (let i = 1; i < tabOrder.length; i++)
    assert.ok(tabOrder[i - 1] < tabOrder[i], `${r}: tab order is wrong around "${TABS_ORDER[i]}"`);
  assert.ok(!h.includes('Import/Export'), `${r}: the Import tab still says Import/Export`);
  // Import is a rare one-off, so it sits with the cog on the right — after the
  // stats block, not among the browse tabs
  assert.ok(h.lastIndexOf('href="#/io"') > h.lastIndexOf('>Search<'),
    `${r}: Import is still among the browse tabs`);
  assert.ok(h.lastIndexOf('href="#/config"') > h.lastIndexOf('href="#/io"'),
    `${r}: the cog is not right of Import`);
  // Kit is a design reference, not a user page — it lives in Config
  assert.ok(!h.includes('href="#/kit"'), `${r}: Kit is back in the top nav`);
  assert.ok(h.includes('>Card Collector</span>'), `${r}: wordmark missing`);
  assert.ok(!/Advisor|Collections/.test(h), `${r}: dropped section reappeared in the nav`);
  // tabs are on every page now — the selector under the header carries the
  // selection instead, so nothing has to hide to make room
  if (r !== 'home') {
    assert.ok(h.includes('>Search</a>'), `${r}: Search is missing from the nav`);
    assert.ok(h.lastIndexOf('>Search</a>') > h.lastIndexOf('>Import/Export'),
      `${r}: Search is not the last tab`);
  }
  // the game is fixed while navigating — only the main can change it
  assert.ok(!painted.includes('pickGame('), `${r}: offers a game switcher away from the main`);
  // no <h1> restating the active nav tab
  for (const [, lbl] of t.NAV) {
    assert.ok(!painted.includes(`text-white">${lbl}</h1>`), `${r}: <h1> duplicates the "${lbl}" tab`);
  }
  for (const junk of ['undefined', '[object Object]', '>null<', ' null ', 'NaN'])
    assert.ok(!painted.includes(junk), `${r}: leaked "${junk}" into the page`);
  // A <button>/<select>/<a> inside a <button> is invalid: the parser closes the
  // outer button early and the rest spills out of the flex row. Invisible in
  // the source, shows up only as a mangled layout.
  let depth = 0;
  for (const m of painted.matchAll(/<(\/?)(button|select|a)\b/g)) {
    if (m[2] === 'button') depth += m[1] ? -1 : 1;
    else if (depth > 0 && !m[1]) assert.fail(`${r}: <${m[2]}> nested inside a <button>`);
    assert.ok(depth <= 1, `${r}: <button> nested inside a <button>`);
  }
  console.log(`  ${r.padEnd(10)} ok`);
}

// --- one page shape: selector, then filter / sort / view ---------------
for (const r of ['search', 'printings', 'binders', 'decks'])
  assert.ok(t.PAGES[r].toString().includes('BrowsePage()'), `${r} is not the browse page`);

for (const [route, first] of [['printings', 'Foundations (FDN)'], ['binders', 'Alara block'], ['decks', 'Mono-Red Burn']]) {
  ctx.location.hash = '#/' + route; t.render();
  // OPEN: the selector fills the window and takes the scrollbar. There is no
  // page beneath — filter/sort/view only exist once you've stopped choosing.
  assert.ok(t.picked() === null, `${route}: something is preselected`);
  assert.ok(painted.includes(`selectItem('${first}')`), `${route}: selector does not list ${first}`);
  assert.ok(!painted.includes('<main'), `${route}: the page renders behind an open selector`);
  // exactly one scrolling pane, and with no <main> it must be the selector's
  assert.strictEqual((painted.match(/min-h-0 flex-1 overflow-y-auto/g) || []).length, 1,
    `${route}: the open selector does not own the one scrollbar`);
  for (const band of ['filter', 'sort', 'view'])
    assert.ok(!painted.includes(`>${band}</span>`), `${route}: ${band} shows behind an open selector`);
  // nothing to export while you're still choosing which thing to export
  assert.ok(!painted.includes('>Export</span>'), `${route}: offers Export with nothing selected`);

  // PICKED: collapses to a subheader carrying the name, its numbers and Export
  t.selectItem(first);
  assert.strictEqual(t.selectorOpen(), false, `${route}: selector did not collapse on pick`);
  assert.ok(painted.includes(first), `${route}: collapsed subheader does not name the selection`);
  assert.ok(!painted.includes(`selectItem('${first}')`), `${route}: list is still showing when collapsed`);
  assert.ok(header2(painted).includes('>Export</span>'), `${route}: Export is not in the subheader`);
  // the bar names the thing; the top bar carries its numbers. They used to
  // both show a count, and disagree about it.
  assert.ok(!/\d+ cards/.test(header2(painted)), `${route}: the bar repeats a count the stats already show`);
  // grouping is decided once at import; everything after happens on the thing
  // itself — which is only true if the controls are actually here
  if (t.TABS[route].keyed) {
    for (const c of ['Add cards', 'Arrange', 'Remove'])
      assert.ok(header2(painted).includes(c), `${route}: no "${c}" control on the thing itself`);
  } else {
    assert.ok(!header2(painted).includes('Add cards'), `${route}: a set is not editable`);
  }
  assert.ok(!painted.includes('>export</span>'), `${route}: the old export band is still below`);
  // sort / view are on this page too — that's the whole point — and filter is
  // there for everything a binder is not
  for (const band of FILTERED(route) ? ['filter', 'sort', 'view'] : ['sort', 'view'])
    assert.ok(painted.includes(`>${band}</span>`), `${route}: no ${band} band`);
  if (FILTERED(route))
    assert.ok(painted.indexOf('>filter</span>') > painted.indexOf('<main'),
      `${route}: the filter is not inside the scrolling pane`);
  else
    assert.ok(!painted.includes('>filter</span>'), `${route}: a binder is offering a filter`);

  // clicking the subheader toggles it back open
  t.toggleSelector();
  assert.strictEqual(t.selectorOpen(), true, `${route}: subheader does not reopen the selector`);
  assert.ok(painted.includes(`selectItem('${first}')`), `${route}: reopened selector has no list`);
  t.clearItem();
}
// Search is the one tab with nothing to select — but it keeps the bar, so
// Export sits in the same place on every page
ctx.location.hash = '#/search'; t.render();
assert.ok(!painted.includes('selectItem('), 'Search should have no selector — it is all cards');
assert.ok(header2(painted).includes('>Export</span>'), 'search: Export is not in the subheader');
assert.ok(!/&#9662;|&#9652;/.test(header2(painted)), 'search: the bar offers to expand, but has nothing to list');
for (const band of ['filter', 'sort', 'view'])
  assert.ok(painted.includes(`>${band}</span>`), `search: no ${band} band`);
// selections do NOT survive navigation: every tab opens on its full list
ctx.location.hash = '#/binders'; t.render(); t.selectItem('Unsorted');
assert.strictEqual(t.picked(), 'Unsorted', 'selecting did not stick within the tab');
ctx.location.hash = '#/decks'; t.render();
assert.strictEqual(t.picked(), null, 'decks inherited the binders selection');
ctx.location.hash = '#/binders'; t.render();
assert.strictEqual(t.picked(), null, 'binders remembered a selection across navigation');
assert.strictEqual(t.selectorOpen(), true, 'coming back to a tab did not reopen its list');

// --- nothing applied on a fresh page -----------------------------------
go('#/search');
assert.ok(painted.includes('No display chosen'), 'no empty state for an unpicked display');
// display switches live; order stages and lands on Apply, like the filter
assert.ok(painted.indexOf('>Display<') < painted.indexOf('>Order<'), 'the display is not first on the sort bar');
// Details is Compact plus columns, so it must actually draw more of them
t.setView('compact'); t.render();
const lean = (painted.match(/shrink-0/g) || []).length;
t.setView('details'); t.render();
assert.ok((painted.match(/shrink-0/g) || []).length > lean, 'Details draws no more columns than Compact');
// ...and every row in a layout draws the SAME columns: `.map(KeyRow)` hands the
// array index in as its `detail` flag, so row 0 stayed lean while every row
// under it silently switched to the details layout and squeezed out the name.
for (const v of ['details', 'deck']) {
  t.setView(v); t.render();
  const rows = (painted.match(/onclick="openCard\(/g) || []).length;
  const wide = (painted.match(/title="Mana value"/g) || []).length;
  assert.ok(wide === (v === 'details' ? rows : 0),
    `${v}: ${wide} of ${rows} rows drew the detail columns — the layout is not uniform`);
}
t.setView(null); t.render();
// the row layouts fill the pane — a fixed max-width left half the window empty
for (const v of ['compact', 'details']) {
  t.setView(v); t.render();
  const rows = painted.slice(painted.indexOf('>view<'));
  assert.ok(!/max-w-\w+[^"]*rounded-lg border border-neutral-800 bg-neutral-950/.test(rows),
    `the ${v} layout is width-capped instead of spanning the pane`);
}
t.setView(null); t.render();
assert.ok(painted.includes('onclick="setView('), 'the display is not a live switch');
assert.ok(painted.includes('onclick="applySort()"'), 'the sort bar has no Apply');
t.addSort('name');
assert.strictEqual(t.sortDirty(), true, 'a staged term did not mark the bar dirty');
assert.strictEqual(t.P.sort.length, 0, 'a staged term applied itself without Apply');
t.applySort();
assert.strictEqual(t.P.sort.length, 1, 'Apply did not commit the staged order');
assert.strictEqual(t.sortDirty(), false, 'the bar is still dirty after Apply');
setSort([]);
assert.ok(!/CHIP_PLUS/.test(painted), 'chip constant leaked');
// with no sort there is no grouping, so no group headers
assert.ok(!painted.includes('White &middot; Rare'), 'results are grouped with no sort set');
// the anatomy filter must come up with nothing ticked
const anatomy = painted.slice(painted.indexOf('>filter<'), painted.indexOf('>sort<'));
assert.ok(!anatomy.includes('<b>+</b>') && !anatomy.includes('<b>−</b>'),
  'the card-anatomy filter ships with selections already made');

// everything past here is about behaviour once you have made choices
setSort([{ f: 'colour', d: 'a' }, { f: 'rarity', d: 'd' }, { f: 'BREAK' }, { f: 'name', d: 'a' }]);
t.P.view = 'grid';

// --- binder: sort, and neither filter nor display ----------------------
/* Reversed twice, so the reasoning is worth keeping. Originally "a binder is a
   list, not a query" — no filter. On 2026-08-07 that read as broken rather than
   principled and binders filtered like everything else. Reversed again on
   2026-08-12 with the argument that settles it: a binder was MADE by a filter —
   a set binder, or a fixed combination chosen once — so filtering it afterwards
   asks a question it has already answered. Searching a collection is what
   Search and Printings are for. Sort stays: how you arrange a binder you own is
   a live question in a way what is in it is not. */
go('#/binders');
assert.ok(!painted.includes('>Type</span>'), 'a binder is offering to filter itself');
assert.ok(!painted.includes('>filter</span>'), 'the binder still has a filter band');
assert.ok(painted.includes('Break'), 'binder scope lost the sort row');
/* A binder has one layout and it is the binder — drawing a binder as a compact
   list was offering to draw it as something it is not. So it is the one tab with
   a default, and the chooser goes with it: one button that cannot be turned off
   is not a choice, it is a label. */
assert.strictEqual(t.views().map(v => v[0]).join(','), 'binder',
  'the binders tab offers a layout other than the binder');
assert.strictEqual(t.P.view, 'binder', 'the binders tab does not default to its only layout');
assert.ok(!painted.includes('>Display<'), 'the binder offers a display chooser with one display');
assert.ok(painted.includes("setView('binder')") === false,
  'the binder still renders a button for the layout it always has');
// but the tabs that do have a choice keep it
go('#/printings');
assert.ok(painted.includes('>Display<') && painted.includes(">Type</span>"),
  'printings lost its display chooser or its filter');
/* The identity-key rules move to DECKS: the other scope that holds copies, and
   one that still draws every layout. */
// identity key = set · language · collector number · finish · qty, never the
// name alone. Grid tiles carry set·lang·number; Details carries the full key.
go('#/decks'); t.setView('grid'); t.render();
// the tile is a real card face, so the identity key rides its collector bar
assert.ok(/CON 71<\/span> &middot; <span[^>]*>en</.test(painted),
  'grid tile does not show set/language/number');
t.setView('details'); t.render();
for (const part of ['CON', 'en', '71', 'nonfoil', '×'])
  assert.ok(painted.includes(part), `details row is missing "${part}" from the identity key`);
// Compact is the card's title line: name, mana cost, and the count because a
// binder holds copies. It is deliberately NOT the identity key.
t.setView('compact'); t.render();
const rows = painted.slice(painted.indexOf('>view<'));
assert.ok(rows.includes('Noble Hierarch') && rows.includes('class="ms"'),
  'compact is missing the name or the mana cost');
assert.ok(rows.includes('×2'), 'compact drops the count on a scope that holds copies');
for (const part of ['nonfoil', '>CON<', '£'])
  assert.ok(!rows.includes(part), `compact still carries "${part}" from the identity key`);
// the column count is the pane divided by the widest row the data can make —
// auto-fill does the dividing, so resizing the window changes it, not a constant
assert.ok(/repeat\(auto-fill,minmax\(\d+px,1fr\)\)/.test(rows),
  'compact is a single column list rather than filling the pane');
assert.ok(/grid-column:1\/-1/.test(rows), 'a compact group header does not span the columns');
const compactMin = +rows.match(/minmax\((\d+)px/)[1];
const longest = Math.max(...t.GAMES.mtg && [23]);   // "Knight of the Reliquary"
assert.ok(compactMin > longest * 7 && compactMin < longest * 7 + 200,
  `the compact track (${compactMin}px) is not derived from the widest row`);
// a game with shorter names and no mana marks gets narrower columns, with no
// number edited anywhere
t.pickGame('pokemon'); go('#/decks'); t.setView('compact'); t.render();
const pkm = +painted.slice(painted.indexOf('>view<')).match(/minmax\((\d+)px/)[1];
assert.ok(pkm < compactMin, 'the compact track does not follow the data');
t.pickGame('mtg'); go('#/decks'); t.setView('compact'); t.render();

// on a set or a search there are no copies to count, so the column is not drawn
go('#/printings'); t.setView('compact'); t.render();
assert.ok(!/>×\d/.test(painted.slice(painted.indexOf('>view<'))),
  'compact counts copies on a scope that does not hold any');
go('#/decks'); t.setView('grid'); t.render();

// --- the generated set list is well formed ------------------------------
// Scryfall nests two deep in places; taking the immediate parent as the block
// made the middle set both a block and a child, and it rendered twice.
const codes = t.SETS.map(r => r[1]);
assert.strictEqual(new Set(codes).size, codes.length,
  `duplicate set codes: ${codes.filter((c, i) => codes.indexOf(c) !== i).slice(0, 5)}`);
assert.ok(t.SETS.length > 900, `only ${t.SETS.length} sets — this is not all of them`);
assert.strictEqual(t.SETS[0][5], 0, 'the list opens on a sub-set with no parent above it');
for (const [i, r] of t.SETS.entries()) {
  assert.ok(/^\d{4}-\d\d-\d\d$/.test(r[2]), `${r[1]} has no release date`);
  assert.ok(r[4] <= r[3], `${r[1]} owns ${r[4]} of ${r[3]} cards`);
  if (i) assert.ok(r[2] <= t.SETS[i - 1][2] || r[5] || t.SETS[i - 1][5],
    `${r[1]} breaks the newest-block-first order`);
}
// every year between the oldest and newest set is represented — the gutter is
// the only thing dividing 900+ rows, so a gap in it is a hole in the list
const years = new Set(t.SETS.map(r => +r[2].slice(0, 4)));
for (let y = Math.min(...years) + 1; y < Math.max(...years); y++)
  assert.ok(years.has(y), `no sets at all in ${y}`);

// --- the printings selector: a spanning year/month gutter --------------
t.pickGame('mtg'); ctx.location.hash = '#/printings'; t.render();
const head = painted.slice(painted.indexOf('>Year<'), painted.indexOf('>Collected<') + 12);
assert.deepStrictEqual(
  [...head.matchAll(/>(Year|Month|Code|Set|Released|Cards|Collected)</g)].map(m => m[1]),
  ['Year', 'Month', 'Code', 'Set', 'Released', 'Cards', 'Collected'], 'the set table columns are out of order');
assert.ok(t.SETS.every(r => /^[A-Z][a-z]{2}$/.test(MONTHS_3[+r[2].slice(5, 7) - 1])), 'months are not three letters');
// the bar has to be readable as a shape, not just a percentage
assert.ok(head.includes('w-1/4'), 'the Collected column is not given real width');
/* The gutter label is placed, not stuck, so what the markup owes it is a box
   that can be moved without stretching anything and a resting place for when
   nothing has run: `top-1/2` is the middle of the whole block, which is where a
   block that fits on screen wants it anyway. */
const spanning = [...painted.matchAll(/<td rowspan="(\d+)"[\s\S]*?<\/td>/g)];
const gutters = spanning.filter(m => m[0].includes('vertical-rl'));
assert.ok(gutters.length > 100, 'the year/month gutter no longer spans its rows');
for (const [cell] of gutters) {
  assert.ok(/class="[^"]*\bborder-y\b/.test(cell), 'a gutter block is not closed off top and bottom');
  assert.ok(/<div class="absolute inset-x-0 top-1\/2 [^"]*-translate-y-1\/2/.test(cell),
    'the gutter label is either in flow (it will stretch the rows) or not centred on the point it is placed at');
}
/* The pack column: one cell per block, sized by the picture. A block with art
   must span at least PACK_ROWS rows — that is what the gap rows are for, and
   without them the image stretches the real rows instead. Lazy, because there
   are 184 of these and only the ones you scroll to should ever be fetched. */
const packs = spanning.filter(m => m[0].includes('<img'));
assert.ok(packs.length > 150, 'the pack column has lost most of its art');
for (const [cell, rows] of packs) {
  assert.ok(+rows >= t.PACK_ROWS, `a block with pack art spans ${rows} rows, too few to show it`);
  assert.ok(/loading="lazy"/.test(cell), 'a pack image is fetched whether or not you scroll to it');
  /* The trim is canvas work this harness can't run, but its preconditions are
     markup and they are the part that goes wrong silently: without crossorigin
     the pixels are unreadable and every pack stays in its white box, and without
     the retry a stale non-CORS copy in the HTTP cache shows a broken image
     rather than an untrimmed one. */
  assert.ok(/crossorigin="anonymous"/.test(cell), 'the pack pixels will be unreadable, so nothing can be trimmed');
  assert.ok(/onload="trimPack\(this\)"/.test(cell), 'a pack image is never offered to the trim');
  assert.ok(/onerror="packRetry\(this\)"/.test(cell), 'a pack image that fails CORS has no way back');
  assert.ok(/h-\[186px\] w-\[186px\]/.test(cell), 'the pack art is not the square the gap rows are cut for');
  assert.ok(/data-packs="\d+( \d+)*"/.test(cell), 'a pack image has nothing to cycle through');
}
// the balance rides on the trim's own reference, so it can't be dialled out to
// nothing without saying so
assert.ok(t.PACK_SAT > 1, 'the pack saturation is a no-op — say so or remove it');
// the gap rows are real rows, with the height the arithmetic assumes
const gaps = [...painted.matchAll(/<td colspan="5" class="h-\[33px\]"><\/td>/g)];
assert.ok(gaps.length > 0 && t.PACK_ROWS * 33 > 186 + 33, 'the gap rows are gone, or no longer tall enough to fit the art');
// and they are blank: a gap row is padding, not a row you can click
for (const m of painted.matchAll(/<tr>(?:(?!<\/tr>)[\s\S])*colspan="5"[\s\S]*?<\/tr>/g))
  assert.ok(!/onclick/.test(m[0]), 'a gap row is clickable');
/* And the arithmetic, in the terms the ask was made in: a block two panes tall
   showing only its top quarter puts its label an eighth of the way down it. */
const PANE = 800, mid = (y, h, top) => t.gutterMid(y, h, 40, top, top + PANE);
assert.strictEqual(mid(0, 2 * PANE, -PANE / 2), 2 * PANE / 8,
  'a block showing only its top quarter does not label that quarter');
assert.strictEqual(mid(0, 2 * PANE, PANE / 2), PANE, 'a block covering the pane does not label the pane');
assert.strictEqual(mid(0, 200, 0), 100, 'a block that fits on screen is not labelled at its own middle');
// off screen either way, the label is parked inside the block rather than beyond it
assert.strictEqual(mid(0, 200, 5000), 180, 'the label is allowed to leave its block at the top');
assert.strictEqual(mid(5000, 200, 0), 20, 'the label is allowed to leave its block at the bottom');
assert.strictEqual(t.gutterMid(0, 20, 40, 5000, 5800), 10, 'a block shorter than its label is not just centred');

// every set is a link to its own page — a set you can only filter by is a set
// you can't get into, which is why blocks came out of the rail
for (const [name, code] of t.SETS)
  assert.ok(painted.includes(`selectItem('${t.jsArg(`${name} (${code})`)}')`),
    `set "${code}" is not clickable through to its own page`);
// the two shapes that break naive interpolation are both in the real list, and
// both have to survive the round trip through an inline handler
assert.ok(t.SETS.some(r => r[0].includes("'")) && t.SETS.some(r => r[0].includes('&amp;')),
  'the apostrophe / ampersand set names are no longer in the list');
assert.ok(painted.includes('\\&#39;') && painted.includes('&amp;amp;'),
  'a set name with an apostrophe or an ampersand is not escaped for its handler');
// the dates label the rows, they don't filter them — a set is the only thing
// on this page you can click, and it always goes to that set's page
assert.ok(!/setNode|onclick="[^"]*"[^>]*rowspan|rowspan="\d+"[^>]*onclick/.test(painted),
  'a date cell is clickable');
const table = painted.slice(painted.indexOf('<table'), painted.indexOf('</table>'));
assert.deepStrictEqual([...new Set([...table.matchAll(/onclick="([a-zA-Z]+)\(/g)].map(m => m[1]))].sort(),
  ['draftPack', 'draftSet', 'selectItem'], 'the set table has a handler that is neither a set click nor a draft');
/* The booster picture is the Draft button, so it must name the set the same way
   the chip does — and it must stop the click there, or the row underneath
   answers the same press by navigating somewhere else. */
for (const m of table.matchAll(/draftPack\(event,'([^']*)'\)/g))
  assert.ok(t.packsFor(m[1].replace(/\\&#39;/g, "'").replace(/&amp;/g, '&'))?.length,
    `the booster picture drafts "${m[1]}", which has no collation`);
assert.ok(t.draftPack.toString().includes('stopPropagation'),
  'clicking the booster also fires the row underneath');
/* The row and the Draft button both name the set the SAME way — the table's
   disambiguated form. Passing the bare name is the bug that hid the Boosters
   button for every set picked from this table. */
const draftable = t.SETS.find(r => t.packsFor(`${r[0]} (${r[1]})`)?.length);
assert.ok(table.includes(`draftSet('${t.jsArg(`${draftable[0]} (${draftable[1]})`)}')`),
  'the Draft button does not name the set the way the row does');
assert.ok(t.packsFor(`${draftable[0]} (${draftable[1]})`)?.length && t.packsFor(draftable[0])?.length,
  'a set resolves in one naming form but not the other');
// and the sets that cannot be drafted get a button-shaped nothing
const tokenRow = t.SETS.find(r => r[6] === 'token');
assert.ok(!table.includes(`draftSet('${t.jsArg(`${tokenRow[0]} (${tokenRow[1]})`)}')`),
  'a token set is offered a draft in the list');
assert.ok(table.includes('no pack data'), 'the list never explains a set it cannot draft');
/* Clicking Draft goes to the draw, and DOES NOT COST YOU YOUR PLACE. Opening
   boosters was a band over this page precisely so it could not lose your row;
   it is a route again because a band leaves every control beneath it live and
   clickable through the gap. Both halves are pinned here: it navigates, and the
   selection you were on is still the selection when you get there — and still
   there when you come back. */
const wasPicked = t.picked();
t.draftSet(`${draftable[0]} (${draftable[1]})`);
assert.strictEqual(ctx.location.hash, '#/draw', 'Draft no longer opens the draw');
assert.strictEqual(t.picked(), wasPicked, 'Draft moved the selection off the row you clicked');
assert.strictEqual(t.P.drawBack, '#/printings', 'the draw did not remember where to go back to');
assert.ok(painted.includes('What are you opening them for?'), 'Draft from the list did not ask');
/* And the page underneath is GONE, not merely covered. This is the assertion
   that pays for the move: a band left every row, chip and button below it live
   and clickable through the gap, and disabling them one by one is a list that
   grows every time the page underneath does. */
assert.ok(!painted.includes('selectItem('), 'the set list is still live behind the draw');
assert.ok(!painted.includes('>Search</a>'), 'the nav is still live behind the draw');
t.closeDraw();
assert.strictEqual(ctx.location.hash, '#/printings', 'closing the draw did not put you back');
assert.strictEqual(t.picked(), wasPicked, 'coming back from the draw lost the row you clicked');
// typed cold it is not a page at all: no set, no question, nothing to paint
ctx.location.hash = '#/draw'; t.render();
assert.ok(painted.includes('selectItem('), '#/draw typed cold painted an empty shell');
ctx.location.hash = '#/printings'; t.render();
t.clearItem();

// year and month span exactly the rows they cover — the whole point of the
// gutter is that "this year covers these rows" is structural, not eyeballed
// vertical-rl or it isn't a gutter label — the booster cell that spans the same
// rows also carries spans, and counting those made 282 months out of 277
const spans = [...painted.matchAll(/rowspan="(\d+)"[\s\S]{0,400}?<span [^>]*vertical-rl[^>]*>([^<]+)</g)].map(m => [+m[1], m[2]]);
assert.ok(spans.length, 'the year/month gutter renders no spanning cells');
const printedRows = (painted.slice(painted.indexOf('<tbody')).match(/<tr[ >]/g) || []).length;
assert.ok(printedRows > t.SETS.length, 'no gap rows were printed at all');
// turned on their side, so the column costs 2.5rem instead of 6rem
assert.ok(/writing-mode:vertical-rl/.test(painted), 'the date labels are not rotated');

// The gutter groups by the block's date, not the row's: a sub-set can ship
// months after its parent, and a rowspan over rows that aren't adjacent
// overlaps the next cell and shears the table sideways.
const blockRel = [];
for (const r of t.SETS) blockRel.push(r[5] && blockRel.length ? blockRel.at(-1) : r[2]);
for (const width of [4, 7]) {
  const keys = blockRel.map(d => d.slice(0, width));
  const runs = [];
  for (const k of keys) (runs.at(-1)?.[0] === k ? runs.at(-1) : runs[runs.push([k, 0]) - 1])[1]++;
  assert.strictEqual(new Set(runs.map(r => r[0])).size, runs.length,
    `a ${width === 4 ? 'year' : 'month'} is split into two runs — its rowspan would overlap the next`);
  /* The counts themselves are no longer SETS.length — the pack column pads a
     short block with gap rows — so the invariant is checked against what was
     actually printed rather than recomputed here: every spanning column covers
     every row exactly once, and a year covers exactly its own months. */
  const got = spans.filter(([, l]) => /^\d{4}$/.test(l) === (width === 4)).map(x => x[0]);
  assert.strictEqual(got.length, runs.length,
    `there are ${got.length} ${width === 4 ? 'year' : 'month'} cells for ${runs.length} runs`);
  assert.strictEqual(got.reduce((a, b) => a + b, 0), printedRows,
    `the ${width === 4 ? 'year' : 'month'} cells do not account for every row`);
  runs.forEach(([, n], i) => assert.ok(got[i] >= n,
    `a ${width === 4 ? 'year' : 'month'} cell spans fewer rows than it has sets`));
}
// the pack column spans the same rows, cut a different way — by block, not month
assert.strictEqual(
  [...painted.matchAll(/<td rowspan="(\d+)" class="border-y border-r[^"]*">/g)].reduce((n, m) => n + +m[1], 0),
  printedRows, 'the pack cells do not account for every row');

// --- the mock card is the anatomy, and the data exercises all of it -----
// A mock that only ever draws a mono-green creature proves nothing, so the
// fixtures carry one of every type and every frame case the layout must survive.
t.pickGame('mtg'); go('#/search'); t.setView('grid'); t.render();
const mtgCards = t.CARDS();
for (const kind of ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'])
  assert.ok(mtgCards.some(c => c.type.includes(kind)), `no ${kind} in the mtg fixtures`);
for (const tier of [1, 2, 3, 4]) assert.ok(mtgCards.some(c => c.rar === tier), `no rarity tier ${tier}`);
assert.ok(mtgCards.some(c => c.col.length > 1), 'nothing multicolour — the gold frame is never drawn');
assert.ok(mtgCards.some(c => c.col === ''), 'nothing colourless');
assert.ok(mtgCards.some(c => c.pt) && mtgCards.some(c => c.loy), 'no power/toughness or no loyalty');
assert.ok(mtgCards.some(c => (c.cost || []).includes('X')), 'no X cost');
assert.ok(mtgCards.some(c => (c.cost || []).some(x => x.includes('/'))), 'no hybrid or phyrexian pip');
assert.ok(mtgCards.some(c => !c.cost.length), 'no card without a cost — the land case');
assert.ok(mtgCards.some(c => c.lang !== 'en') && mtgCards.some(c => c.foil), 'no foreign printing or no foil');
assert.ok(mtgCards.some(c => c.flav), 'no flavour text — the rule above it is never drawn');
// the frame is the five plates, whatever the card is
for (const c of mtgCards) {
  const one = t.MockCard(c);
  assert.ok(one.includes(c.n) && one.includes(c.type), `${c.n}: name or type line missing`);
  assert.ok(/aspect-\[5\/3\.52\]/.test(one), `${c.n}: no art window`);
  assert.ok(one.includes(`${c.set} ${c.num}`), `${c.n}: no collector line`);
  assert.ok(!one.includes('undefined'), `${c.n}: leaked undefined into the frame`);
  // every token draws something rather than vanishing — its glyph where the font
  // has one (colours, digits, tap), otherwise its own text in the fallback disc
  for (const tok of c.cost || []) {
    const g = t.glyphOf(tok);
    assert.ok(g ? one.includes(g) : one.includes(`>${tok}<`), `${c.n}: dropped the "${tok}" pip`);
  }
}
/* --- the sort actually sorts, and the break actually groups ----------- */
/* It used to do neither: GROUPS chopped the list into equal slices and captioned
   them from a hardcoded array, so "White · Rare" headed a page of whatever fell
   in the first third. These assert the data, not the chrome. */
{
  go('#/printings'); t.clearItem(); t.P.view = 'grid';
  const names = () => t.CARDS().map(c => c.n);
  setSort([]); t.render();
  const unsorted = names().join('|');

  // joined, not deepStrictEqual: arrays built inside the vm carry that realm's
  // Array prototype, which a strict deep-equal counts as a difference
  setSort([{ f: 'name', d: 'a' }]); t.render();
  const asc = [...names()];
  assert.strictEqual(asc.join('|'),
    [...asc].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join('|'),
    'sorting by name does not put the names in order');
  assert.notStrictEqual(asc.join('|'), unsorted, 'the sort changed nothing at all');

  setSort([{ f: 'name', d: 'd' }]); t.render();
  assert.strictEqual([...names()].join('|'), [...asc].reverse().join('|'),
    'reversing the term does not reverse the order');

  // a second term breaks ties inside the first, rather than replacing it
  setSort([{ f: 'rarity', d: 'a' }, { f: 'name', d: 'a' }]); t.render();
  const two = t.CARDS();
  for (let i = 1; i < two.length; i++) {
    assert.ok((two[i - 1].rar || 0) <= (two[i].rar || 0), 'the first term is not the primary sort');
    if ((two[i - 1].rar || 0) === (two[i].rar || 0))
      assert.ok(two[i - 1].n.toLowerCase() <= two[i].n.toLowerCase(),
        'the second term does not break ties within the first');
  }

  // everything left of the BREAK groups, and a group is a run of the sorted list
  setSort([{ f: 'colour', d: 'a' }, { f: 'BREAK' }, { f: 'name', d: 'a' }]); t.render();
  const gs = t.GROUPS();
  assert.ok(gs.length > 1, 'a break produced a single group');
  assert.ok(gs.every(([label]) => label), 'a grouped run has no label');
  // the label has to describe its own members, which is exactly what broke before
  for (const [label, cards] of gs)
    for (const c of cards)
      assert.strictEqual(t.GROUP_LABEL.colour(c), label,
        `"${c.n}" is filed under "${label}", which is not its colour`);
  assert.strictEqual(new Set(gs.map(g => g[0])).size, gs.length,
    'the same group appears twice, so the list was not sorted before grouping');
  assert.strictEqual(gs.reduce((n, g) => n + g[1].length, 0), t.CARDS().length,
    'grouping lost or duplicated cards');
  /* RELEASE is the block, which is what the Printings gutter groups by: a set
     plus the sub-sets filed under it, taking their parent's date because a
     sub-set can ship months later. Sorting by `set` splits a release across the
     list; sorting by `release` keeps it together. */
  {
    const parent = t.SETS.find(r => !r[5] && t.SETS[t.SETS.indexOf(r) + 1]?.[5]);
    const sub = t.SETS[t.SETS.indexOf(parent) + 1];
    assert.ok(parent && sub, 'no parent/sub-set pair in SETS to test a release with');
    assert.strictEqual(t.SORT_KEY.release({ set: sub[1] }), t.SORT_KEY.release({ set: parent[1] }),
      `${sub[1]} does not sort with its block ${parent[1]}`);
    assert.strictEqual(t.GROUP_LABEL.release({ set: sub[1] }), parent[0],
      `${sub[1]} is not filed under the release it belongs to`);
    assert.notStrictEqual(t.SORT_KEY.set({ set: sub[1] }), t.SORT_KEY.set({ set: parent[1] }),
      'release and set are the same key, so one of them is redundant');
    assert.strictEqual(t.GROUP_LABEL.release({ set: 'NOSUCH' }), 'unknown release',
      'a card from no known set claims a release');
    // it is offered as a chip, or it cannot be sorted by
    assert.ok(t.GAMES.mtg.sort.includes('release'), 'Release is not on the sort bar');
  }
  /* A label that is really the whole card, or really the whole type line, makes
     one group per card — which in a binder is one PAGE per card. */
  assert.strictEqual(t.GROUP_LABEL.price({ usd: 42.10 }), '£20–100',
    'the price label is banding the card object instead of its price');
  assert.strictEqual(t.GROUP_LABEL.price({ usd: 0.25 }), 'under £1', 'cheap cards are not banded');
  for (const dash of ['&mdash;', '—'])   // mocks carry the entity, the catalogue a real dash
    assert.strictEqual(t.GROUP_LABEL.type({ type: `Basic Land ${dash} Forest` }), 'Basic Land',
      `the type label does not split on "${dash}"`);
  // no break, no grouping
  setSort([{ f: 'colour', d: 'a' }]); t.render();
  assert.strictEqual(t.GROUPS().length, 1, 'a sort with no break still split the list');
  assert.strictEqual(t.GROUPS()[0][0], null, 'an ungrouped run has a label');
  setSort([]);
}

/* --- the booster art sits at a fixed height, draft button or not ------ */
go('#/printings'); t.clearItem(); t.render();
{
  const cells = painted.match(/<td rowspan="\d+"[^>]*align-top[^>]*>[\s\S]*?<\/td>/g) || [];
  const withArt = cells.filter(c => c.includes('data-packs'));
  assert.ok(withArt.length > 20, `only ${withArt.length} booster cells to check`);
  const drafted = withArt.filter(c => c.includes('draftPack'));
  const undrafted = withArt.filter(c => !c.includes('draftPack'));
  assert.ok(drafted.length && undrafted.length,
    'need both a draftable and an undraftable block to compare');
  // the art is the first thing in the cell either way; the button hangs under it,
  // so a block with no draft data does not start its picture 33px lower
  for (const c of withArt) {
    const art = c.indexOf('data-packs'), chip = c.indexOf('h-[33px]');
    assert.ok(art < chip || chip === -1, 'the draft chip is above the art again');
  }
  for (const c of drafted) assert.ok(c.indexOf('data-packs') < c.indexOf('h-[33px]'),
    'a draftable block draws its button before its pack');
}

/* --- zoom, and the binder page shape that sits beside it ------------- */
// the chrome renders at 0.8; vh does not scale with zoom, so the height is
// divided back out or the app fills four fifths of the window
assert.ok(/<body[^>]*\[zoom:0\.8\]/.test(page), 'the UI is no longer scaled to 0.8');
assert.ok(/<body[^>]*h-\[125vh\]/.test(page), 'zoom without the height compensation leaves the viewport short');
go('#/search'); t.setView('grid'); t.render();
// a stepper, not a slider: you cannot ask a slider for exactly 3 across, and a
// card size worth returning to is worth typing
assert.ok(painted.includes('onchange="setZoom(this.value)"'), 'the Zoom stepper is missing');
assert.ok(/type="number"[^>]*onchange="setZoom/.test(painted.replace(/\s+/g, ' ')),
  'Zoom is not a number input, so it has no arrows and no manual entry');
assert.ok(!painted.includes('type="range"'), 'a range slider is still being drawn');
/* Two rows: what you CHOOSE on the first — Display, Order, Apply/Clear — and
   the numbers that size the layout underneath. The numbers change width as you
   edit them ("9/page &middot; 2 spreads" -> "12/page &middot; 3 spreads"), so
   inline they shove the Order chips sideways while you are aiming at one.
   Ordered by index, not a bounded regex — the markup between them changes. */
{
  // scoped to the sort band: the filter panel has an Apply of its own, earlier
  const band = painted.slice(painted.indexOf('>sort<'));
  const at = (s) => band.indexOf(s);
  assert.ok(at('>Display<') >= 0 && at('>Order<') > at('>Display<'),
    'Order does not follow the display choice');
  assert.ok(at('>Order<') < at('>Apply<'), 'Apply is not at the end of the first row');
  assert.ok(at('>Apply<') < at('>Zoom<'), 'the sizing numbers are not on the row beneath');
  assert.ok(/flex flex-col gap-2[\s\S]{0,400}>Display</.test(band),
    'the sort band is not two stacked rows');
  assert.ok(/min-w-0 flex-1 flex-wrap[\s\S]{0,300}>Order</.test(band),
    'Order is not the part that takes the remaining width');
}
/* The sizing numbers follow the LAYOUT, not the tab. Printings draws the binder
   too, and a card-size percentage is no more use there than it is on Binders —
   the binder sizes itself from Pages/Columns/Rows either way. */
go('#/printings'); t.setView('binder'); t.render();
assert.ok(!painted.includes('>Zoom</span>'), 'the binder on printings still offers Zoom');
for (const label of ['Pages', 'Columns', 'Rows'])
  assert.ok(painted.includes(`>${label}</span>`), `the binder on printings does not offer ${label}`);
// with no binder picked to own the shape, the tab default takes the edit
t.setBinderDim(0, 5); t.render();
assert.strictEqual(t.P.dims[0], 5, 'editing the page shape off a binder did not reach the default');
assert.ok(painted.includes('repeat(5,minmax(0,1fr))'), 'printings did not relay the binder out');
t.P.dims = [3, 3];
// switch the layout back and the percentage returns
t.setView('grid'); t.render();
assert.ok(painted.includes('>Zoom</span>') && !painted.includes('>Pages</span>'),
  'leaving the binder layout did not give Zoom back');
go('#/search'); t.setView('grid'); t.render();

const trackAt = (z) => { t.setZoom(z); t.render(); return +painted.match(/minmax\((\d+)px/)[1]; };
const at100 = trackAt(100), at50 = trackAt(50), at200 = trackAt(200);
assert.ok(at50 < at100 && at100 < at200, `zoom does not resize the cards (${at50}/${at100}/${at200})`);
assert.strictEqual(at100, 224, 'the designed size is no longer what 100% draws');
t.setZoom(500); assert.strictEqual(t.P.zoom, 2, 'zoom is not clamped at the top');
t.setZoom(1);   assert.strictEqual(t.P.zoom, 0.5, 'zoom is not clamped at the bottom');
t.setZoom(100);
// the binder's page shape is data, editable, and the layout lays out exactly that many
go('#/binders'); t.setView('binder'); t.render();
/* The binder has no Zoom: a percentage is the wrong question for it. Pages,
   Columns and Rows say what is open and how it is pocketed, and the card size
   is whatever fits — which is also why the layout can no longer outgrow the
   pane the way a px card size multiplied out by four pages did. */
for (const label of ['Pages', 'Columns', 'Rows'])
  assert.ok(painted.includes(`>${label}</span>`), `the binder does not offer ${label}`);
assert.ok(!painted.includes('>Zoom</span>'), 'the binder still offers a card-size percentage');
assert.ok(painted.includes('onchange="setAcross(this.value)"')
  && painted.includes('onchange="setBinderDim(0,this.value)"')
  && painted.includes('onchange="setBinderDim(1,this.value)"'),
  'pages / columns / rows are not three steppers');
// pages come in twos, because a page has a facing page
assert.ok(/min="2" max="8" step="2"/.test(painted), 'pages across is not stepped in twos');
for (const [v, want] of [[3, 4], [1, 2], [99, 8], [0, 2], [6, 6]]) {
  t.setAcross(v);
  assert.strictEqual(t.P.across, want, `${v} pages across became ${t.P.across}, not ${want}`);
}
t.setAcross(4);
for (const [name, , dims] of t.LISTS.binders) {
  t.selectItem(name); t.setView('binder'); t.render();
  const [cols, rows] = dims;
  assert.ok(painted.includes(`value="${cols}"`) && painted.includes(`value="${rows}"`),
    `${name}: the steppers do not show ${cols}x${rows}`);
  assert.ok(painted.includes(`repeat(${cols},`), `${name}: binder does not lay out ${cols} columns`);
  /* Nothing is measured in px: spreads share the pane, two pages share a
     spread, the pockets share a page. A px card size multiplied out by four
     pages is what made the binder wider than the window. */
  assert.ok(!/repeat\(\d+,\d+px\)/.test(painted),
    `${name}: the binder is still laying out in fixed pixels, so it can outgrow the pane`);
  const outer = /gap-8" style="grid-template-columns:repeat\((\d+),minmax\(0,1fr\)\)/.exec(painted);
  assert.ok(outer, `${name}: there is no grid of spreads`);
  assert.strictEqual(+outer[1], t.P.across / 2,
    `${name}: ${outer[1]} spreads across for ${t.P.across} pages`);
  const inner = [...painted.matchAll(/gap-3"\s*style="grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/g)];
  assert.strictEqual(inner.length, Math.ceil(((painted.match(/>Page \d+</g) || []).length + 1) / 2),
    `${name}: the spread count does not follow from the pages plus the cover`);
  // the pockets share the page the same way
  assert.ok(painted.includes(`repeat(${cols},minmax(0,1fr))`),
    `${name}: the pockets are not ${cols} equal shares of the page`);
  // the first spread is the inside front cover and page 1, so page 1 reads right-hand
  assert.ok(/repeat\(2,minmax\(0,1fr\)\)">\s*<div><\/div>/.test(painted),
    `${name}: the first spread has no cover, so page 1 is a left-hand page`);
  // exactly one blank, and it is the cover: a short final spread just draws its
  // one page on the left, which is where the last page of a binder actually is
  assert.strictEqual((painted.match(/<div><\/div>/g) || []).length, 1,
    `${name}: a spread is padded with a blank that is not the cover`);
  assert.ok(painted.includes('onclick="openCard('), `${name}: a pocket is not clickable like a grid card`);
  assert.ok(painted.includes(`${cols * rows}/page`), `${name}: pockets per page not stated`);
  const pockets = (painted.match(/aspect-\[5\/7\]/g) || []).length;
  assert.ok(pockets % (cols * rows) === 0 && pockets > 0,
    `${name}: ${pockets} pockets drawn is not whole pages of ${cols * rows}`);
  /* A group longer than a page carries on over the next one. Drawing one page
     per group dropped every card past the page size, and with no break at all
     it drew a single page of the whole list — which read as "nine per group"
     only because nine was the page size. */
  assert.ok(pockets >= t.CARDS().length,
    `${name}: ${pockets} pockets for ${t.CARDS().length} cards, so the binder is dropping some`);
}
/* Editing writes back to the BINDER, so each keeps its own shape and picking
   another does not inherit the last one's. */
const staples = t.LISTS.binders.find(b => b[0] === 'Commander staples');
const alara = t.LISTS.binders.find(b => b[0] === 'Alara block');
t.selectItem('Commander staples'); t.setBinderDim(0, 5); t.render();
assert.strictEqual(staples[2][0], 5, 'editing the page shape did not reach the binder');
assert.ok(painted.includes('repeat(5,'), 'the binder did not relay out after the edit');
t.selectItem('Alara block'); t.render();
assert.strictEqual(t.binderDims()[0], alara[2][0], 'a binder inherited another binder page shape');
t.selectItem('Commander staples'); t.setBinderDim(0, 4);
t.setBinderDim(0, 99); assert.strictEqual(staples[2][0], 6, 'the page shape is not clamped at the top');
t.setBinderDim(0, 0);  assert.strictEqual(staples[2][0], 1, 'the page shape is not clamped at the bottom');
t.setBinderDim(0, 4);
// with nothing picked the edit has no binder to own it and falls to the default
t.clearItem(); t.setBinderDim(1, 5); t.render();
assert.strictEqual(t.P.dims[1], 5, 'with no binder picked the edit went nowhere');
assert.strictEqual(alara[2][1], 3, 'an unpicked edit leaked into a binder');
t.P.dims = [3, 3];

/* A binder is ARRANGED, so the Binders tab lands on an arrangement: colour,
   rarity high to low, a page break, then release / set / number inside a page.
   The one departure from "a fresh page applies nothing" — and it must not leak,
   because a six-term order following you to Search is an order you never asked
   for. */
t.P.sort = []; t.P.sortDraft = [];
ctx.location.hash = '#/search'; t.render();
assert.strictEqual(t.P.sort.length, 0, 'search arrived with an order applied');
ctx.location.hash = '#/binders'; t.render();
assert.strictEqual(t.P.sort.map(x => x.f + (x.d || '')).join(),
  'coloura,rarityd,BREAK,releasea,seta,numbera', 'the binder did not arrive filed');
assert.strictEqual(t.sortDirty(), false, 'the arrangement lands staged but unapplied');
// everything left of the break is the grouping: colour, then rarity
assert.strictEqual(t.grouping().map(x => x.f).join(), 'colour,rarity',
  'the page break is not after rarity');
ctx.location.hash = '#/printings'; t.render();
assert.strictEqual(t.P.sort.length, 0, 'the binder arrangement followed you out of the tab');
// but a sort you actually chose there is yours, and survives
ctx.location.hash = '#/binders'; t.render();
setSort([{ f: 'name', d: 'a' }]);
ctx.location.hash = '#/decks'; t.render();
assert.strictEqual(t.P.sort.map(x => x.f).join(), 'name', 'leaving a binder discarded a sort you set');
setSort([]);

/* --- the three things a card face has to get right ------------------- */
// 1. the set symbol, inked by rarity, where the placeholder disc used to be
const mkmCard = { n: 'Delney, Streetwise Lookout', set: 'MKM', num: '378', lang: 'en',
  col: 'W', cost: ['2', 'W'], type: 'Legendary Creature — Human Scout', rar: 4, pt: '2/2', text: 'Flying' };
const marked = t.MockCard(mkmCard);
assert.ok(marked.includes('svgs.scryfall.io/sets/mkm.svg'), 'the set symbol is not drawn');
assert.ok(/mask:url\('https:\/\/svgs\.scryfall\.io[^']+'\) center\/contain/.test(marked),
  'the symbol is an image, so rarity cannot tint it — it has to be a mask');
assert.ok(marked.includes(t.RARITY_DOT[4]), 'the set symbol is not inked with the rarity colour');
// a sub-set borrows its parent's icon, which is why the slug is stored at all
const tokens = t.SETS.find(r => r[1] === 'TMKM');
assert.strictEqual(tokens[8], 'mkm', 'TMKM no longer shares the MKM icon, so this stops testing the slug');
assert.ok(t.setIconUrl('TMKM').endsWith('/mkm.svg'), 'a sub-set does not fall back to its parent symbol');
assert.ok(t.setIconUrl('MKM').endsWith('/mkm.svg'), 'a set whose slug is its own code lost its symbol');
assert.strictEqual(t.setIconUrl('NOSUCH'), '', 'an unknown set invented a symbol');
// no symbol to borrow: the disc stays rather than a wrong set's mark
assert.ok(!t.MockCard({ n: 'Bare' }).includes('svgs.scryfall.io'), 'an unmatched card borrowed a set symbol');

// 2. name and type shrink instead of ellipsing
assert.ok(t.nameFit(10) === 'text-[1.18em]' && t.nameFit(60) === 'text-[0.68em]',
  'the name does not shrink across its range');
assert.ok(t.typeFit(10) === 'text-[0.91em]' && t.typeFit(60) === 'text-[0.59em]',
  'the type line does not shrink across its range');
for (let i = 1; i < 60; i++) assert.ok(
  parseFloat(t.nameFit(i).match(/[\d.]+/)[0]) >= parseFloat(t.nameFit(i + 1).match(/[\d.]+/)[0]),
  `nameFit grows at length ${i}, so a longer name would be set larger`);
const longName = 'Hanweir, the Writhing Township and Then Some More Words';
assert.ok(t.MockCard({ n: longName, cost: ['3', 'R'] }).includes(t.nameFit(longName.length + 4)),
  'a long name is not sized off its own length plus its cost');
// the cost shares the bar, so it counts toward the space the name has
assert.notStrictEqual(t.nameFit(24), t.nameFit(24 + 2 * 5), 'cost pips do not push the name down a step');

// rules text sizes off its own length, and the ladder has to cover the real
// catalogue: oracle text reaches 1,489 characters, well past the mocks' longest
for (let i = 1; i < 1600; i += 7) assert.ok(
  parseFloat(t.textFit(i).match(/[\d.]+/)[0]) >= parseFloat(t.textFit(i + 7).match(/[\d.]+/)[0]),
  `textFit grows at length ${i}, so longer text would be set larger`);
assert.ok(parseFloat(t.textFit(140).match(/[\d.]+/)[0]) >= 1,
  'text of median length is set too small to read');
assert.ok(parseFloat(t.textFit(1489).match(/[\d.]+/)[0]) <= 0.55,
  'the longest card in the catalogue does not bottom out at the smallest step');
/* Each step is the measured overflow point for that size in the grid, so a
   threshold that drifts past it puts text outside its box — which is how the
   first pass at "a few sizes larger" broke 120 of 240 cards. */
for (const [size, overflowsAt] of [[1.09, 144], [1, 207], [0.91, 274], [0.82, 372]]) {
  const px = n => parseFloat(t.textFit(n).match(/[\d.]+/)[0]);
  assert.ok(px(overflowsAt - 1) <= size,
    `${size}em is still used at ${overflowsAt - 1} characters, where it overflows`);
}
/* Zoom draws the card bigger; a face full of fixed px kept 11px type inside it,
   so the shrink-to-fit was fitting a box that no longer existed. The face
   anchors ONE size to its own width and everything else is em of that, which is
   the invariant worth pinning: no px font size may reappear on the face. */
{
  const face = t.MockCard({ n: 'Noble Hierarch', cost: ['1', 'G'], type: 'Creature &mdash; Human Druid',
    text: '{T}: Add {G}, {W}, or {U}.', pt: '0/1', set: 'CON', num: '71', lang: 'en', rar: 3, hp: 60,
    atk: [{ n: 'Gust', cost: ['Colorless'], dmg: '10', t: 'Flip a coin.' }], flav: 'A quiet exalt.' });
  assert.ok(/container-type:inline-size/.test(face), 'the card face is not a container, so cqw has nothing to measure');
  assert.ok(/text-\[[\d.]+cqw\]/.test(face), 'the face does not anchor a root size to its own width');
  assert.strictEqual((face.match(/text-\[[\d.]+px\]/g) || []).join(), '',
    'a fixed px font size is back on the card face, so it will not follow zoom');
  // the list rows are not inside a card box, so they keep their px pips
  assert.ok(/text-\[[\d.]+px\]/.test(t.TitleRow({ n: 'Noble Hierarch', cost: ['1', 'G'], set: 'CON' })),
    'the list row went container-relative with no container to measure');
}

// 3. rules text renders its symbols
const tapped = t.MockCard({ n: 'Elf', text: '{T}: Add {G}. Pay {2} or {U/P}.' });
assert.ok(!/\{T\}|\{G\}|\{2\}/.test(tapped), 'rules text is still printing braces instead of symbols');
assert.ok(tapped.includes(t.glyphOf('T')), 'the tap symbol is not rendered');
assert.ok(tapped.includes(t.glyphOf('G')) && tapped.includes(t.glyphOf('2')),
  'a colour or a number in rules text lost its glyph');
assert.ok(tapped.includes('>U/P<'), 'a hybrid has no single glyph, so it must fall back to its text');
assert.strictEqual(t.glyphOf('15'), String.fromCodePoint(0xe614), 'the digit run does not reach {15}');
assert.strictEqual(t.glyphOf('16'), '', 'a number past the font pretends to have a glyph');
// symbols must not become an injection point now that text is parsed
assert.ok(!t.symbolise('<img src=x onerror=alert(1)>').includes('<img'), 'rules text renders raw HTML');
assert.ok(t.symbolise('a &mdash; b').includes('&mdash;'), 'escaping broke the entities the mocks use');

// A NAME IS THE WHOLE MINIMUM. /resolve draws this frame from a scanned line
// before any printing is known, so every other slot has to degrade on its own —
// and degrade to nothing, not to a default. "Common" invented from a missing
// rarity is worse than a blank, because it reads as a fact.
const bare = t.MockCard({ n: 'Lighming Bolt' });
assert.ok(bare.includes('Lighming Bolt'), 'the frame lost the one field it must have');
for (const leak of ['undefined', 'NaN', 'null'])
  assert.ok(!bare.includes(leak), `a name-only card leaked "${leak}" into the frame`);
assert.ok(/aspect-\[5\/3\.52\]/.test(bare) && bare.includes('no printing'),
  'a name-only card is missing the art window or claims a printing');
for (const invented of ['Common', 'Nonfoil', 'Mythic'])
  assert.ok(!bare.includes(invented), `a name-only card invented "${invented}"`);
// ...and the same for the anatomy the card page reads off it
const bareFacts = Object.entries(t.factsOf({ n: 'Lighming Bolt' }));
for (const [k, v] of bareFacts)
  assert.ok(k === 'Legality' || !v, `a name-only card claims to know "${k}" (${v})`);
// pokemon exercises the other half of the frame: HP, attacks, retreat, no cost
t.pickGame('pokemon');
const pkmCards = t.CARDS();
for (const kind of ['Basic', 'Stage 1', 'Stage 2', 'V ', 'ex ', 'Trainer', 'Energy'])
  assert.ok(pkmCards.some(c => c.type.includes(kind)), `no ${kind.trim()} in the pokemon fixtures`);
assert.ok(pkmCards.some(c => c.hp) && pkmCards.some(c => !c.hp), 'every pokemon fixture has HP, or none does');
assert.ok(pkmCards.some(c => c.atk) && pkmCards.some(c => c.retreat), 'no attacks or no retreat cost');
assert.ok(t.MockCard(pkmCards[0]).includes('HP'), 'the pokemon frame does not show HP');
// the kit draws the real frame, not a picture of one
t.pickGame('mtg'); go('#/kit');
assert.ok(painted.includes('aspect-[5/7]') && painted.includes(mtgCards[0].n),
  'the control kit does not draw the card frame the rest of the app uses');

// The name has to be readable on every frame, which a hardcoded "dark frames"
// list does not deliver: the plates are 45% of the frame over black, so blue,
// red and green plates are dark whatever the list says. Pin the two things that
// are actually true — the ink is the better of the two, and never below the
// large-text floor — rather than a threshold that happens to hold today.
const chan = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const rel = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const ratio = (a, b) => { const [x, y] = [rel(a), rel(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const c of [...mtgCards, ...pkmCards]) {
  const bg = rgb(t.frameOf(c));
  for (const [surface, l] of [[bg, t.lum(t.frameOf(c))], [bg.map(v => v * 0.45), t.lum(t.frameOf(c)) * 0.45]]) {
    const chosen = rgb(t.ink(l)), other = rgb(t.ink(l) === '#1a1a1a' ? '#f0f0f0' : '#1a1a1a');
    assert.ok(ratio(chosen, surface) >= ratio(other, surface),
      `${c.n}: the other ink reads better on ${t.frameOf(c)} — the luminance test is backwards`);
    assert.ok(ratio(chosen, surface) >= 4, `${c.n}: ${ratio(chosen, surface).toFixed(2)}:1 on ${t.frameOf(c)}`);
  }
}
t.pickGame('mtg'); go('#/search'); t.setView(null); t.render();

// --- a tab is also the way back ----------------------------------------
// The two cases an href alone cannot reach: already on the tab, so the hash
// never changes; and off on a card page, where the href moves the route but
// the selection underneath would survive.
for (const r of ['printings', 'binders', 'decks']) {
  go('#/' + r);
  assert.ok(t.picked(), `${r}: nothing selected to clear`);
  ctx.location.hash = '#/' + r;               // clicking the tab you are on
  t.goTab(r);
  assert.strictEqual(t.picked(), null, `${r}: clicking the active tab kept the selection`);
  assert.ok(t.selectorOpen(), `${r}: clicking the active tab left the selector shut`);
}
// from a card page, a tab click gets you back cleared — same as Back
go('#/printings');
t.openCard('Noble Hierarch'); t.setMatched(true);
assert.strictEqual(ctx.location.hash, '#/card', 'the card page did not open');
t.goTab('printings'); ctx.location.hash = '#/printings'; t.render();
assert.strictEqual(t.P.card, null, 'a tab click left the card behind');
assert.strictEqual(t.picked(), null, 'a tab click from a card kept the selection');
assert.ok(painted.includes('>All sets<'), 'a tab click from a card did not reopen the list');
// every tab carries the handler, not just an href
for (const [k] of t.NAV)
  assert.ok(painted.includes(`onclick="goTab('${k}')"`), `the "${k}" tab is an href with no clear`);

// --- the card page works before the card is known ----------------------
// An import is flat text. Until it's matched to a printing the only facts are
// the ones in the line, and the page has to be honest about that rather than
// showing an empty catalogue card.
t.pickGame('mtg'); go('#/search'); t.setView('compact'); t.render();
assert.ok(/openCard\('[^']+'\)/.test(painted), 'a result row is not a way into the card');
t.openCard('Noble Hierarch');
assert.strictEqual(ctx.location.hash, '#/card', 'opening a card did not navigate');
assert.strictEqual(t.P.matched, false, 'a freshly opened card is already matched');
assert.ok(painted.includes('>unmatched<'), 'the card page does not say it is unmatched');
// the source line is shown verbatim and every parsed token with it — built from
// the card that was opened, so a foil prints the *F* and a nonfoil doesn't
assert.ok(painted.includes('2 Noble Hierarch (CON) 71 [en]'), 'the source line is not shown');
for (const tok of ['qty', 'set', 'number', 'language'])
  assert.ok(painted.includes(`>${tok}</span>`), `the parsed token "${tok}" is not shown`);
assert.ok(!painted.includes('>finish</span>'), 'a nonfoil card parsed a finish out of nowhere');
// unmatched: every anatomy field is drawn but none of them claims a value
const labels = t.GAMES.mtg.anatomy.map(x => (x[0] === 'combos' ? 'Colour' : x[1]));
for (const l of labels) assert.ok(painted.includes(`>${l}</span>`), `the card page is missing "${l}"`);
assert.strictEqual((painted.match(/&mdash;<\/span>/g) || []).length >= labels.length, true,
  'an unmatched card claims to know something');
assert.ok(painted.includes('>candidates<'), 'unmatched shows printings rather than candidates');
assert.ok(painted.includes('>Match</button>'), 'there is no way to match the line');
// unmatched draws the SAME frame, fed the one field a card must have — and the
// photo is not on offer, because there is no printing to photograph yet
assert.ok(painted.includes('aspect-[5/7]'), 'the unmatched card page draws a different shape');
assert.ok(/setFace\('photo'\)[^>]*disabled/.test(painted), 'photo is offered before a printing is known');
// matched: same layout, the anatomy filled from the catalogue
t.setMatched(true);
assert.ok(painted.includes('>matched<') && painted.includes('>printings<'),
  'matching did not switch the page over');
assert.ok(painted.includes('Human &middot; Druid') && painted.includes('Mark Zug'),
  'a matched card does not read its anatomy from the catalogue');
for (const l of labels) assert.ok(painted.includes(`>${l}</span>`), `matching dropped "${l}"`);
// ...and it is THIS card's anatomy: open another and every fact follows it,
// which a table keyed by game silently fails while still looking right
t.openCard('Jace Beleren'); t.setMatched(true);
assert.ok(painted.includes('Aleksi Briclot') && painted.includes('Legendary Planeswalker'),
  'the card page shows the same anatomy whatever you opened');
assert.ok(!painted.includes('Mark Zug'), 'the previous card left its facts behind');
assert.ok(painted.includes('4 Jace Beleren') === false && painted.includes('1 Jace Beleren (CON) 32 [en]'),
  'the source line did not follow the card');
t.openCard('Knight of the Reliquary'); t.setMatched(true);
assert.ok(painted.includes('*F*') && painted.includes('>finish</span>'), 'a foil printing lost its finish');
assert.ok(painted.includes('>Exalted<') === false, 'keywords are not read off this card');
t.openCard('Noble Hierarch'); t.setMatched(true);
assert.ok(painted.includes('Exalted'), 'keywords are not derived from the rules text');
// the old /preview page, folded into the one page that shows one card: the image
// slot flips between the frame we draw and the printed card, in place
t.setFace('photo');
assert.ok(painted.includes('printed-card image') && !painted.includes('art_crop'),
  'the photo face does not replace the frame');
t.setFace('frame');
assert.ok(painted.includes('art_crop'), 'the frame face did not come back');
// the fields are the game's, not the page's — the registry claim again
t.pickGame('pokemon'); t.openCard('Pikachu'); t.setMatched(true);
for (const l of ['HP', 'Stage', 'Retreat cost', 'Illustrator'])
  assert.ok(painted.includes(`>${l}</span>`), `the pokemon card page is missing "${l}"`);
assert.ok(!painted.includes('>Toughness</span>'), 'the pokemon card page leaked MTG anatomy');
// holdings are the irreplaceable half and are listed whether or not it matched
t.setMatched(false);
assert.ok(painted.includes('>holdings<'), 'an unmatched card hides where the copies are');
t.pickGame('mtg'); go('#/search');

// --- one counting format: exact while exact is worth reading -----------
for (const [n, want] of [[0, '0'], [999, '999'], [9999, '9999'], [10000, '10k'],
                         [12345, '12.3k'], [107565, '107.6k']])
  assert.strictEqual(t.num(n), want, `${n} should format as ${want}`);
// nothing may fall back to comma grouping
for (const r of ['#/printings', '#/binders', '#/decks', '#/search']) {
  go(r);
  assert.ok(!/>\d{1,3}(,\d{3})+/.test(painted), `${r}: a count is still comma-grouped`);
}
ctx.location.hash = '#/home'; t.render();
assert.ok(painted.includes(`${t.num(107565)} cards`), 'the game banner is not using the short form');

// --- X / Snow / Phyrexian ride the mana cost, not a group of their own ---
t.pickGame('mtg'); go('#/printings');
const mv = () => painted.slice(painted.indexOf('>Mana value<'), painted.indexOf('>Type<'));
assert.ok(mv().includes('grid-cols-3'), 'the cost symbols are not a three-column toggle');
for (const k of ['X', 'Snow', 'Phyrexian'])
  assert.ok(mv().includes(`toggleCost('${k}')`), `the mana cost is missing the "${k}" toggle`);
assert.ok(mv().indexOf('toggleCost') > mv().indexOf('to</span>'), 'the toggles are not under the range');
// independent, and all three can be on at once
t.toggleCost('Snow');
assert.strictEqual(t.P.cost.join(','), 'Snow', 'toggling one symbol did not select just it');
t.toggleCost('X'); t.toggleCost('Phyrexian');
assert.strictEqual(t.P.cost.length, 3, 'the three symbols are not independently selectable');
assert.strictEqual((mv().match(/border-emerald-500/g) || []).length, 3, 'a selected symbol is not marked');
t.toggleCost('X'); t.toggleCost('Snow'); t.toggleCost('Phyrexian');
assert.strictEqual(t.P.cost.length, 0, 'a symbol would not toggle back off');

// --- numeric anatomy is a range, categorical anatomy is chips ----------
// mana value / power / toughness / hp / retreat cost are magnitudes, so they
// take a from/to pair; only the enumerable things stay as counted chips
for (const [k, g] of Object.entries(t.GAMES)) {
  const kinds = Object.fromEntries(g.anatomy.map(([kind, label]) => [label, kind]));
  for (const n of ['Mana value', 'Power', 'Toughness', 'HP', 'Retreat cost'])
    if (n in kinds) assert.strictEqual(kinds[n], 'range', `${k}: "${n}" is a magnitude, not a chip list`);
}
// the colour slicer: six colours on top, every combination they're consistent
// with underneath. Nothing selected must mean everything shown, or the panel
// silently answers a question you never asked.
t.pickGame('mtg'); go('#/printings');
const combo = () => painted.slice(painted.indexOf('>Colour<'), painted.indexOf('>Mana value<'));
assert.ok(!/border border-neutral-800|divide-y/.test(combo()), 'the colour slicer is encapsulated in a box');
assert.strictEqual(t.P.colours.length, 0, 'the colour slicer starts with a selection');
assert.strictEqual(t.P.comboMode, 'contained', 'the default mode is not contained');
const comboButtons = () => [...combo().matchAll(/title="([^"]+) &mdash; (\d+) cards"/g)];
// the six pickers plus all 32 combinations, every one of them naming itself
assert.strictEqual(comboButtons().length, 6 + 32, `${comboButtons().length} colour buttons, expected 38`);
for (const [, name] of comboButtons()) assert.ok(/^[A-Z]/.test(name), `combo "${name}" has no name`);
for (const n of ['Colourless', 'Azorius', 'Jund', 'Glint-Eye', 'Five-colour'])
  assert.ok(combo().includes(`title="${n} `), `the combo panel is missing "${n}"`);
// contained = made of nothing but these colours, so it shrinks as you narrow
// rather than growing; colourless is playable anywhere, so it always survives
t.pickColour('U', 'contained');
assert.strictEqual(comboButtons().length - 6, 2, 'contained blue is not just blue and colourless');
assert.ok(combo().includes('title="Colourless '), 'contained dropped colourless');
t.pickColour('B', 'contained');
assert.strictEqual(comboButtons().length - 6, 4, 'contained blue+black is not C, U, B, UB');
for (const n of ['Colourless', 'Blue', 'Black', 'Dimir'])
  assert.ok(combo().includes(`title="${n} `), `contained blue+black lost "${n}"`);
assert.ok(!combo().includes('title="Grixis '), 'contained let through a combination with an unpicked colour');
// exact = that combination and nothing else
t.pickColour('B', 'exact'); t.pickColour('B', 'exact');
assert.strictEqual(comboButtons().length - 6, 1, 'exact blue+black is not just Dimir');
assert.ok(combo().includes('title="Dimir '), 'exact blue+black did not resolve to Dimir');
// the mode is a visible toggle, not something only right-click can reach
const modeBtn = m => combo().includes(`setComboMode('${m}')`);
assert.ok(modeBtn('contained') && modeBtn('exact'), 'there is no toggle for the combo type');
assert.ok(/bg-emerald-500\/15[^>]*>exact</.test(combo()), 'the toggle does not mark the active mode');
t.setComboMode('contained');
assert.ok(/bg-emerald-500\/15[^>]*>contained</.test(combo()), 'the toggle did not switch mode');
assert.strictEqual(comboButtons().length - 6, 4, 'switching the toggle did not re-filter the panel');
t.clearColours();
assert.strictEqual(comboButtons().length - 6, 32, 'clearing did not bring every combination back');
// a fixed three-row panel that scrolls: it is a readout, not the page
assert.ok(/h-\[[\d.]+rem\] overflow-y-auto/.test(combo()), 'the combo panel is not a fixed scrolling section');
// whether a chip carries its name is measured, not declared: below six
// characters' room it drops to marks alone and the hover carries the rest
for (const [len, label, cols] of t.BUCKETS) {
  const chips = combo().slice(combo().indexOf(`>${label}<`));
  const first = chips.slice(chips.indexOf('<button'), chips.indexOf('</button>'));
  const fits = t.namesFit(cols, len), counted = t.countsFit(cols, len);
  assert.strictEqual(/text-left/.test(first), fits,
    `${label}: ${fits ? 'has room for a name and drops it' : 'shows a name it has no room for'}`);
  // the count is cheaper than the name, so it survives one step longer
  assert.strictEqual(/tabular-nums/.test(first), counted,
    `${label}: ${counted ? 'has room for a count and drops it' : 'shows a count it has no room for'}`);
  assert.ok(!fits || counted, `${label}: shows a name but not the count`);
  // whichever half is dropped, the hover still carries both
  assert.ok(/hintCombo\('[^']+ — \d+ cards'\)/.test(first), `${label}: dropped a label with no hover`);
}
// the rule, not the outcome: widen the column and the name comes back
assert.strictEqual([[1, 5], [1, 4]].every(a => t.namesFit(...a))
  && [[2, 3], [5, 2], [6, 1]].every(a => !t.namesFit(...a)), true,
  'the name cut-off no longer matches the drawn layout');
assert.ok(!t.namesFit(3, 3) && t.namesFit(1, 3), 'the cut-off does not respond to column count');
// the middle tier has to actually exist, or this is the same two-way switch
assert.ok(!t.namesFit(2, 3) && t.countsFit(2, 3), 'no bucket keeps the count after losing the name');
assert.ok(!t.countsFit(5, 2) && !t.countsFit(6, 1), 'a count is drawn where nothing fits');
// calibration: a three-mark chip in two columns measures 26px per flank in
// Chrome. If the model drifts from that, its constants have gone stale.
assert.strictEqual(t.nameRoom(2, 3), 26, 'the width model no longer matches what the browser lays out');

// name, then the marks, then the count — the marks are what the two flanking
// flex-1 columns centre, so neither of them may be shrink-fitted
const named = combo().slice(combo().indexOf('>All<'), combo().indexOf('>Dual<'));
const one = named.slice(named.indexOf('<button'), named.indexOf('</button>'));
assert.ok(one.indexOf('Five-colour') < one.indexOf('class="ms"'), 'the combo name is not first');
assert.ok(one.indexOf('class="ms"') < one.lastIndexOf('tabular-nums'), 'the count is not last');
assert.strictEqual((one.match(/flex-1/g) || []).length, 2, 'the marks are not centred between two equal columns');

// widest first: the combinations you are least likely to scroll for are the
// ones a five-colour deck is actually asking about
const buckets = [...combo().matchAll(/tracking-wide text-neutral-600">(All|Quad|Tri|Dual|Mono)</g)].map(m => m[1]);
assert.strictEqual(buckets.join(' '), 'All Quad Tri Dual Mono', 'the combo buckets are not widest-first');
// every button says what it is and how many, on the chip and on hover
// the hint is written with textContent, so it carries a real em dash, not an entity
assert.ok(!/hintCombo\('\s*—/.test(combo()), 'a hover hint has no name');
assert.strictEqual([...combo().matchAll(/onmouseenter="hintCombo\('[^']+ — \d+ cards'\)"/g)].length,
  6 + 32, 'not every colour and combination names itself on hover');

// --- every scope that filters keeps the whole anatomy -------------------
// (binders is not one: it was made by a filter, so it does not carry one)
for (const r of ['#/decks', '#/printings', '#/search']) {
  go(r);
  for (const f of ['Type', 'Subtype', 'Colour', 'Mana value', 'Power', 'Rarity', 'Legality', 'Keywords', 'Language'])
    assert.ok(painted.includes(f), `${r}: card anatomy missing "${f}"`);
  // no free-text box anywhere: every element is an enumerated value with a
  // count, because a typed string is a guess and a chip is a fact
  assert.ok(!/<input[^>]*type="text"|placeholder=/.test(painted), `${r}: a free-text search survived`);
}

// --- the anatomy comes from the game, not from the page ----------------
// this is the whole "ready for another TCG" claim — assert it, don't trust it
for (const [k, g] of Object.entries(t.GAMES)) {
  t.pickGame(k);
  setSort([{ f: 'colour', d: 'a' }, { f: 'rarity', d: 'd' }, { f: 'BREAK' }, { f: 'name', d: 'a' }]);
  t.P.view = 'grid';
  go('#/printings');
  // every labelled group renders; "combos" is the one that draws its own header
  for (const [, label] of g.anatomy)
    if (label) assert.ok(painted.includes(`>${label}<`), `${k}: anatomy missing "${label}"`);
  // the order is the order you narrow in: what a card is legal for, what it
  // costs, then what it is — the rest is book-keeping and collapses away
  const drawn = g.anatomy.map(x => x[0] === 'combos' ? 'Colour' : x[1]);
  const at = l => painted.indexOf(`>${l}<`);
  for (let i = 1; i < drawn.length; i++)
    assert.ok(at(drawn[i - 1]) < at(drawn[i]),
      `${k}: "${drawn[i]}" is not drawn after "${drawn[i - 1]}"`);
  if (k === 'mtg') assert.strictEqual(drawn.slice(0, 7).join(' > '),
    'Legality > Colour > Mana value > Type > Subtype > Keywords > Rarity',
    'the main filter order changed');
  // rarely-browsed groups collapse into "Other" — FilterSidebar's own order
  const rare = g.anatomy.filter(x => (x[3] || {}).other);
  assert.ok(rare.length, `${k}: nothing is filed under Other`);
  assert.ok(painted.includes('>Other</summary>'), `${k}: no collapsible Other group`);
  const otherAt = painted.indexOf('>Other</summary>');
  for (const [, label] of rare)
    assert.ok(painted.indexOf(`>${label}<`) > otherAt, `${k}: "${label}" should be under Other`);
  for (const f of g.sort) {
    const lbl = { hp: 'HP', cmc: 'CMC' }[f] || f;
    assert.ok(painted.includes(`>${lbl}</button>`) || painted.includes(`>${lbl}</span>`),
      `${k}: sort field "${f}" is not offered`);
  }
  assert.ok(!painted.includes('>Hp<'), `${k}: "capitalize" mangled an acronym`);
  // language is rarely narrowed, so it lives under Other for both games
  assert.ok(rare.some(x => x[1] === 'Language'), `${k}: Language is not filed under Other`);
  // filters fill the sidebar: every chip group is a grid, never ragged wrapping
  const grids = g.anatomy.filter(x => x[0] === 'chips').length;
  assert.strictEqual((painted.match(/grid gap-1\.5 grid-cols-/g) || []).length, grids,
    `${k}: a chip group is not laid out as a full-width grid`);
  assert.ok(!painted.includes('flex flex-wrap gap-1.5'), `${k}: a filter still wraps instead of filling`);
  // the "all" scope's headline count is the game's own, not a constant
  go('#/search');
  assert.ok(painted.includes(`${g.total}</span>`), `${k}: "all" scope does not use the game's own total`);
}
// MTG's mana/colour must not survive into Pokémon, and vice versa
t.pickGame('pokemon'); go('#/printings');
for (const mtgOnly of ['Mana value', 'Planeswalker', 'Mythic'])
  assert.ok(!painted.includes(mtgOnly), `pokemon: leaked MTG anatomy "${mtgOnly}"`);
assert.ok(painted.includes('Retreat cost') && painted.includes('Holo Rare'), 'pokemon: missing its own anatomy');
t.pickGame('mtg');
for (const pkmOnly of ['Retreat cost', 'Holo Rare', 'Lightning']) {
  go('#/printings');
  assert.ok(!painted.includes(pkmOnly), `mtg: leaked Pokémon anatomy "${pkmOnly}"`);
}
setSort([{ f: 'colour', d: 'a' }, { f: 'rarity', d: 'd' }, { f: 'BREAK' }, { f: 'name', d: 'a' }]);
t.P.view = 'grid';

// --- three rows: header, subheader, one scrolling pane ------------------
const at = n => painted.indexOf(`>${n}</span>`);
for (const r of ['#/printings', '#/binders', '#/decks', '#/search']) {
  go(r);
  // the subheader spans the window like the top bar does: it's a sibling of
  // <header> and <main>, not something indented inside the page
  const sub = header2(painted);
  assert.ok(sub.includes('border-b border-neutral-800'), `${r}: subheader is not a full-width bar`);
  // it has to stay one line tall — name + numbers + Export + Clear wrapped once
  assert.ok(sub.includes('flex-nowrap'), `${r}: subheader is allowed to wrap onto two lines`);
  assert.ok(painted.indexOf('<main') > painted.indexOf('</header>'), `${r}: no scrolling pane after the bars`);
  // exactly one scrollbar, and it belongs to <main>
  assert.strictEqual((painted.match(/min-h-0 flex-1 overflow-y-auto/g) || []).length, 1,
    `${r}: more than one scrolling pane`);
  // fixed order inside the pane
  if (FILTERED(r)) {
    assert.ok(at('filter') > 0 && at('filter') < at('sort'), `${r}: filter is not before sort`);
    assert.ok(painted.indexOf('<main') < at('filter'), `${r}: the filter escaped the scrolling pane`);
  }
  assert.ok(at('sort') < at('view'), `${r}: sort is not before view`);
}
// the scope no longer lives in the sidebar at all — the subheader replaced it
go('#/search');
assert.strictEqual((painted.slice(painted.indexOf('<main')).match(/>scope</gi) || []).length, 0,
  'the sidebar still has a scope band — the subheader replaced it');

// --- the page's headline number lives in the top bar, not above the body -
// match the Stats container itself, not its words — "cards in Magic" also shows
// up legitimately in the filter band's scope note
const STATS_CLASS = 'ml-auto flex shrink-0 items-center gap-4';
for (const k of Object.keys(t.P.pick)) t.P.pick[k] = null;   // earlier blocks left selections
// nothing selected: the tab's own totals
for (const [route, stat] of [['#/search', 'cards in Magic'], ['#/printings', 'collected'],
                             ['#/binders', 'binders'], ['#/decks', 'decks'], ['#/io', 'unresolved']]) {
  ctx.location.hash = route; t.render();
  assert.ok(header(painted).includes(stat), `${route}: "${stat}" is not in the top bar`);
  assert.strictEqual((painted.match(new RegExp(STATS_CLASS, 'g')) || []).length, 1,
    `${route}: the stats block is rendered more than once`);
  assert.ok(!painted.slice(painted.indexOf('</header>')).includes(STATS_CLASS),
    `${route}: stats are back above the content`);
}
// selected: that thing's own numbers, still in the top bar
for (const [route, stat] of [['#/printings', 'collected'], ['#/binders', 'pages'], ['#/decks', '23 distinct']]) {
  go(route);
  assert.ok(header(painted).includes(stat), `${route}: stats did not follow the selection`);
  t.clearItem();
}
/* A binder stating "3016 cards &middot; 336 pages" over a view drawing 18 cards
   on 2 pages is the whole reason those numbers are no longer written down. The
   subheader is now a claim the layout has to honour. */
for (const [name] of t.LISTS.binders) {
  go('#/binders'); t.selectItem(name); t.setView('binder'); t.render();
  const said = /([\d,]+)<\/span> cards[\s\S]{0,120}?>(\d+)<\/span> pages?/.exec(header(painted));
  assert.ok(said, `${name}: the binder does not state its cards and pages`);
  const drawn = (painted.match(/>Page \d+</g) || []).length;
  const pockets = (painted.match(/aspect-\[5\/7\]/g) || []).length;
  assert.strictEqual(+said[2], drawn, `${name}: says ${said[2]} pages, draws ${drawn}`);
  assert.strictEqual(said[1].replace(/,/g, ''), String(t.scopedCards().length),
    `${name}: says ${said[1]} cards, holds ${t.scopedCards().length}`);
  assert.ok(pockets >= t.CARDS().length, `${name}: pockets do not hold the cards it drew`);
  // a binder that holds more than the view can draw has to say so
  assert.strictEqual(/of the first/.test(header(painted)), t.scopedCards().length > t.CARDS().length,
    `${name}: the render cap is stated when it does not apply, or hidden when it does`);
  t.clearItem();
}
// Config is reachable from every page and Kit from Config
go('#/config');
assert.ok(painted.includes('href="#/kit"'), 'the control kit is not reachable from Config');

// --- the display type lives on the sort bar, and only there -------------
go('#/printings');
const sortBarNow = () => painted.slice(painted.indexOf('>sort<'), painted.indexOf('>view<'));
const sortBar = sortBarNow();
for (const v of ['grid', 'compact', 'details', 'binder'])
  assert.ok(sortBar.includes(`setView('${v}')`), `sort bar is missing the "${v}" display type`);
// the order is a list you rearrange, not one you rebuild
const order = () => sortBarNow().slice(sortBarNow().indexOf('>Order<'));
assert.ok(!/border-dashed/.test(order()), 'an order chip is still dashed');
// every chip is the same shape in or out of the order, so clicking one does
// not shove the row sideways
setSort([{ f: 'name', d: 'a' }, { f: 'BREAK' }, { f: 'set', d: 'd' }]);
const slots = l => [...l.matchAll(/w-3 shrink-0 text-center/g)].length;
assert.strictEqual(slots(order()) % 2, 0, 'an order chip is missing its rank or direction slot');
// every field appears exactly once, staged or not, and each carries both slots
assert.strictEqual(slots(order()), 2 * t.GAMES.mtg.sort.length,
  'staged and unstaged chips are not the same shape');
// one control, three states — the same vocabulary as the include/exclude chips
setSort([]);
t.addSort('name');
assert.ok(/border-emerald-500[^"]*"[^>]*onclick="cycleSort\(0\)"|onclick="cycleSort\(0\)"[\s\S]{0,400}?/.test(order()),
  'a staged term has no cycle handler');
const chipOf = () => order().slice(order().indexOf('cycleSort(0)') - 300, order().indexOf('cycleSort(0)'));
assert.ok(/border-emerald-500/.test(chipOf()), 'ascending is not coloured like an include');
t.cycleSort(0);
assert.strictEqual(t.P.sortDraft[0].d, 'd', 'the second click did not reverse the term');
assert.ok(/border-rose-500/.test(chipOf()), 'descending is not coloured like an exclude');
t.cycleSort(0);
assert.strictEqual(t.P.sortDraft.length, 0, 'the third click did not take the term out of the order');
// colour is the only thing that changes — the chip must not resize as it cycles
t.addSort('name');
const wide = slots(order());
t.cycleSort(0);
assert.strictEqual(slots(order()), wide, 'reversing a term changed the chip shape');
setSort([{ f: 'name', d: 'a' }, { f: 'BREAK' }, { f: 'set', d: 'd' }]);

// drag reorders in place rather than dropping the term and losing the rest
assert.ok(/draggable="true"[^>]*ondragstart="dragSort\(0\)"/.test(order()), 'order chips are not draggable');
t.dragSort(2); t.moveSort(0);
assert.strictEqual(t.P.sortDraft.map(x => x.f).join(','), 'set,name,BREAK',
  'dragging a term did not move it');
assert.strictEqual(t.P.sortDraft.length, 3, 'dragging lost a term');
t.dragSort(0); t.moveSort(0);
assert.strictEqual(t.P.sortDraft.map(x => x.f).join(','), 'set,name,BREAK', 'a no-op drag changed the order');
setSort([]);

// display first, order second, and on one line
assert.ok(sortBar.indexOf('>Display<') < sortBar.indexOf('>Order<'), 'the display is not first');
assert.strictEqual([...sortBar.matchAll(/setView\('(\w+)'\)/g)].map(m => m[1]).join(','),
  'compact,details,grid,binder', 'the display order changed');
// a binder layout of a deck is not a thing, and neither is a deck layout of a set
go('#/decks');
const deckBar = painted.slice(painted.indexOf('>sort<'), painted.indexOf('>view<'));
assert.ok(deckBar.includes("setView('deck')") && !deckBar.includes("setView('binder')"),
  'the decks tab offers binder, or withholds deck');
go('#/printings');
const printBar = painted.slice(painted.indexOf('>sort<'), painted.indexOf('>view<'));
assert.ok(printBar.includes("setView('binder')") && !printBar.includes("setView('deck')"),
  'printings offers deck, or withholds binder');
// binders renders no chooser at all — its one layout is stated in the band note
go('#/binders');
assert.ok(!/setView\('\w+'\)/.test(painted), 'the binders tab still renders a display button');
assert.ok(/binder &mdash; the only layout here/.test(painted),
  'with no chooser, the binders view band does not say what it is drawing');
go('#/printings');
// one control, once — the results band must not re-offer it
assert.strictEqual(painted.match(/setView\('grid'\)/g).length, 1, 'display type is rendered twice');
// what a break means lives on each layout's own tooltip, not a paragraph
assert.ok(/title="break = a new row"[^>]*>\s*<span[^>]*>[^<]*<\/span>grid</.test(painted),
  'the grid layout does not say what a break means');

// --- BREAK: grouping is everything left of it, in every layout ---------
setSort([{ f: 'colour', d: 'a' }, { f: 'rarity', d: 'd' }, { f: 'BREAK' }, { f: 'name', d: 'a' }]);
// join rather than deepStrictEqual: arrays from the vm realm have a different prototype
assert.strictEqual(t.grouping().map(x => x.f).join(','), 'colour,rarity',
  'grouping is not the sort terms left of the break');
for (const [view, marker] of [['grid', 'Green'], ['compact', 'Green'], ['details', 'Green'], ['binder', 'Page 1'], ['deck', 'cards']]) {
  t.setView(view); go('#/printings');
  assert.ok(painted.includes(marker), `break not honoured in the ${view} layout (no "${marker}")`);
}
t.setView('grid');

// --- printings: indented, fixed order, no search over SETS -------------
// the card filter is fine and intended; the rule is that the SET LIST has no
// search and no sort — its order is fixed by block + release date
ctx.location.hash = '#/printings'; t.render(); t.clearItem();   // open, so the list shows
assert.ok(!painted.includes('<input'), 'the set list must not offer a search');
assert.ok(!painted.includes('placeholder='), 'nothing may offer a free-text search');
assert.ok(painted.includes('&#9492;'), 'printings has no sub-set indent marker');
assert.ok(painted.indexOf('2025-08-01') < painted.indexOf('2024-11-15'), 'printings is not newest-first');
assert.ok(!painted.includes('>sort</span>'), 'the set list must not offer a sort');
// pick one and the page below is the same page as everywhere else
t.selectItem('Foundations (FDN)');
for (const band of ['filter', 'sort', 'view'])
  assert.ok(at(band) > 0, `printings lost the ${band} band`);
t.clearItem();

// --- import/export: one map, both directions ---------------------------
go('#/io');
// names as Archidekt's own importer spells them — see docs/import-formats.md
for (const s of ['Moxfield', 'Deckbox', 'Dragonshield', 'ManaBox', 'Cardsphere', 'Delver Lens', 'Helvault', 'Archidekt', 'Collectr', 'Deckstats'])
  assert.ok(painted.includes(s), `import is missing the "${s}" source`);
// the language gap must stay visible until cards gains a lang column
assert.ok(painted.includes('NO COLUMN YET'), 'language gap is no longer flagged');
assert.ok(painted.includes('Resolve ambiguous'), 'no ambiguous-row resolver');
// the grouping step is a one-off, and says so
assert.ok(/one-off/.test(painted), 'the grouping step is not marked as a one-off');
assert.ok(/Binder[\s\S]{0,400}Box[\s\S]{0,400}Deck/.test(painted), 'grouping column cannot designate binder/box/deck');

// --- config: two columns, coherent groups, a source toggle that moves ---
go('#/config');
assert.ok(/xl:grid-cols-2/.test(painted), 'config is not two columns');
// data on the left, behaviour on the right — assert the order, not just presence
const bandAt = n => painted.indexOf(`>${n}</span>`);
const groups = ['sources', 'schema source map', 'cache', 'files',
                'games', 'identity', 'refresh', 'import / export map', 'defaults', 'debug'];
for (const g of groups) assert.ok(bandAt(g) > 0, `config lost the "${g}" group`);
for (let i = 1; i < groups.length; i++)
  assert.ok(bandAt(groups[i - 1]) < bandAt(groups[i]),
    `config group order broke: "${groups[i]}" precedes "${groups[i - 1]}"`);
// the source split the user called out: MTGJSON owns rows Scryfall doesn't
for (const s of ['AllPrintings', 'all_cards', 'mtg_card_printings', 'identifiers.scryfallId'])
  assert.ok(painted.includes(s), `schema source map is missing "${s}"`);
assert.ok(painted.includes('Download &amp; cache now'), 'no download-and-cache control');

/* Every source reads the same way or the row is not doing its job: each one
   names what it gives, offers BOTH sides, and prices both — a source that
   quietly drops the side it doesn't have is the drift this replaced. */
const srcBand = painted.slice(bandAt('sources'), bandAt('schema source map'));
assert.strictEqual(Object.keys(t.SOURCES).length, 8, 'the source list changed size — is the new one in Config?');
for (const [k, s] of Object.entries(t.SOURCES)) {
  const at = srcBand.indexOf(`>${s.name}<`);
  assert.ok(at > 0, `"${s.name}" is not in the sources band`);
  const row = srcBand.slice(at, at + 2600);
  assert.ok(row.includes(s.gives), `"${s.name}" does not say what it gives`);
  for (const side of ['Local', 'Online'])
    assert.ok(row.includes(`>${side}</span>`), `"${s.name}" is missing its ${side} chip`);
  assert.ok(s.online || s.why, `"${s.name}" has no online side and no reason given`);
  assert.ok(s.q.length && s.q.every(q => row.includes(`setQuality('${k}','${q[0]}')`)),
    `"${s.name}" offers no quality choice`);
}
// the side that doesn't exist says why, and can't be selected anyway
assert.ok(painted.includes('MTGJSON publishes files, not an API'), 'MTGJSON is offered a live mode it does not have');
t.setSrc('mtgjson', 'online');
assert.strictEqual(t.CFG.src.mtgjson.at, 'local', 'a source was switched to a side it does not have');

// flipping to online must actually change the page, and only the Scryfall-fed rows
go('#/config');
const bulk = painted;
assert.strictEqual(t.CFG.src.scryfall.at, 'local', 'default pull mode is not the cache');
t.setSrc('scryfall', 'online');
assert.notStrictEqual(painted, bulk, 'toggling Scryfall to live changed nothing');
assert.ok(painted.includes('/cards (live)'), 'live mode does not re-attribute the cards rows');
assert.ok(painted.includes('AllPrintings'), 'live mode wrongly dropped the MTGJSON rows');
assert.ok(/15 hours/.test(painted), 'live mode does not state its cost');
t.setSrc('scryfall', 'local');
assert.ok(!painted.includes('/cards (live)'), 'live attribution stuck after switching back');

/* The two image rows are not a mock: the size chip has to reach the URL, or
   Config is describing an app that isn't this one. */
const card = t.CARDS()[0];
assert.ok(t.artUrl(card).includes('/art_crop/'), 'the default card-art size is not the one Config shows');
t.setQuality('sfart', 'small');
assert.ok(t.artUrl(card).includes('/small/'), 'changing the card-art size does not change the request');
t.setQuality('sfart', 'png');
assert.ok(t.artUrl(card).endsWith('.png'), 'png is served as a jpg');
t.setQuality('sfart', 'art_crop');
assert.ok(t.packUrl(1).endsWith('_200w.jpg'), 'the default pack-art size is not the one Config shows');
t.setQuality('tcg', 'in_1000x1000');
assert.ok(t.packUrl(1).endsWith('_in_1000x1000.jpg'), 'changing the pack-art size does not change the request');
t.setQuality('tcg', '200w');

// --- every declared name is used; every name a handler calls exists --------
const declared = [...src.matchAll(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
for (const name of declared) {
  const uses = src.match(new RegExp(`\\b${name}\\b`, 'g')).length;
  assert.ok(uses > 1, `"${name}" is declared and never used — delete it`);
}
// inline onclick/onchange never run during render, so they rot silently
// `this` and `event` are implicit globals inside an inline handler; the rest
// are literals or property names the regex can pick up as bare identifiers
const KEYWORDS = new Set(['this', 'event', 'true', 'false', 'null', 'undefined',
  'new', 'typeof', 'return', 'checked', 'value', 'dataset']);
const handlers = new Set();
for (const r of t.ORDER) {
  ctx.location.hash = '#/' + r; t.render();
  for (const m of painted.matchAll(/\bon(?:click|change|input|submit|load|error)="([^"]*)"/g)) handlers.add(m[1]);
}
for (const h of handlers) {
  // blank out string literals first — "Eternities" inside 'Edge of Eternities (EOE)'
  // is not an identifier, and the lookbehind alone can't tell
  const code = h.replace(/'[^']*'|"[^"]*"/g, "''");
  for (const m of code.matchAll(/(?<![.\w$'"])([A-Za-z_$][\w$]*)\s*(?=[.(=[]|$)/g)) {
    const id = m[1];
    if (KEYWORDS.has(id)) continue;
    // `id in ctx` misses const/let — they live in the realm's global lexical
    // scope, not on the global object. Ask the realm itself.
    assert.notStrictEqual(vm.runInContext(`typeof ${id}`, ctx), 'undefined',
      `handler "${h}" calls "${id}", which is not defined`);
  }
}
console.log(`  ${String(declared.length).padStart(3)} declarations, all used · ${handlers.size} inline handlers, all resolve`);

console.log('\ngame gated on the main then locked. fresh page applies nothing.');
console.log('one page shape everywhere: selector -> filter -> sort -> view. break honoured in 5 layouts.');
console.log('selector collapses on pick, reopens on click, and forgets on navigation.');
console.log('config: 2 columns, 10 groups in order. 8 sources, each priced local and online,'
  + ' and the art sizes reach the URL.');

// --- drawing boosters ---------------------------------------------------
// A pack is a thing a SET prints, so the control exists on one set and nowhere
// else — not on a binder, a deck, a search, or an unpicked set list.
t.pickGame('mtg'); go('#/printings'); t.clearItem();
// the list now carries per-row Draft buttons, but the hovering trigger belongs
// to a picked set and must not be there while you're still choosing
assert.ok(!painted.includes('fixed bottom-6'), 'the set list offers the hovering draw before a set is picked');
const drawable = t.SETS.find(r => t.packsFor(r[0])?.length);
t.selectItem(drawable[0]); t.render();
assert.ok(painted.includes('>Boosters<'), `a picked set (${drawable[1]}) offers no draw`);
for (const r of ['#/binders', '#/decks', '#/search']) {
  go(r);
  const list = t.LISTS[r.slice(2)];
  if (list) { t.selectItem(list[0][0]); t.render(); }
  assert.ok(!painted.includes('>Boosters<'), `${r} offers a pack it cannot print`);
}
// a set with no print run of its own has no collation, which is most of them
const none = t.SETS.filter(r => !t.packsFor(r[0])?.length).length;
assert.ok(none > t.SETS.length / 2, 'every set claims to print boosters');
assert.strictEqual(t.packsFor('nonesuch'), null, 'an unknown set claims to print boosters');
/* Three answers, not two. Size and symbol decide nothing: what decides it is
   Scryfall's set_type (is this a thing you open) and MTGJSON's set.booster (has
   anyone worked out how it's collated). A set can be the first and not the
   second, which is what TRK is. */
const byType = {};
for (const r of t.SETS) { const v = byType[r[6]] ??= [0, 0]; v[0]++; if (r[7]) v[1]++; }
assert.ok(byType.token[1] === 0 && byType.expansion[1] / byType.expansion[0] > 0.9,
  'set_type does not separate the sets you can open from the ones you cannot');
const trk = t.SETS.find(r => r[1] === 'TRK');
assert.ok(trk[6] === 'expansion' && !trk[7], 'TRK is no longer the un-collated expansion this tests');
assert.deepStrictEqual(t.packsFor(trk[0]).length, 0, 'a draftable set with no collation is treated as undraftable');
go('#/printings'); t.selectItem(trk[0]); t.render();
assert.ok(painted.includes('no pack data yet') && painted.includes('disabled'),
  'an un-collated set does not say why its button is dead');
assert.ok(!painted.includes('onclick="askDraw()"'), 'an un-collated set can still be drafted');
const tokenSet = t.SETS.find(r => r[6] === 'token');
assert.strictEqual(t.packsFor(tokenSet[0]), null, 'a token set offers a booster');

/* The collation itself. Which booster a set is drafted with is read from
   MTGJSON's set.booster, not inferred from the release date — the published
   Play Booster changeover is 2024-04-19 but MKM shipped `play` on 2024-02-09,
   which is precisely the case a date rule gets wrong. */
const B = t.BOOSTER;
assert.ok(B && typeof B === 'object' && Object.keys(B).length > 100,
  'BOOSTER is missing or too small to be the real collation');
for (const [code, v] of Object.entries(B)) {
  assert.ok(Array.isArray(v) && v.length === 3, `BOOSTER.${code} is not [kind, cards, rarest]`);
  const [kind, cards, rarest] = v;
  assert.ok(['play', 'draft', 'default'].includes(kind), `BOOSTER.${code} is drafted with "${kind}"`);
  assert.ok(Number.isInteger(cards) && cards > 0, `BOOSTER.${code} has ${cards} cards on its sheets`);
  // 1 is legitimate: a fixed pack like Signature Spellbook holds every card it lists
  assert.ok(Number.isInteger(rarest) && rarest >= 1, `BOOSTER.${code} rarest card is 1 in ${rarest}`);
}
const mkm = B.MKM, mh3 = B.MH3, lci = B.LCI;
assert.ok(mkm && mkm[0] === 'play', 'MKM is not read as a Play Booster set — the date rule is back');
assert.ok(t.SETS.find(r => r[1] === 'MKM')[2] < '2024-04-19',
  'MKM no longer predates the published Play Booster changeover, so it stops testing this');
assert.ok(mh3[0] === 'play' && lci[0] === 'draft', 'the play/draft split is wrong at MH3/LCI');
// the sets that predate the play/draft vocabulary carry an unnamed `default`
// config; reading only play/draft dropped 21 of them, Ice Age included
assert.ok(B.ICE?.[0] === 'default' && B['4ED']?.[0] === 'default',
  'the pre-vocabulary sets lost their booster again');
assert.strictEqual(t.packsFor('Ice Age')[0], 'default', 'Ice Age cannot be drafted');
assert.ok(!B.JMP, 'Jumpstart is being treated as a draft booster');
// joined, not deepStrictEqual: an array built inside the vm has that realm's
// Array prototype, which a strict deep-equal counts as a difference
assert.strictEqual(t.packsFor('Murders at Karlov Manor').join(' '), 'play collector',
  'MKM does not draw its Play Boosters');
assert.strictEqual(t.packsFor('The Lost Caverns of Ixalan')[0], 'draft',
  'a pre-changeover set does not draw its Draft Booster first');
/* Which OTHER boosters a set prints is read from the generated index, not
   assumed from the era: 49 of the 179 drafted sets have a Collector Booster and
   they are not the play-era ones — Lost Caverns of Ixalan is a draft-era set
   with one. The drafted kind always leads, because that is what a draft uses. */
for (const [name, code] of [['Murders at Karlov Manor', 'MKM'], ['The Lost Caverns of Ixalan', 'LCI'],
                            ['Ice Age', 'ICE'], ['Modern Horizons 3', 'MH3']]) {
  const got = t.packsFor(name);
  assert.strictEqual(got[0], B[code][0], `${code}: the drafted booster does not lead`);
  assert.strictEqual([...got].sort().join(' '), [...packIndex[code]].sort().join(' '),
    `${code}: the boosters offered are not the ones the collation has`);
}
// a set whose collation is real but holds no draft/play config is not draftable
const undraftable = t.SETS.find(r => r[7] && !B[r[1]] && !r[5] && t.DRAFTABLE?.has?.(r[6]));
if (undraftable) assert.deepStrictEqual(t.packsFor(undraftable[0]).length, 0,
  'a set collated only into non-draft products still offers a draft');
// the note that carries the numbers, since they get no column of their own
/* The catalogue. check.mjs renders with no network, so what runs here is the
   fallback path — which is exactly the property worth pinning: the page has to
   work before 5 MB arrives, and gets no fetch at all in the harness. */
assert.ok(t.CARDS().length && t.CARDS().length <= t.CARD_LIMIT,
  'the render slice is empty or ignores its own cap');
assert.strictEqual(t.ALL().length, t.CARDS().length,
  'the mock fallback is being capped, so the harness is not seeing every mock');
assert.ok(t.openedCard()?.n, 'no card opens without a catalogue');
// the shape the generator writes must be the shape MockCard reads
const built = t.materialise({
  o: [['Llanowar Elves', '{G}', 'Creature — Elf Druid', '{T}: Add {G}.', '1/1', 'G', 1]],
  p: [[0, 'DMU', '168', 1, 'abc-1', 0.25]],
});
assert.strictEqual(built.length, 1, 'a printing did not materialise');
const built1 = built[0];
assert.strictEqual(built1.n, 'Llanowar Elves', 'the oracle name did not reach the card');
assert.strictEqual(built1.set, 'DMU', 'the printing set did not reach the card');
assert.deepStrictEqual([...built1.cost], ['G'], 'the mana cost did not become pip tokens');
assert.ok(built1.text.includes('Add {G}'), 'the rules text did not reach the card');
assert.strictEqual(built1.qty, 0, 'a catalogue card arrives already owned');
// every field MockCard reads has to survive the round trip, or a card renders blank
for (const k of ['n', 'set', 'num', 'rar', 'art_id', 'usd', 'col', 'type', 'text', 'pt', 'cost'])
  assert.ok(k in built1, `materialise drops ${k}, which MockCard reads`);
assert.ok(t.MockCard(built1).includes('Llanowar Elves'), 'a materialised card does not render');
// the token parser is the one piece of real parsing in the path
assert.deepStrictEqual([...t.costTokens('{2}{W/U}{X}')], ['2', 'W/U', 'X'], 'mana cost tokens are wrong');
assert.deepStrictEqual([...t.costTokens('')], [], 'an empty cost is not empty');

/* Picking a set has to show THAT set. Showing the first N of the catalogue is
   worse than showing mocks, because the cards are real and so read as the set's
   own — which is exactly what shipped and had to be fixed. Seeded rather than
   fetched: the harness has no network, and the mock fallback is a fixed sample
   that is deliberately never filtered, so only a real catalogue tests this. */
const twoSets = t.SETS.filter(r => !r[5]).slice(0, 2);
await t.loadCards({
  o: [['Alpha Card', '{G}', 'Creature — Elf', 'One.', '1/1', 'G', 1],
      ['Beta Card', '{U}', 'Instant', 'Two.', '', 'U', 1]],
  p: [
    [0, twoSets[0][1], '1', 1, 'a-1', 0.1],
    [0, twoSets[0][1], '2', 2, 'a-2', 0.2],
    [1, twoSets[1][1], '1', 3, 'b-1', 0.3],
  ],
});
assert.strictEqual(t.ALL().length, 3, 'the seeded catalogue did not load');
go('#/printings'); t.selectItem(`${twoSets[0][0]} (${twoSets[0][1]})`); t.render();
assert.ok(t.CARDS().length === 2 && t.CARDS().every(c => c.set === twoSets[0][1]),
  `picking ${twoSets[0][1]} shows cards from other sets`);
t.selectItem(`${twoSets[1][0]} (${twoSets[1][1]})`); t.render();
assert.ok(t.CARDS().length === 1 && t.CARDS()[0].set === twoSets[1][1],
  `picking ${twoSets[1][1]} shows cards from other sets`);
t.clearItem(); t.render();
assert.strictEqual(t.CARDS().length, 3, 'clearing the set does not go back to every card');
// with no binder picked there is nothing to be a member OF, so it stays on the mocks
go('#/binders'); t.clearItem(); t.render();
assert.ok(t.CARDS().every(c => !['a-1', 'a-2', 'b-1'].includes(c.art_id)),
  'an unpicked binder is claiming catalogue cards as its contents');

/* Every binder drawing the same cards was the whole complaint. A binder holds
   what its rule says it holds, the rules do not overlap, and Unsorted is the
   remainder — so the four binders partition the catalogue between them. */
await t.loadCards({
  o: [['Noble Hierarch', '{G}', 'Creature — Human Druid', '', '0/1', 'G', 1],
      ['Misty Rainforest', '', 'Land', '', '', '', 0],
      ['Sol Ring', '{1}', 'Artifact', '', '', '', 1],
      ['Some Other Card', '{R}', 'Instant', '', '', 'R', 1]],
  p: [[0, 'CON', '71', 3, 'alara', 42], [1, 'ZEN', '225', 3, 'dual', 60],
      [2, 'C21', '263', 2, 'staple', 2], [3, 'MKM', '99', 1, 'other', 0.1]],
});
const holds = {};
for (const [name] of t.LISTS.binders) {
  t.selectItem(name); t.render();
  holds[name] = t.CARDS().map(c => c.art_id).sort().join();
}
assert.strictEqual(holds['Alara block'], 'alara', 'the Alara binder does not hold the Alara card');
assert.strictEqual(holds['Duals &amp; fetches'], 'dual', 'the fetchland binder does not hold the fetchland');
assert.strictEqual(holds['Commander staples'], 'staple', 'the staples binder does not hold Sol Ring');
assert.strictEqual(holds['Unsorted'], 'other', 'Unsorted is not the remainder');
assert.strictEqual(new Set(Object.values(holds)).size, 4, 'two binders hold the same cards');
t.clearItem();

const note = t.collationNote('Modern Horizons 3');
assert.ok(/Play Booster/.test(note) && /\d+ cards on the sheets/.test(note) && /rarest 1 in \d+ packs/.test(note),
  `collationNote does not carry the collation: ${note}`);
assert.strictEqual(t.collationNote('nonesuch'), '', 'an unknown set claims a collation');
go('#/printings'); t.selectItem(tokenSet[0]); t.render();
assert.ok(!painted.includes('Boosters'), 'a token set draws the button anyway');

// every draw below deals from the real collation, so the set's sheets and a
// catalogue covering them are seeded first
const sheetKeys = seedCollation(drawable[1]);
go('#/printings'); t.selectItem(drawable[0]); t.render();
// the trigger hovers over the set and asks before it does anything
assert.ok(/fixed bottom-6[^>]*right-6[^>]*>Boosters</.test(painted), 'the trigger is not a hovering button');
assert.ok(!painted.includes('booster 1 of'), 'clicking nothing already opened a pack');
/* The question is step one of a PAGE of its own: it names the three things you
   can be opening boosters for and how many each takes, and nothing else — no
   filter rail, no nav, nothing behind it to click by mistake. The page you came
   from is restored on the way out rather than sat under it the whole time. */
t.askDraw(drawable[0]);
assert.ok(painted.includes('What are you opening them for?'), 'the trigger does not ask what for');
assert.ok(!painted.includes('How many'), 'the pack count is still a question — it is a rule of the format');
assert.ok(!painted.includes('>filter</span>'), 'the set page is still live under the question');
assert.ok(t.ORDER.includes('draw'), '#/draw is not a route');
t.cancelDraw();
assert.ok(!painted.includes('What are you opening them for?'), 'Cancel left the question up');
assert.ok(painted.includes('>filter</span>'), 'Cancel did not give the set page back');

/* THREE modes, and the count is the format's, not yours. A Booster Draft is 3
   boosters per player; Sealed Deck is 6. The app asked "how many" and defaulted
   to 6 for both, so a draft was a sealed pool half the time. A pull is neither
   and has no number at all. */
assert.strictEqual(t.MODES.map(m => `${m[0]}:${m[3]}`).join(), 'robin:3,complete:6,pull:1',
  'the pack counts are not the formats own');
for (const [m, n] of [['robin', 3], ['complete', 6]]) {
  t.askDraw(drawable[0]); t.setPackMode(m); t.nextPack();
  assert.strictEqual(t.P.draw.n, n, `${m} drew ${t.P.draw.n} boosters, not ${n}`);
  t.closeDraw();
}
/* Draft and sealed are played with the booster the SET IS DRAFTED WITH, which
   BOOSTER already reports; only a pull may reach for a Collector Booster,
   because nobody drafts with those. */
const both = t.SETS.find(r => (t.packsFor(`${r[0]} (${r[1]})`) || []).length > 1);
assert.ok(both, 'no set prints more than one booster, so the restriction is untestable');
for (const m of ['robin', 'complete'])
  assert.deepStrictEqual(t.packsForMode(both[0], m).join(), 'play',
    `${m} is offered a booster the set is not drafted with`);
assert.ok(t.packsForMode(both[0], 'pull').includes('collector'),
  'a pull cannot open a Collector Booster');

// a pull has no length: you open one, then another, for as long as you like
t.askDraw(drawable[0]); t.setPackMode('pull'); t.nextPack();
assert.strictEqual(t.P.draw.n, 1, 'a pull started with more than one booster open');
assert.ok(painted.includes('booster 1<') && !painted.includes('booster 1 of'),
  'a pull counts down to a total it does not have');
t.nextPack();
assert.strictEqual(t.P.draw.n, 2, 'opening another pull booster did not lengthen it');
assert.ok(painted.includes('booster 2<'), 'the pull did not move on');
t.closeDraw();

t.askDraw(drawable[0]); t.setPackMode('complete'); t.nextPack();
assert.strictEqual(ctx.location.hash, '#/draw', 'opening the boosters left the draw page');
assert.ok(painted.includes('>Download</button>') && painted.includes('>CSV<'),
  'the drawn pool has no export options');
assert.ok(painted.includes(drawable[0]), 'the page does not name the set it came from');
t.closeDraw();
assert.strictEqual(ctx.location.hash, '#/printings', 'closing the draw did not put you back');
assert.ok(painted.includes('>filter</span>') && !painted.includes('booster 1 of'),
  'closing the draw did not give the page back');

t.askDraw(drawable[0]); t.setPackMode('complete'); t.nextPack();
// the same seed is the same pack, every render — a pack that reshuffles under
// the cursor is a slot machine, and render() fires on every click
const first = t.drawn().map(c => c.n + c.slot).join('|');
t.render(); t.render();
assert.strictEqual(t.drawn().map(c => c.n + c.slot).join('|'), first, 'the pack reshuffled on re-render');
t.reDraw();
assert.notStrictEqual(t.drawn().map(c => c.n + c.slot).join('|'), first, 'Draw again gave the same pack');
// worst first, so the rare is the last card you turn over
const pack = t.drawn();
assert.ok(pack.every((c, i) => !i || pack[i - 1].rar <= c.rar), 'the pack is not revealed worst-first');
assert.ok(pack.length >= 14 && pack.length <= 15, `a play booster of ${pack.length} cards`);
// the pack is the SET's, not the fixtures': a Star Trek booster full of Conflux
// collector numbers is the one thing a booster cannot be
const code = t.SETS.find(r => r[0] === t.P.draw.set)[1];
/* Every card in the pack is a printing the SHEETS named — which is a stronger
   claim than "from this set", and a different one: the List and Special Guest
   slots deal cards from other sets entirely. What must never happen is a card
   the collation did not put there, which is what the old tier table did on
   every slot. */
for (const c of pack)
  assert.ok(sheetKeys.has(`${c.set}:${c.num}`), `${c.n} (${c.set} ${c.num}) is on no sheet of this booster`);
assert.ok(pack.some(c => c.set === code), 'no card in the pack is from the set it was opened from');
assert.ok(pack.every(c => c.num), 'a drawn card has no collector number');
// nothing is face-up until you turn it over, and you turn over the one you
// reached for — not whichever is next in line
assert.strictEqual((painted.match(/repeating-linear-gradient/g) || []).length, pack.length,
  'the pack does not start face down');
t.revealAt(pack.length - 1);
assert.strictEqual((painted.match(/repeating-linear-gradient/g) || []).length, pack.length - 1,
  'clicking a card turned over a different number of cards');
assert.ok(painted.includes(pack[pack.length - 1].n), 'the card clicked is not the card revealed');
/* TWO ROWS, running left to right — a booster you are opening rather than a
   list of cards. The rows are the height of the window and the columns hug the
   card, so a 14-card pack and a 15-card pack are the same size of card and the
   longer one simply reaches further right. Nothing counts the pack. */
// scoped to the draw. Anchored on the shell's own hook rather than on whatever
// layout classes it happens to wear this week — those have now changed three
// times and taken this line with them each time.
const win = () => painted.slice(painted.indexOf('data-draw'));
assert.ok(win().includes('grid-rows-2') && win().includes('grid-flow-col'),
  'the booster is not two rows running left to right');
assert.ok(win().includes('overflow-x-auto') && win().includes('auto-cols-min'),
  'the booster does not scroll sideways with columns sized to the card');
assert.ok(!/grid-template-columns:repeat\(\d+,minmax\(0,1fr\)\)/.test(win()),
  'the booster still lays itself out from a card count');
// the slot names give the card away before you turn it over
for (const slot of ['Rare / mythic', 'Wildcard', 'The List'])
  assert.ok(!painted.includes(`>${slot}<`), `the pack labels a face-down card "${slot}"`);
// turning cards over one at a time still walks booster by booster
t.revealAt(0); t.nextPack();
assert.ok(painted.includes('booster 2 of'), 'the draw did not move on to the next booster');
/* Reveal all skips the FILLER, not the ceremony: commons and uncommons turn
   themselves over, rares and mythics stay face down at the top of the draw, and
   anything already revealed stays revealed whatever its rarity. */
const wasUp = t.drawn()[0];
t.revealAt(0);
t.reveal();
const combined = t.allDrawn();
assert.strictEqual(combined.length, t.P.draw.n * pack.length, 'the combined pool is not every pack');
assert.ok(combined.every((c, i) => !i || combined[i - 1].rar >= c.rar), 'the pool is not sorted mythic-first');
const up = new Set(t.P.draw.shownAll);
assert.ok(combined.every(c => c.rar > 2 || up.has(c.id)), 'Reveal all left a common or uncommon face down');
assert.ok(combined.some(c => c.rar > 2 && !up.has(c.id)), 'Reveal all turned the rares over too');
assert.ok(combined.filter(c => up.has(c.id)).some(c => c.n === wasUp.n),
  'a card revealed before Reveal all was turned back over');
// the rares are at the top of the LIST, which the mythic-first sort guarantees
const firstUp = combined.findIndex(c => up.has(c.id));
assert.ok(combined.slice(0, firstUp).every(c => c.rar > 2), 'the face-down cards are not at the top');
/* ...and at the END of the GRID, which runs the other way on purpose. A pool
   reads as a list with the best at the top; a deal wants the opposite, so the
   card you were waiting for is the one still in the air when the rest is down.
   Both orders are real and they are reverses of each other — pinned here
   because reversing only one of them would have the sweep run backwards. */
const shown = [...win().matchAll(/data-card-id="([^"]+)"/g)].map(m => m[1]);
const byId = new Map(combined.map(c => [c.id, c]));
assert.strictEqual(shown.length, combined.length, 'the grid did not paint every card');
assert.ok(shown.every(id => byId.has(id)), 'the grid painted a card the draw does not hold');
assert.ok(shown.every((id, i) => !i || byId.get(shown[i - 1]).rar <= byId.get(id).rar),
  'the grid is not commons-first');
const top = Math.max(...combined.map(c => c.rar));
assert.strictEqual(byId.get(shown[shown.length - 1]).rar, top,
  'the last card dealt is not one of the rarest');
// Open all is the same two rows, just longer: six boosters of cards reaching
// further right, at the size the window allows
assert.ok(win().includes('overflow-x-auto') && win().includes('grid-rows-2'),
  'the combined draw is not the same two-row strip as a booster');
assert.ok(painted.includes('still face down'), 'the draw does not say how many are left');
// turning one over leaves the rest alone
const shut = combined.find(c => !up.has(c.id));
t.revealOne(shut.id);
assert.ok(t.P.draw.shownAll.includes(shut.id), 'turning a card over in the combined view did nothing');
assert.strictEqual(t.P.draw.shownAll.length, up.size + 1, 'turning one card over turned others too');
// a pack is generated whole from its seed when it is drawn, so revealing cannot
// change what is in it — the cards already turned over stay exactly as they were
assert.ok(pack.every(c => combined.some(x => x.n === c.n && x.num === c.num)),
  'revealing everything changed what was already face up');
/* The two buttons that are NOT there any more, pinned as absences because both
   were doing something worse than nothing. `Booster by booster` offered a view
   that was already the default and threw the draw back to pack one on the way;
   `Next booster` made opening the second pack a different gesture from opening
   the first, which the sidebar's fan now does with the same click as the rest. */
assert.ok(!painted.includes('Booster by booster'), 'the combined view still offers the reset');
assert.ok(!painted.includes('Next booster'), 'a Next booster button is still painted');
/* And Keep is DEAD until the draw is finished. Half a sealed pool kept at booster
   three is six packs you never looked at, so the button offering it is offering a
   mistake — it is disabled, and says how many are left. */
assert.ok(painted.includes('Keep as deck'), 'the draw offers no way to keep it');
assert.ok(painted.includes('disabled'), 'Keep as deck is live before every card is seen');
t.revealSequentialSync ? 0 : 0;
for (const c of t.allDrawn()) t.revealOne(c.id);
assert.ok(!painted.includes('disabled'), 'Keep as deck stayed dead after every card was turned over');
// Discard goes back to the question, not out of the window
t.discardDraw();
assert.ok(t.P.ask && !t.P.draw && t.P.ask.mode === null,
  'Discard did not go back to the draft chooser');
assert.ok(painted.includes('What are you opening them for?'), 'Discard did not repaint the chooser');
t.askDraw(`${drawable[0]} (${drawable[1]})`); t.setPackMode('complete'); t.nextPack();
/* THE COLLATION ITSELF. The recipes and sheets are generated out of MTGJSON by
   gen-boosters.mjs and read here off disk — the hand-written rarity-tier table
   that used to stand in index.html was a plausible imitation of a booster, and
   the difference is checkable: a pack adds up, every sheet a recipe names
   exists, and the weights reproduce the published rate. */
{
  const kinds = JSON.parse(readFileSync(`boosters/${drawable[1]}.json`, 'utf8')).kinds;
  for (const [kind, cfg] of Object.entries(kinds)) {
    assert.ok(cfg.total > 0, `${kind}: the recipes carry no weight`);
    assert.strictEqual(cfg.recipes.reduce((t2, [w]) => t2 + w, 0), cfg.total,
      `${kind}: the recipe weights do not add up to the stated total`);
    for (const [w, contents] of cfg.recipes) {
      const n = Object.values(contents).reduce((a2, b2) => a2 + b2, 0);
      assert.ok(w > 0, `${kind}: a recipe with no weight`);
      assert.ok(n >= 12 && n <= 20, `${kind}: a ${n}-card pack`);
      for (const sheet of Object.keys(contents))
        assert.ok(cfg.sheets[sheet], `${kind}: recipe names sheet "${sheet}", which has no cards`);
    }
    for (const [name, sh] of Object.entries(cfg.sheets)) {
      assert.ok(sh.total > 0, `${kind}/${name}: a sheet with no weight`);
      assert.strictEqual(Object.values(sh.cards).reduce((a2, b2) => a2 + b2, 0), sh.total,
        `${kind}/${name}: the card weights do not add up to the sheet total`);
      assert.ok(Object.keys(sh.cards).every(k => /^[A-Z0-9_]{2,8}:.+$/.test(k)),
        `${kind}/${name}: a card is not named as SET:number`);
    }
  }
  /* The rate the sheets produce is the rate sets.js publishes. Both are derived
     from the same file by different code, so agreeing is the check: Ice Age
     comes out 1 in 121, which is its 121 rares at one rare a pack. */
  for (const code of ['ICE', 'MH3', 'MKM']) {
    const cfg = JSON.parse(readFileSync(`boosters/${code}.json`, 'utf8')).kinds[t.BOOSTER[code][0]];
    const rate = new Map();
    for (const [w, contents] of cfg.recipes) {
      const p = w / cfg.total;
      for (const [name, n] of Object.entries(contents)) {
        const sh = cfg.sheets[name];
        for (const [key, cw] of Object.entries(sh.cards))
          rate.set(key, (rate.get(key) || 0) + (p * n * cw) / sh.total);
      }
    }
    assert.strictEqual(rate.size, t.BOOSTER[code][1], `${code}: the sheets hold a different number of cards than sets.js counted`);
    assert.strictEqual(Math.round(1 / Math.min(...rate.values())), t.BOOSTER[code][2],
      `${code}: the sheets do not reproduce the published rarest-card rate`);
  }
}
t.closeDraw();

// --- art is hotlinked, and the frame survives without it -----------------
// The art crop is somebody else's server: the catalogue holds an id, never a
// file. A card with no id still draws — that's the resolver's whole case.
t.pickGame('mtg');
for (const c of t.CARDS()) {
  assert.ok(c.art_id, `${c.n} has no art id`);
  const one = t.MockCard(c);
  assert.ok(one.includes('art_crop/front/'), `${c.n}: the art window is not the Scryfall crop`);
  assert.ok(one.includes(`/${c.art_id[0]}/${c.art_id[1]}/${c.art_id}.jpg`), `${c.n}: malformed art url`);
  assert.ok(one.includes('loading="lazy"'), `${c.n}: eighty of these load at once, unlazily`);
}
t.pickGame('pokemon');
for (const c of t.CARDS())
  assert.ok(t.MockCard(c).includes('images.pokemontcg.io/'), `${c.n}: pokemon art is not hotlinked`);
// pokemontcg.io serves whole cards, so the window crops rather than fits
assert.ok(t.MockCard(t.CARDS()[0]).includes('object-[50%_22%]'), 'a whole pokemon card is squashed into the art window');
t.pickGame('mtg');
const noArt = t.MockCard({ n: 'Lighming Bolt' });
assert.ok(noArt.includes('no art loaded') && !noArt.includes('<img'),
  'a card with no art id tries to load one anyway');

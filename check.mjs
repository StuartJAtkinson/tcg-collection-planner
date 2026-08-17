// ponytail: the smallest thing that fails if the draft's rules break. Renders every
// route under a stubbed DOM and asserts the decisions we keep re-making, so they stop
// regressing silently. Run: node check.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';
const MONTHS_3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// The three plain scripts the page loads ahead of its own, in the same order the
// browser loads them: sets.js is generated data, trim.js and anatomy.js are the
// two things the generators read as well so they cannot drift from the page.
const page = readFileSync('index.html', 'utf8');   // the markup too: <body> carries the UI scale
const src = `${['sets.js', 'trim.js', 'anatomy.js'].map(f => readFileSync(f, 'utf8')).join('\n')}
${page.match(/<script>([\s\S]*)<\/script>/)[1]}`;
const js = src
  + '\nglobalThis.__t = { SETS, jsArg, gutterMid, PACK_TALL, ROW_PX, PACK_ART, PACK_SAT, packArt, packUrl, draftPack, SOURCES, setSrc, setQuality, artUrl, artCdn, artLocal, bytes, OFFLINE_MODES, goOffline, goOnline, offlineBytes, allLocal, onlineNow, canBeLocal, missingLocal, srcKeys, srcQualities, srcBytes, onDisk, Table, DisplayChip, GroupHead, CARD_VIEWS, UNALIGNED, unaligned, anatomyKey, setFact, AlignList, SIDED, PAIRED, LANDSCAPE, BANDED, OVERLAID, VIEWS, FORMATS, CARD_TYPES, RARITIES, FINISHES, RARITY_NAME, FINISH, aftermath, framable, anatomyClasses, anatomyKey, ANATOMY_SAMPLES, twoFaced, CARDS, MockCard, TitleRow, MANA, MTG, INK, pipOf, manaValue, frameOf, plateOf, scopedCards, LANGS, langFilter, langName, setLang, contrast, relLum, SURFACE, FRAME, lum, surfaceKey, mix, lum, ink, factsOf, setFace, packsFor, BOOSTER, collationNote, DRAFTABLE, ALL, materialise, facetCounts, filtered, toggleChip, chipState, setRange, applyFilter, clearFilter, filterDirty, filterOn, PAGE, costTokens, openedCard, loadCards, scopedCards, glyphOf, symbolise, nameFit, typeFit, textFit, fitLen, setCols, colsOf, binderDims, setBinderDim, setAcross, views, defaultView, sortCards, GROUPS, SORT_KEY, GROUP_LABEL, DEFAULT_SORT, mainType, MAIN_ORDER, groupable, roles, roleOf, roleCount, ROLE_MIN, fieldLabel, zoneWeight, legalSort, setIconUrl, RARITY_DOT, pipOf, askDraw, cancelDraw, draftSet, clearItem, PULL, revealOne, closeDraw, drawn, allDrawn, packAt, pool, setPackMode, discardDraw, pickCard, keepDraw, MODES, packsForMode, LISTS, reDraw, reveal, revealAt, nextPack, packLabel, drawPack, loadBoosters, loadPackIndex, COLLATION, printingAt, selectItem, goTab, cycleSort, openCard, setMatched, heldOf, heldByPrint, setBand, BandList, framable, printingsOf, alignFacts, finishesOf, printingsOf, pickPrinting, printKey, cardQ, saveState, loadState, forgetState, savedBytes, STORE, ease, DEAL_MS, SWEEP_MS, BURST, dragSort, moveSort, applySort, clearSort, addSort, addSortTo, setView: v => { P.view = v; }, sortDirty, BUCKETS, namesFit, countsFit, nameRoom, num, toggleCost, pickColour, clearColours, setComboMode, ORDER, PAGES, NAV, UNRESOLVED, IMPORT_GROUPS, filtered, ownedIn, holdingsChanged, CANON, COLS, flatLine, P, TABS, LISTS, GAMES, CFG, render, grouping, resolveRow, resolveUnresolved, setIconUrl, loadSymIndex, setIcon,'
  + ' get IMPORT_MATCHED() { return IMPORT_MATCHED; }, get IMPORT_SKIPPED() { return IMPORT_SKIPPED; },'
  + ' pickGame, selectItem, clearItem, toggleSelector, picked, selectorOpen,'
  + ' setDebug: v => { DEBUG = v; } };';

/* The collation is generated data, like sets.js - read from disk, not fetched.
   boosters/index.json says which booster kinds each set actually has a sheet
   for, which is what packsFor() reads instead of assuming every play-era set
   also prints a Collector Booster. */
const packIndex = JSON.parse(readFileSync('boosters/index.json', 'utf8'));
let painted = '';
const ctx = vm.createContext({
  // querySelector answers null: render() carries the draw grid's sideways
  // scroll across the innerHTML that destroys it, and in a harness with no
  // layout there is no scroll to carry - "no such element" is the truth here.
  document: { getElementById: () => ({ set innerHTML(v) { painted = v; } }),
              querySelector: () => null, set title(v) {} },
  /* A real Map behind a localStorage shape, because persistence is now a
     decision worth testing rather than a browser detail: the page saves what you
     chose and what you made, and "does it come back" is not answerable against a
     stub that swallows writes. reload is a no-op here - nothing to reload into. */
  localStorage: (globalThis.__store = (() => { const m = new Map(); return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k) }; })()),
  location: { hash: '', reload: () => {} }, addEventListener: () => {}, setInterval: () => {}, console,
});
vm.runInContext(js, ctx);
const t = ctx.__t;
t.loadPackIndex(packIndex);
/* ...and, for the sets the harness draws from, the sheets themselves plus a
   catalogue that covers every printing they name. Both come off disk: a pack is
   now dealt from the real collation, so a draw with no catalogue behind it has
   nothing to resolve "MKM:143" to and comes up empty. Seeding from the sheets'
   own keys is the point - it is exactly the join the page has to make. */
const seedCollation = (code) => {
  const kinds = JSON.parse(readFileSync(`boosters/${code}.json`, 'utf8')).kinds;
  t.loadBoosters(code, kinds);
  const keys = new Set();
  for (const cfg of Object.values(kinds))
    for (const sh of Object.values(cfg.sheets)) for (const k of Object.keys(sh.cards)) keys.add(k);
  const o = [['Alpha Card', '{G}', 'Creature - Elf', 'One.', '1/1', 'G', 1],
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
/* AN EMPTY LIST SAYS WHAT IT IS WAITING FOR, and this is checked BEFORE the
   fixtures go in, because a fresh app is the first thing anyone sees. It used to
   be impossible to reach: the app shipped four binders and four decks, so the
   empty state had no way to render and did not exist - the tab drew a blank page
   under a bar reading "All binders". */
for (const [tab, wants] of [['binders', 'No binders yet'], ['decks', 'No decks yet']]) {
  t.pickGame('mtg'); ctx.location.hash = '#/' + tab; t.render();
  assert.strictEqual(t.LISTS[tab].length, 0, `the app ships with ${tab} already in it`);
  assert.ok(painted.includes(wants), `an empty ${tab} tab renders a blank page`);
  // both ways in are named, because both are real
  assert.ok(painted.includes('href="#/io"') && painted.includes('href="#/printings"'),
    `an empty ${tab} tab does not say how to fill it`);
}
t.P.game = null;
/* THE APP SHIPS WITH NOTHING COLLECTED, so the fixtures live here. They used to
   be four binders and four decks declared in index.html - invented furniture
   that read as a collection while holding nothing, and which a real import would
   have landed beside indistinguishably. A fixture belongs to the test that
   depends on it, which is the right way round: these exist because the binder
   and deck suites need a container to open, not because the app has an opinion
   about what you own.
   Index 4 is the membership, the shape a kept draft has always used; index 2 on
   a binder is its page shape. Cards are attached per suite, because most of
   these assertions are about the SHELL - the selector, the subheader, the sort
   bar - and a container with no cards renders all of it. */
t.LISTS.binders.push(
  ['Alara block', 'sorted colour &rsaquo; rarity', [3, 3]],
  ['Unsorted', 'everything not in another binder', [3, 3]],
  ['Duals &amp; fetches', 'sorted set &rsaquo; number', [2, 2]],
  ['Commander staples', 'sorted colour', [4, 3]],
);
t.LISTS.decks.push(
  ['Mono-Red Burn', 60, '23 distinct', 'legacy &middot; complete'],
  ['Bant Exalted', 60, '27 distinct', 'modern &middot; 4 missing'],
  ['Jeskai Monks', 60, '31 distinct', 'modern &middot; complete'],
  ['Grixis Control', 75, '44 distinct', 'commander &middot; 11 missing'],
);

// browse tabs open with the selector filling the window, so most assertions
// need a selection made first - that's what puts filter/sort/view on screen
const DEFAULT_PICK = { printings: 'Foundations (FDN)', binders: 'Alara block', decks: 'Mono-Red Burn' };
// the bar stages, Apply commits - tests take the same route a click would
const setSort = list => { t.P.sortDraft = list.map(x => ({ ...x })); t.applySort(); };
/* A binder is not filtered. It was MADE by a filter - a set binder, or a fixed
   combination chosen once - so narrowing it afterwards asks a question it has
   already answered; Search and Printings are where you go looking. */
const FILTERED = r => !r.replace('#/', '').startsWith('binders');
const go = route => {
  ctx.location.hash = route; t.render();
  const pick = DEFAULT_PICK[route.replace('#/', '')];
  if (pick && !t.picked()) t.selectItem(pick);
  return painted;
};

// --- you must pick a game before anything else exists ------------------
assert.strictEqual(t.P.game, null, 'a game is preselected - it must be chosen');
for (const r of ['search', 'decks', 'binders', 'printings', 'io', 'config']) {
  ctx.location.hash = '#/' + r; t.render();
  assert.ok(painted.includes('Pick a game'), `${r} did not fall back to the main`);
  // the main wears the same header, so "Card Collector" doesn't jump when you
  // pick - but with no game there are no tabs and no mark
  assert.ok(painted.includes('>Card Collector</span>'), 'the main lost the wordmark');
  assert.ok(!painted.includes('>Search</a>'), 'the main shows tabs before a game is chosen');
  // (the banners below show both marks - it's the header that must be bare)
  assert.ok(!header(painted).includes('ms-watermark-planeswalker'),
    'the header shows a game mark before one is picked');
}
/* A fresh session applies nothing on your behalf - EXCEPT the filing, which is
   now deliberate and everywhere rather than the binder's alone. The rest of the
   rule is unchanged and still asserted below: no display, no filter, no pick. */
const filed = 'kinda,coloura,rarityd,BREAK,releasea,seta,numbera';
assert.strictEqual(t.P.sort.map(x => x.f + (x.d || '')).join(), filed, 'the catalogue does not open filed');
assert.strictEqual(t.sortDirty(), false, 'the default order lands staged but unapplied');
assert.strictEqual(t.P.view, null, 'display has a default');
assert.strictEqual(t.P.filterDraft.cost.length, 0, 'a mana-cost symbol is preselected');
assert.deepStrictEqual(Object.values(t.P.pick).join(','), ',,', 'something is preselected');
// picking a game locks it in, and resets rather than inheriting
setSort([{ f: 'name', d: 'a' }]); t.P.view = 'grid';
t.pickGame('pokemon');
assert.strictEqual(t.P.game, 'pokemon', 'picking a game did not set it');
assert.strictEqual(t.P.sort.map(x => x.f + (x.d || '')).join(), filed, 'a new game inherited the old sort');
assert.strictEqual(t.P.view, null, 'a new game inherited the old display');
// the app enters at whatever tab is furthest left - reorder NAV and the
// landing page follows, rather than a second hardcoded route drifting out of sync
assert.strictEqual(ctx.location.hash, `#/${t.NAV[0][0]}`, 'picking a game did not land on the leftmost tab');
assert.strictEqual(t.NAV[0][0], 'printings', 'the leftmost tab is no longer Printings');
t.pickGame('mtg');

// every route resolves to its own page - a missing one falls back and still looks fine
for (const r of t.ORDER) assert.ok(t.PAGES[r], `route "${r}" has no PAGES entry`);

for (const r of t.ORDER.filter(r => r !== 'home')) {
  ctx.location.hash = '#/' + r;
  t.render();
  const h = header(painted);

  assert.ok(painted.trimStart().startsWith('<header'), `${r}: does not open with <header>`);
  // the game logo is top-LEFT and the cog is top-RIGHT - the logo is also the
  // way back to the main, which is the only place the game can change
  // wordmark first, then the game mark, then the tabs - the wordmark holds the
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
  // Import is a rare one-off, so it sits with the cog on the right - after the
  // stats block, not among the browse tabs
  assert.ok(h.lastIndexOf('href="#/io"') > h.lastIndexOf('>Search<'),
    `${r}: Import is still among the browse tabs`);
  assert.ok(h.lastIndexOf('href="#/config"') > h.lastIndexOf('href="#/io"'),
    `${r}: the cog is not right of Import`);
  // Kit is a design reference, not a user page - it lives in Config
  assert.ok(!h.includes('href="#/kit"'), `${r}: Kit is back in the top nav`);
  assert.ok(h.includes('>Card Collector</span>'), `${r}: wordmark missing`);
  assert.ok(!/Advisor|Collections/.test(h), `${r}: dropped section reappeared in the nav`);
  // tabs are on every page now - the selector under the header carries the
  // selection instead, so nothing has to hide to make room
  if (r !== 'home') {
    assert.ok(h.includes('>Search</a>'), `${r}: Search is missing from the nav`);
    assert.ok(h.lastIndexOf('>Search</a>') > h.lastIndexOf('>Import/Export'),
      `${r}: Search is not the last tab`);
  }
  // the game is fixed while navigating - only the main can change it
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
  // page beneath - filter/sort/view only exist once you've stopped choosing.
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
  // itself - which is only true if the controls are actually here
  if (t.TABS[route].keyed) {
    for (const c of ['Add cards', 'Arrange', 'Remove'])
      assert.ok(header2(painted).includes(c), `${route}: no "${c}" control on the thing itself`);
  } else {
    assert.ok(!header2(painted).includes('Add cards'), `${route}: a set is not editable`);
  }
  assert.ok(!painted.includes('>export</span>'), `${route}: the old export band is still below`);
  // sort / view are on this page too - that's the whole point - and filter is
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
// Search is the one tab with nothing to select - but it keeps the bar, so
// Export sits in the same place on every page
ctx.location.hash = '#/search'; t.render();
assert.ok(!painted.includes('selectItem('), 'Search should have no selector - it is all cards');
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
/* DISPLAY, THEN GROUP ORDER, THEN SORT ORDER - in reading order, because that
   is the order the decisions compose in: what a card looks like, what makes a
   page, what arranges the cards on it. The break used to be a draggable chip in
   the middle of one "Order" row, so which side a field was on was something you
   discovered by moving it. */
assert.ok(painted.indexOf('>Display<') < painted.indexOf('>Group order<'), 'the display is not first on the sort bar');
assert.ok(painted.indexOf('>Group order<') < painted.indexOf('>Sort order<'), 'sort order is not after group order');
assert.ok(!/>&#8801; Break</.test(painted), 'the break is still drawn as a chip you can drag');
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
  // a details-only column, by its declared label: the row and the header both
  // come off DETAIL_COLS now, so any of them identifies the wide layout. The
  // header is the one extra - drawn once for the list rather than per row.
  const wide = (painted.match(/title="Artist"/g) || []).length;
  assert.ok(wide === (v === 'details' ? rows + 1 : 0),
    `${v}: ${wide} of ${rows} rows drew the detail columns - the layout is not uniform`);
}
/* EIGHTEEN UNLABELLED COLUMNS is a table you decode rather than read, and at row
   200 a header at row 0 has scrolled away. So: labelled once for the list, and
   pinned to the top of the scrolling pane. */
t.setView('details'); t.render();
const labelled = (painted.match(/>Qty</g) || []).length;
assert.ok(labelled === 1, `the details header is drawn ${labelled} times - it belongs to the list, not the row`);
const upto = painted.slice(0, painted.indexOf('title="Qty">Qty<'));
assert.ok(upto.slice(upto.lastIndexOf('<div ')).includes('sticky top-0'),
  'the details column header does not stick to the top of the pane');
t.setView(null); t.render();
// the row layouts fill the pane - a fixed max-width left half the window empty
for (const v of ['compact', 'details']) {
  t.setView(v); t.render();
  const rows = painted.slice(painted.indexOf('>view<'));
  assert.ok(!/max-w-\w+[^"]*rounded-lg border border-neutral-800 bg-neutral-950/.test(rows),
    `the ${v} layout is width-capped instead of spanning the pane`);
}
t.setView(null); t.render();
assert.ok(painted.includes('onclick="setView('), 'the display is not a live switch');
assert.ok(painted.includes('onclick="applySort()"'), 'the sort bar has no Apply');
setSort([]);
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
   list, not a query" - no filter. On 2026-08-07 that read as broken rather than
   principled and binders filtered like everything else. Reversed again on
   2026-08-12 with the argument that settles it: a binder was MADE by a filter -
   a set binder, or a fixed combination chosen once - so filtering it afterwards
   asks a question it has already answered. Searching a collection is what
   Search and Printings are for. Sort stays: how you arrange a binder you own is
   a live question in a way what is in it is not. */
go('#/binders');
assert.ok(!painted.includes('>Type</span>'), 'a binder is offering to filter itself');
assert.ok(!painted.includes('>filter</span>'), 'the binder still has a filter band');
// the sort row is still there - named by its zones now that the break is not a chip
assert.ok(painted.includes('>Group order<') && painted.includes('>Sort order<'),
  'binder scope lost the sort row');
/* A binder has one layout and it is the binder - drawing a binder as a compact
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
for (const part of ['CON', 'en', '71', 'nonfoil'])
  assert.ok(painted.includes(part), `details row is missing "${part}" from the identity key`);
/* Qty is TWO numbers, not one: copies of this exact printing | copies of the
   card in any printing. One number made eight printings of a card you own one
   of read as eight cards you own none of. */
assert.ok(/>2<\/span>\s*<span class="px-0\.5[^"]*">\|<\/span>\s*<span[^>]*>2</.test(painted),
  'details does not show copies-here against copies-in-all-printings');
// Compact is the card's title line: name, mana cost, and the count because a
// binder holds copies. It is deliberately NOT the identity key.
t.setView('compact'); t.render();
const rows = painted.slice(painted.indexOf('>view<'));
assert.ok(rows.includes('Noble Hierarch') && rows.includes('class="ms"'),
  'compact is missing the name or the mana cost');
assert.ok(rows.includes('×2'), 'compact drops the count on a scope that holds copies');
for (const part of ['nonfoil', '>CON<', '£'])
  assert.ok(!rows.includes(part), `compact still carries "${part}" from the identity key`);
/* One compact row is short, so a full-width list of them is mostly empty: it
   lays out in however many columns the layout row is set to. That number used to
   be arrived at by nudging a percentage until auto-fill happened to divide the
   pane the way you wanted, which is why it is a count now. */
assert.ok(/repeat\(\d+,minmax\(0,1fr\)\)/.test(rows),
  'compact is a single column list rather than filling the pane');
assert.ok(/grid-column:1\/-1/.test(rows), 'a compact group header does not span the columns');
/* The track used to be measured off the widest row the data could produce, so a
   game with shorter names got narrower columns on its own. That went with
   auto-fill: a column is now 1fr of the pane and a long name truncates, which is
   what `truncate` on the row was always there for. The count is the setting;
   nothing about it is per-game any more. */
assert.ok(!/minmax\(\d+px/.test(rows), 'a px track is back, so the count is not the setting');
assert.ok(t.TitleRow({ n: 'Knight of the Reliquary', cost: ['3', 'G', 'W'] }).includes('truncate'),
  'a name too long for its column has nothing to truncate it');

/* QTY IS A COLUMN ON EVERY SCOPE. It used to be drawn on Binders and Decks
   alone - so the same printing said ×4 in a deck and nothing at all in Search,
   and the card page needed a Holdings band to answer a question the list
   refused to. Zero reads "none", not ×0: the difference between owning none and
   owning four is the whole point of the column, and ×0 down a search result
   reads as a broken count rather than an answer. */
for (const [qty, want, avoid] of [[0, '>none<', '×'], [3, '×3', '>none<']]) {
  const row = t.TitleRow({ n: 'Anything', qty });
  assert.ok(row.includes(want), `a qty of ${qty} does not draw "${want}"`);
  assert.ok(!row.includes(avoid), `a qty of ${qty} still draws "${avoid}"`);
}
go('#/printings'); t.setView('compact'); t.render();
assert.ok(/title="Copies you own"/.test(painted.slice(painted.indexOf('>view<'))),
  'a set list drops the qty column');
go('#/decks'); t.setView('grid'); t.render();

// --- the generated set list is well formed ------------------------------
// Scryfall nests two deep in places; taking the immediate parent as the block
// made the middle set both a block and a child, and it rendered twice.
const codes = t.SETS.map(r => r[1]);
assert.strictEqual(new Set(codes).size, codes.length,
  `duplicate set codes: ${codes.filter((c, i) => codes.indexOf(c) !== i).slice(0, 5)}`);
assert.ok(t.SETS.length > 900, `only ${t.SETS.length} sets - this is not all of them`);
assert.strictEqual(t.SETS[0][4], 0, 'the list opens on a sub-set with no parent above it');
for (const [i, r] of t.SETS.entries()) {
  assert.ok(/^\d{4}-\d\d-\d\d$/.test(r[2]), `${r[1]} has no release date`);
  if (i) assert.ok(r[2] <= t.SETS[i - 1][2] || r[4] || t.SETS[i - 1][4],
    `${r[1]} breaks the newest-block-first order`);
}
/* OWNERSHIP IS COUNTED, NOT STORED. sets.js carried an `owned` column that was
   `hash(code)` - 20,197 cards over 502 of the 986 sets - so a collection holding
   nothing reported "19% collected" in the header and drew a Collected bar on
   half the table. Same class of thing as the four mock binders: a number that
   reads as your collection and is arithmetic on a string. The column is gone,
   so a row is eight wide, and `ownedIn` counts your holdings instead. */
assert.ok(t.SETS.every(r => r.length === 8), 'a SETS row still carries the mock ownership column');
assert.strictEqual(t.SETS.reduce((n, r) => n + t.ownedIn(r[1]), 0), 0,
  'an uncollected app still reports cards collected');
ctx.location.hash = '#/printings'; t.clearItem(); t.render();
assert.ok(header(painted).includes('0% collected'), 'a collection holding nothing does not say 0%');
{
  // ...and a real holding is counted, per DISTINCT printing rather than per copy:
  // "collected" asks how many of a set's cards you have, and four of one card is
  // not four of them
  const s0 = t.SETS.find(r => r[3] > 2);
  t.LISTS.binders.push(['Counted', '', [3, 3], '', [
    { n: 'A', set: s0[1], num: '1', lang: 'en', qty: 4 },
    { n: 'A', set: s0[1], num: '1', lang: 'en', qty: 1 },
    { n: 'B', set: s0[1], num: '2', lang: 'en', qty: 1 },
    { n: 'C', set: s0[1], num: '3', lang: 'en', qty: 0 },
  ]]);
  t.holdingsChanged();
  assert.strictEqual(t.ownedIn(s0[1]), 2, 'ownership counts copies rather than distinct printings');
  assert.strictEqual(t.ownedIn('NOSUCH'), 0, 'an unheld set claims cards');
  t.LISTS.binders.pop(); t.holdingsChanged();
  assert.strictEqual(t.ownedIn(s0[1]), 0, 'removing a holding does not un-count it');
}

// every year between the oldest and newest set is represented - the gutter is
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
   must be TALL enough to show it - that is what the gap is for, and without it
   the image stretches the real rows instead. Height and not a row count, because
   the gap is now one row sized to the shortfall rather than N whole ones: a
   block of one set gets a single 186px row where it used to get six. Lazy,
   because there are 184 of these and only the ones you scroll to are fetched. */
const packs = spanning.filter(m => m[0].includes('<img'));
assert.ok(packs.length > 150, 'the pack column has lost most of its art');
for (const [cell] of packs) {
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
assert.ok(t.PACK_SAT > 1, 'the pack saturation is a no-op - say so or remove it');
/* LOCAL AND ONLINE ARE THE SAME PICTURE BECAUSE THEY ARE THE SAME CODE.
   gen-packs.mjs used to carry a hand-kept copy of the algorithm with three
   assertions here holding the two in step; both now read trim.js, so there is
   nothing left to drift and nothing to assert about it beyond the wiring. */
{
  const gp = readFileSync('gen-packs.mjs', 'utf8');
  assert.ok(/shared\('trim\.js'/.test(gp), 'gen-packs.mjs no longer trims with the page\'s own code');
  assert.ok(!/^const TRIM_TOL = \d/m.test(gp), 'gen-packs.mjs has grown its own copy of the trim constants');
  assert.ok(readFileSync('index.html', 'utf8').includes('src="trim.js"'),
    'the page does not load trim.js, so trimPack has no algorithm');
  assert.ok(readFileSync('serve.py', 'utf8').includes("'/trim.js'"),
    'serve.py will 404 trim.js, so the page loads with no trim at all');

  /* ONCE MEANS ONCE, and the manifest is the mechanism. Skipping on "a file of
     that name exists" answers a different question - it says a picture was made,
     not that it was made by the recipe now in force - so a changed constant left
     stale PNGs on disk with nothing to notice. The fingerprint has to cover the
     CODE as well as the numbers, or a rewritten flood fill is called the same
     recipe, and that is the likelier edit of the two. */
  assert.ok(/createHash\(/.test(gp) && /\.update\(trimPixels\.toString\(\)\)/.test(gp),
    'the pack recipe fingerprint does not cover trimPixels() itself, so changing the algorithm reuses stale images');
  assert.ok(/have\.has\(name\) && man\.files\[name\]/.test(gp),
    'gen-packs.mjs skips on the filename alone, which cannot tell a current image from a stale one');

  /* PACK_ART PROMISES A PHOTOGRAPH, NOT AN ID. MTGJSON lists a
     tcgplayerProductId for three products whose picture 403s at every size on
     the only host that still resolves, so gen-sets.mjs asks the CDN and drops
     the ones that answer no. Two things have to hold for that to be safe, and
     the second is here because the first version of the probe broke it: the
     question must be asked with a request this CDN answers (it accepts a HEAD
     and never replies, which scored all 391 ids as missing), and an
     implausible answer must be refused rather than emitted - an empty PACK_ART
     passes every other test in this file and removes the wrapper from every
     pack in the app. */
  const gs = readFileSync('gen-sets.mjs', 'utf8');
  assert.ok(!/method: 'HEAD'/.test(gs),
    'gen-sets.mjs probes the pack CDN with HEAD, which it accepts and never answers');
  assert.ok(/dead\.length > all\.length \/ 4/.test(gs),
    'gen-sets.mjs will emit an empty PACK_ART if the probe breaks, with nothing to notice');
  assert.ok(/catch \{ errors\+\+; \}/.test(gs),
    'an unreachable id is recorded as having no photograph, so one bad run deletes it for good');

  // ...and the emitted map has to still describe real packs
  const packs = Object.values(t.PACK_ART).reduce((n, o) => n + Object.keys(o).length, 0);
  assert.ok(packs > 300, `PACK_ART is down to ${packs} packs - the availability probe has misfired`);
  for (const dead of [31840, 244377, 34469])
    assert.ok(!JSON.stringify(t.PACK_ART).includes(String(dead)),
      `PACK_ART still carries ${dead}, which has no photograph at any size`);
  // ...and what it wrote has to describe what is actually there. The constants
  // come off trim.js, which is now the only place they are written down.
  if (existsSync('packs/.recipe.json')) {
    const man = JSON.parse(readFileSync('packs/.recipe.json', 'utf8'));
    const now = Object.fromEntries([...readFileSync('trim.js', 'utf8').matchAll(
      /\b(TRIM_TOL|PACK_SAT|WHITE|MAX_GAIN|LEVELS)\s*=\s*([\d.]+)/g)].map(m => [m[1], +m[2]]));
    assert.strictEqual(Object.keys(now).length, 5, 'trim.js no longer states all five constants');
    assert.deepStrictEqual(man.constants, now,
      'packs/ was built with different constants from the ones in force - re-run gen-packs.mjs');
    const onDisk = readdirSync('packs').filter(f => f.endsWith('.png'));
    const unrecorded = onDisk.filter(f => !man.files[f]);
    assert.strictEqual(unrecorded.length, 0,
      `${unrecorded.length} pack images have no recipe recorded (e.g. ${unrecorded[0]})`);
  }
}
/* The render side of "once": a local PNG was already trimmed on the way in, so
   trimming it again would level and saturate it a second time - the same fault
   as no trim at all, in the other direction. Local carries no onload. */
{
  const gp = readFileSync('index.html', 'utf8');
  const local = gp.match(/const packAttrs = \([^)]*\) => packLocal\(\) \? ([^\n]+)/)[1];
  assert.ok(!local.includes('trimPack'),
    'a local pack image is trimmed again in the browser, so it is levelled and saturated twice');
  /* ...and it does not reach for the CDN either. Local used to swap the
     attributes and re-fetch from tcgplayer on any missing file, so a half-run
     gen-packs looked complete and "Local" quietly meant "local where possible".
     Asserted against the source because the fallback lived in an inline
     handler that only fires on a real 404, which this harness cannot produce. */
  assert.ok(!local.includes('packCdn') && !/packMissing[\s\S]{0,400}?packCdn/.test(gp),
    'a missing local pack image still falls through to the CDN, so Local needs the network');
}
/* THE SAME FOR ART, and this is the one that mattered: 449 of 107,606 crops are
   on disk, so a CDN fallback fired on ~99.6% of cards - a failed local request
   AND a network one, which made Local the SLOWER setting while Config said in
   green that nothing on the page needs the network. */
{
  const gp = readFileSync('index.html', 'utf8');
  // anchored on the expression's own end, not on a newline: the file is CRLF
  const art = gp.match(/const artAttrs =[\s\S]*?: '';/)[0];
  assert.ok(!art.includes('artCdn'),
    'a missing local art file still falls through to the CDN, so Local needs the network');
}
/* THE GAP IS ONE ROW SIZED TO THE SHORTFALL, and the arithmetic is asserted
   rather than the row count, because the row count is exactly what stopped
   meaning anything: padding every short block out to seven 33px rows cost 549
   blank rows and took the table from 986 to 1535. Walked in document order -
   every block with art is measured at 33px a real row plus whatever its gap row
   declares, and must come to at least the picture's 186 + 33. */
{
  // `<tr>` and `<tr onclick=...>` both: a gap row is bare, a set row is not
  const trs = [...painted.matchAll(/<tr[ >][\s\S]*?<\/tr>/g)].map(m => m[0]);
  const HEIGHT = /<td colspan="5" style="height:(\d+)px">/;
  const tall = tr => (HEIGHT.exec(tr) ? +HEIGHT.exec(tr)[1] : 33);
  let blocks = 0, gaps = 0;
  for (let i = 0; i < trs.length; i++) {
    const pack = /<td rowspan="(\d+)"[^>]*>(?:(?!<\/td>)[\s\S])*?<img/.exec(trs[i]);
    if (!pack) continue;
    blocks++;
    const n = +pack[1];
    const rows = trs.slice(i, i + n);
    assert.ok(rows.reduce((h, r) => h + tall(r), 0) >= 186 + 33,
      `a block with pack art is ${rows.reduce((h, r) => h + tall(r), 0)}px tall, too short to show its picture`);
    // at most ONE gap per block - the whole point of sizing it in pixels
    const g = rows.filter(r => HEIGHT.test(r)).length;
    assert.ok(g <= 1, `a block padded itself with ${g} gap rows instead of one sized to the shortfall`);
    gaps += g;
  }
  assert.ok(blocks > 150, 'the pack column has lost most of its art');
  assert.ok(gaps > 0, 'nothing is padded at all, so a one-set block stretches its rows to fit the picture');
  // the saving is the issue: one per short block, not one per 33px of shortfall
  assert.ok(gaps < blocks * 2, `${gaps} gap rows over ${blocks} blocks - the gap is per-row again`);
}
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

// every set is a link to its own page - a set you can only filter by is a set
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
// the dates label the rows, they don't filter them - a set is the only thing
// on this page you can click, and it always goes to that set's page
assert.ok(!/setNode|onclick="[^"]*"[^>]*rowspan|rowspan="\d+"[^>]*onclick/.test(painted),
  'a date cell is clickable');
const table = painted.slice(painted.indexOf('<table'), painted.indexOf('</table>'));
assert.deepStrictEqual([...new Set([...table.matchAll(/onclick="([a-zA-Z]+)\(/g)].map(m => m[1]))].sort(),
  ['draftPack', 'draftSet', 'selectItem'], 'the set table has a handler that is neither a set click nor a draft');
/* The booster picture is the Draft button, so it must name the set the same way
   the chip does - and it must stop the click there, or the row underneath
   answers the same press by navigating somewhere else. */
for (const m of table.matchAll(/draftPack\(event,'([^']*)'\)/g))
  assert.ok(t.packsFor(m[1].replace(/\\&#39;/g, "'").replace(/&amp;/g, '&'))?.length,
    `the booster picture drafts "${m[1]}", which has no collation`);
assert.ok(t.draftPack.toString().includes('stopPropagation'),
  'clicking the booster also fires the row underneath');
/* The row and the Draft button both name the set the SAME way - the table's
   disambiguated form. Passing the bare name is the bug that hid the Boosters
   button for every set picked from this table. */
const draftable = t.SETS.find(r => t.packsFor(`${r[0]} (${r[1]})`)?.length);
assert.ok(table.includes(`draftSet('${t.jsArg(`${draftable[0]} (${draftable[1]})`)}')`),
  'the Draft button does not name the set the way the row does');
assert.ok(t.packsFor(`${draftable[0]} (${draftable[1]})`)?.length && t.packsFor(draftable[0])?.length,
  'a set resolves in one naming form but not the other');
// and the sets that cannot be drafted get a button-shaped nothing
const tokenRow = t.SETS.find(r => r[5] === 'token');
assert.ok(!table.includes(`draftSet('${t.jsArg(`${tokenRow[0]} (${tokenRow[1]})`)}')`),
  'a token set is offered a draft in the list');
assert.ok(table.includes('no pack data'), 'the list never explains a set it cannot draft');
/* Clicking Draft goes to the draw, and DOES NOT COST YOU YOUR PLACE. Opening
   boosters was a band over this page precisely so it could not lose your row;
   it is a route again because a band leaves every control beneath it live and
   clickable through the gap. Both halves are pinned here: it navigates, and the
   selection you were on is still the selection when you get there - and still
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

// year and month span exactly the rows they cover - the whole point of the
// gutter is that "this year covers these rows" is structural, not eyeballed
// vertical-rl or it isn't a gutter label - the booster cell that spans the same
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
for (const r of t.SETS) blockRel.push(r[4] && blockRel.length ? blockRel.at(-1) : r[2]);
for (const width of [4, 7]) {
  const keys = blockRel.map(d => d.slice(0, width));
  const runs = [];
  for (const k of keys) (runs.at(-1)?.[0] === k ? runs.at(-1) : runs[runs.push([k, 0]) - 1])[1]++;
  assert.strictEqual(new Set(runs.map(r => r[0])).size, runs.length,
    `a ${width === 4 ? 'year' : 'month'} is split into two runs - its rowspan would overlap the next`);
  /* The counts themselves are no longer SETS.length - the pack column pads a
     short block with gap rows - so the invariant is checked against what was
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
// the pack column spans the same rows, cut a different way - by block, not month
assert.strictEqual(
  [...painted.matchAll(/<td rowspan="(\d+)" class="border-y border-r[^"]*">/g)].reduce((n, m) => n + +m[1], 0),
  printedRows, 'the pack cells do not account for every row');

// --- the mock card is the anatomy, and the data exercises all of it -----
// A mock that only ever draws a mono-green creature proves nothing, so the
// fixtures carry one of every type and every frame case the layout must survive.
t.pickGame('mtg'); go('#/search'); t.setView('grid'); t.render();
/* THE WHOLE POOL, NOT THE PAGE. `CARDS()` is what a view may DRAW, and it now
   arrives narrowed to the default language - which is the point of that filter
   and would quietly hide the foreign fixture from every assertion below. What
   this block is about is whether the fixtures cover every shape the frame has
   to survive, which is a question about the pool. */
const mtgCards = t.scopedCards();
for (const kind of ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'])
  assert.ok(mtgCards.some(c => c.type.includes(kind)), `no ${kind} in the mtg fixtures`);
for (const tier of [1, 2, 3, 4]) assert.ok(mtgCards.some(c => c.rar === tier), `no rarity tier ${tier}`);
assert.ok(mtgCards.some(c => c.col.length > 1), 'nothing multicolour - the gold frame is never drawn');
assert.ok(mtgCards.some(c => c.col === ''), 'nothing colourless');
assert.ok(mtgCards.some(c => c.pt) && mtgCards.some(c => c.loy), 'no power/toughness or no loyalty');
assert.ok(mtgCards.some(c => (c.cost || []).includes('X')), 'no X cost');
assert.ok(mtgCards.some(c => (c.cost || []).some(x => x.includes('/'))), 'no hybrid or phyrexian pip');
assert.ok(mtgCards.some(c => !c.cost.length), 'no card without a cost - the land case');
assert.ok(mtgCards.some(c => c.lang !== 'en') && mtgCards.some(c => c.foil), 'no foreign printing or no foil');
assert.ok(mtgCards.some(c => c.flav), 'no flavour text - the rule above it is never drawn');
// the frame is the five plates, whatever the card is
for (const c of mtgCards) {
  const one = t.MockCard(c);
  assert.ok(one.includes(c.n) && one.includes(c.type), `${c.n}: name or type line missing`);
  /* THE WINDOW TAKES THE CROP'S SHAPE. This pinned `aspect-[5/3.52]`, which was
     a number picked before the crop's ratio was known -- the crop is 1.37 and
     the box was 1.42, so every ordinary card lost a sliver off its illustration.
     The window is `h-auto` on the image now and the clamp is what is asserted,
     because the clamp is the risk: a 312x752 Saga crop reaching an ordinary
     frame would be 2.4x the card's width tall. */
  assert.ok(/min-h-\[36%\] max-h-\[58%\]/.test(one), `${c.n}: no art window`);
  assert.ok(/class="block h-auto w-full"/.test(one), `${c.n}: the art window does not take the crop's own shape`);
  assert.ok(one.includes(`${c.set} ${c.num}`), `${c.n}: no collector line`);
  assert.ok(!one.includes('undefined'), `${c.n}: leaked undefined into the frame`);
  /* every token draws something rather than vanishing - its glyph where the font
     has one (colours, digits, tap), the marks of its halves where it is a split
     symbol, and only otherwise its own text in the fallback disc */
  for (const tok of c.cost || []) {
    const g = t.glyphOf(tok);
    const marks = tok.includes('/')
      ? (tok.endsWith('/P') ? [t.glyphOf('P')] : tok.split('/').map(x => t.glyphOf(x)))
      : null;
    assert.ok(marks ? marks.every(m => one.includes(m)) : g ? one.includes(g) : one.includes(`>${tok}<`),
      `${c.n}: dropped the "${tok}" pip`);
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
    const parent = t.SETS.find(r => !r[4] && t.SETS[t.SETS.indexOf(r) + 1]?.[4]);
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
     one group per card - which in a binder is one PAGE per card. */
  assert.strictEqual(t.GROUP_LABEL.price({ usd: 42.10 }), '£20–100',
    'the price label is banding the card object instead of its price');
  assert.strictEqual(t.GROUP_LABEL.price({ usd: 0.25 }), 'under £1', 'cheap cards are not banded');
  for (const dash of ['&mdash;', '-'])   // mocks carry the entity, the catalogue a real dash
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
// a stepper, not a slider: "exactly 3 across" is the whole point, and a slider
// cannot be asked for it
assert.ok(painted.includes('onchange="setCols(this.value)"'), 'the Columns stepper is missing');
assert.ok(/type="number"[^>]*onchange="setCols/.test(painted.replace(/\s+/g, ' ')),
  'Columns is not a number input, so it has no arrows and no manual entry');
assert.ok(!painted.includes('type="range"'), 'a range slider is still being drawn');
/* Two rows: what you CHOOSE on the first - Display, Order, Apply/Clear - and
   the numbers that size the layout underneath. The numbers change width as you
   edit them ("9/page &middot; 2 spreads" -> "12/page &middot; 3 spreads"), so
   inline they shove the Order chips sideways while you are aiming at one.
   Ordered by index, not a bounded regex - the markup between them changes. */
{
  // scoped to the sort band: the filter panel has an Apply of its own, earlier
  const band = painted.slice(painted.indexOf('>sort<'));
  const at = (s) => band.indexOf(s);
  assert.ok(at('>Display<') >= 0 && at('>Group order<') > at('>Display<'),
    'Group order does not follow the display choice');
  assert.ok(at('>Group order<') < at('>Sort order<'), 'Sort order is not after Group order');
  assert.ok(at('>Sort order<') < at('>Apply<'), 'Apply is not at the end of the first row');
  assert.ok(at('>Apply<') < at('>Columns<'), 'the sizing numbers are not on the row beneath');
  assert.ok(/flex flex-col gap-2[\s\S]{0,400}>Display</.test(band),
    'the sort band is not two stacked rows');
  /* THE THREE TERMS SHARE THE ROW BY WHAT THEY DRAW. `flex-1` on each gave the
     zone holding two chips as much bar as the one holding ten, so there was a
     lane of empty bar between the last group chip and the Sort order label.
     The weight is characters - the label plus each chip's - so the split comes
     off the content rather than off a number someone picked. */
  const weights = [...band.matchAll(/style="flex:(\d+) 1 0%"/g)].map(m => +m[1]);
  assert.strictEqual(weights.length, 3,
    `${weights.length} of the 3 sort-bar terms are sized by what they hold`);
  assert.ok(weights[1] > weights[0],
    'the zone with the most chips is not the widest, so the row is not sized by its content');
}
/* ONE FIELD, ONE ZONE. Every category field used to be offered in Group order
   AND in Sort order, so Language sat on the bar twice and the two chips read as
   two different fields. */
{
  const band = painted.slice(painted.indexOf('>sort<'));
  for (const f of t.GAMES.mtg.sort) {
    const n = (band.match(new RegExp(`>${t.fieldLabel(f)}</span>`, 'gi')) || []).length;
    assert.ok(n <= 1, `${f} is offered in ${n} places on the sort bar`);
  }
}
/* THE BINDER LAYOUT BELONGS TO BINDERS, and it used to be offered on Printings
   as well - where it drew a SET as pages of pockets. That looks like a binder
   and is not one: a binder is a container you own, with a page shape of its
   own; a set is every card Wizards printed. Offering it there invited the
   catalogue to be read as a collection, which is the confusion this app spent
   the week deleting. Neither binder nor deck has ever been on Search, and this
   pins that too - a query has no pages and no sections to fill. */
go('#/printings'); t.render();
for (const v of ['binder', 'deck'])
  assert.ok(!painted.includes(`setView('${v}')`), `printings still offers the ${v} layout`);
go('#/search'); t.render();
for (const v of ['binder', 'deck'])
  assert.ok(!painted.includes(`setView('${v}')`), `search still offers the ${v} layout`);
/* The sizing numbers follow the LAYOUT, not the tab: a card-size percentage is
   no use to a binder, which sizes itself from Pages/Columns/Rows. */
go('#/binders'); t.render();
assert.strictEqual(t.P.view, 'binder', 'binders did not default to its one layout');
assert.ok(!painted.includes('onchange="setCols(this.value)"'),
  'the binder offers a card-column count as well as its page shape');
for (const label of ['Pages', 'Columns', 'Rows'])
  assert.ok(painted.includes(`>${label}</span>`), `the binder does not offer ${label}`);
/* WHO OWNS THE PAGE SHAPE, which is two answers and they must not cross. With
   nothing picked the edit goes to the tab default; with a binder picked it goes
   to that binder, because a real binder is bought as 3x3 or 4x3 and the shape
   is a property of the object rather than a display preference.
   `dimsOwner` reads P.pick.binders whatever tab you are on, so a leftover pick
   would have sent the first edit to a binder - cleared rather than assumed. */
t.clearItem(); t.render();
t.setBinderDim(0, 5); t.render();
assert.strictEqual(t.P.dims[0], 5, 'editing the page shape off a binder did not reach the default');
t.P.dims = [3, 3];
{
  // ...and the layout only draws once a binder is picked, because until then the
  // tab is its selector: the list of binders, not the inside of one
  const b0 = t.LISTS.binders[0], was = [...b0[2]];
  t.selectItem(b0[0]); t.render();
  assert.ok(painted.includes(`repeat(${was[0]},minmax(0,1fr))`), 'a picked binder did not lay its own pages out');
  t.setBinderDim(0, 5); t.render();
  assert.strictEqual(b0[2][0], 5, "editing a picked binder's shape went to the tab default instead");
  assert.strictEqual(t.P.dims[0], 3, 'editing a picked binder also moved the tab default');
  assert.ok(painted.includes('repeat(5,minmax(0,1fr))'), 'the binder did not relay its new page shape out');
  b0[2] = was; t.clearItem(); t.render();
}
// a tab that HAS the card layouts gives the column count back
go('#/search'); t.setView('grid'); t.render();
assert.ok(painted.includes('onchange="setCols(this.value)"') && !painted.includes('>Pages</span>'),
  'leaving the binder layout did not give the column count back');

/* THE NUMBER YOU TYPE IS THE NUMBER OF COLUMNS. Zoom set a minimum track width
   and let auto-fill decide the count, so this asserted a px track and "bigger
   than the last one" - which is as close to "how many across" as a percentage
   can get. Now it is the count itself, and auto-fill is gone. */
const colsAt = (n) => { t.setCols(n); t.render(); return painted.match(/repeat\((\d+),minmax\(0,1fr\)\)/)[1]; };
assert.strictEqual(colsAt(3), '3', 'the grid does not lay out the number of columns asked for');
assert.strictEqual(colsAt(11), '11', 'a wider count did not reach the layout');
assert.ok(!painted.includes('auto-fill'), 'the layout still lets auto-fill decide the count');
t.setCols(99); assert.strictEqual(t.P.cols.grid, 12, 'the grid column count is not clamped at the top');
t.setCols(0);  assert.strictEqual(t.P.cols.grid, 1, 'the grid column count is not clamped at the bottom');
/* Per layout, and the bounds differ: 12 columns of cards is a contact sheet, 12
   columns of compact rows is unreadable. Setting one must not move the other. */
t.setCols(8);
t.setView('compact'); t.render();
assert.strictEqual(t.P.cols.compact, 6, 'the two layouts share one column count');
t.setCols(99); assert.strictEqual(t.P.cols.compact, 6, 'compact takes the grid bounds instead of its own');
assert.strictEqual(t.P.cols.grid, 8, 'setting compact moved the grid as well');
assert.ok(painted.includes('repeat(6,minmax(0,1fr))'), 'compact did not lay out its own count');
t.P.cols = { compact: 6, grid: 6 };
// a layout with no count to set offers no stepper rather than an inert one
t.setView('details'); t.render();
assert.ok(!painted.includes('onchange="setCols(this.value)"'),
  'Details is a table and still offers a column count');
// the binder's page shape is data, editable, and the layout lays out exactly that many
go('#/binders'); t.setView('binder'); t.render();
/* The binder has no Zoom: a percentage is the wrong question for it. Pages,
   Columns and Rows say what is open and how it is pocketed, and the card size
   is whatever fits - which is also why the layout can no longer outgrow the
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
  const outer = /gap-8" data-spreads\s*style="grid-template-columns:repeat\((\d+),minmax\(0,1fr\)\)/.exec(painted);
  assert.ok(outer, `${name}: there is no grid of spreads`);
  assert.strictEqual(+outer[1], t.P.across / 2,
    `${name}: ${outer[1]} spreads across for ${t.P.across} pages`);
  const inner = [...painted.matchAll(/gap-3" data-spread\s*style="grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/g)];
  assert.strictEqual(inner.length, Math.ceil(((painted.match(/>Page \d+</g) || []).length + 1) / 2),
    `${name}: the spread count does not follow from the pages plus the cover`);
  /* OFFSCREEN SPREADS SKIP LAYOUT, and the first one does not - it is the only
     spread guaranteed to be on screen, so it is the only one whose height can be
     measured, and `--spread-h` is what the rest stand in at. Exempting it is
     load-bearing in both directions: skip it too and there is nothing to
     measure; skip none and a 240-page binder costs 267ms of layout per render
     against 17.9ms with this. */
  const cv = [...painted.matchAll(/content-visibility:auto;contain-intrinsic-height:auto var\(--spread-h,0px\);/g)];
  assert.strictEqual(cv.length, inner.length - 1,
    `${name}: ${cv.length} of ${inner.length} spreads skip layout - the first must not, the rest must`);
  assert.ok(inner.length < 2 || painted.indexOf('content-visibility') > inner[1].index - 200,
    `${name}: the first spread skips layout, so there is no real height to measure`);
  // the pockets share the page the same way
  assert.ok(painted.includes(`repeat(${cols},minmax(0,1fr))`),
    `${name}: the pockets are not ${cols} equal shares of the page`);
  // the first spread is the inside front cover and page 1, so page 1 reads right-hand
  assert.ok(/repeat\(2,minmax\(0,1fr\)\);">\s*<div><\/div>/.test(painted),
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
     it drew a single page of the whole list - which read as "nine per group"
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

/* THE FILING IS EVERY TAB'S NOW, not the binder's private arrangement seeded on
   arrival and taken back on the way out. That special case existed only because
   everywhere else started empty; with one default there is nothing for it to do,
   and the bookkeeping it needed - "did they touch it" - is gone with it. A sort
   you set yourself still travels, which is what that bookkeeping was protecting. */
setSort(t.DEFAULT_SORT());
for (const tab of ['#/search', '#/binders', '#/printings']) {
  ctx.location.hash = tab; t.render();
  assert.strictEqual(t.P.sort.map(x => x.f + (x.d || '')).join(), filed, `${tab} did not arrive filed`);
}
assert.strictEqual(t.sortDirty(), false, 'the arrangement lands staged but unapplied');
// everything left of the break is the grouping: main type, then colour, then rarity
assert.strictEqual(t.grouping().map(x => x.f).join(), 'kind,colour,rarity',
  'the page break is not after rarity');
/* MAIN TYPE IS A BINARY, and it is not the type line. The type line says a Token
   Creature is a creature and a Snow Artifact Land is an artifact, and neither is
   a card you would file with them - so the misc types VETO and everything else
   is a card you build a deck out of.
   It used to return seven values, six spell types and "Other", where Other was
   18,544 printings - 17% of the catalogue - filing 6,909 lands and 2,178 tokens
   in with emblems, schemes and dungeons. Creature-vs-Instant is what the Type
   chips one column away already answer; the split is what this field is for. */
{
  const kind = type => t.mainType({ type });
  assert.strictEqual(t.MAIN_ORDER.join(), 'Main,NotMain', 'main type is not a binary any more');
  for (const type of ['Creature - Elf Druid', 'Legendary Creature - Human',
    'Artifact Creature - Golem', 'Enchantment Creature - Nymph',
    'Legendary Planeswalker - Jace', 'Instant', 'Sorcery',
    'Enchantment - Aura', 'Artifact - Equipment'])
    assert.strictEqual(kind(type), 'Main', `"${type}" is not a card you build a deck out of`);
  // Plane is \b-bounded in the veto so it cannot eat Planeswalker - the one
  // collision in that list, and the reason the assertion above names Jace
  assert.strictEqual(kind('Plane - Dominaria'), 'NotMain', 'the Planeswalker guard let a Plane through');
  // ...and everything Stuart named as not-main, however it is dressed
  for (const type of ['Basic Land - Forest', 'Artifact Land', 'Snow Land - Mountain',
    'Token Creature - Spirit', 'Battle - Siege', 'Emblem', 'Scheme', 'Plane - Dominaria',
    'Phenomenon', 'Vanguard', 'Conspiracy', 'Dungeon', 'Card', 'Hero'])
    assert.strictEqual(kind(type), 'NotMain', `"${type}" is being filed as a main type`);
  /* NO TYPE LINE IS NOT A DECK CARD. An unmatched import row has none, and Main
     is a claim about something you would build with - unknown belongs on the
     same side as the tokens. */
  for (const c of [{}, { type: '' }, { type: '   ' }])
    assert.strictEqual(t.mainType(c), 'NotMain', 'a card with no type line was filed as a deck card');
  // the sort key is the position in that order, so the misc pile lands last
  assert.strictEqual(t.SORT_KEY.kind({ type: 'Creature' }), 0, 'deck cards do not sort first');
  assert.strictEqual(t.SORT_KEY.kind({ type: 'Basic Land - Forest' }), t.MAIN_ORDER.length - 1,
    'NotMain does not sort last');
  // and the mocks carry &mdash; rather than a real dash, which used to leave the
  // whole type line standing in for its head
  // the mocks carry &mdash; rather than a real dash, which used to leave the
  // whole type line standing in for its head
  assert.strictEqual(kind('Creature &mdash; Sliver'), 'Main', 'an entity dash broke the type head');
  /* CASE FOLDING came out of running the classifier over the catalogue rather
     than out of reasoning about it: the type line is not reliably capitalised,
     one card says "instant" and one says "pLAnE", and only the second of those
     can be got wrong now - the veto is the only thing being matched. */
  assert.strictEqual(kind('pLAnE'), 'NotMain', 'case folding let a plane through as a deck card');
  /* Portal's "Summon Wolf" - 12 printings - needed an alias only while the
     answer had to be the word "Creature". The veto does not match it, so it
     files as Main with no special case, which is the right answer either way. */
  assert.strictEqual(kind('Summon Wolf'), 'Main', 'a Portal creature is filed as misc');
}

// a sort you actually chose is yours, and survives the tab you set it in
ctx.location.hash = '#/binders'; t.render();
setSort([{ f: 'name', d: 'a' }]);
ctx.location.hash = '#/decks'; t.render();
assert.strictEqual(t.P.sort.map(x => x.f).join(), 'name', 'leaving a binder discarded a sort you set');
setSort([]);

/* --- the three things a card face has to get right ------------------- */
// 1. the set symbol, inked by rarity, where the placeholder disc used to be
const mkmCard = { n: 'Delney, Streetwise Lookout', set: 'MKM', num: '378', lang: 'en',
  col: 'W', cost: ['2', 'W'], type: 'Legendary Creature - Human Scout', rar: 4, pt: '2/2', text: 'Flying' };
const marked = t.MockCard(mkmCard);
assert.ok(marked.includes('svgs.scryfall.io/sets/mkm.svg'), 'the set symbol is not drawn');
assert.ok(/mask:url\('https:\/\/svgs\.scryfall\.io[^']+'\) center\/contain/.test(marked),
  'the symbol is an image, so rarity cannot tint it - it has to be a mask');
assert.ok(marked.includes(t.RARITY_DOT[4]), 'the set symbol is not inked with the rarity colour');
// a sub-set borrows its parent's icon, which is why the slug is stored at all
const tokens = t.SETS.find(r => r[1] === 'TMKM');
assert.strictEqual(tokens[7], 'mkm', 'TMKM no longer shares the MKM icon, so this stops testing the slug');
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
   threshold that drifts past it puts text outside its box - which is how the
   first pass at "a few sizes larger" broke 120 of 240 cards. */
for (const [size, overflowsAt] of [[1.09, 144], [1, 207], [0.91, 274], [0.82, 372]]) {
  const px = n => parseFloat(t.textFit(n).match(/[\d.]+/)[0]);
  assert.ok(px(overflowsAt - 1) <= size,
    `${size}em is still used at ${overflowsAt - 1} characters, where it overflows`);
}
/* A NEWLINE COSTS SPACE ITS CHARACTERS DO NOT, and the ladder was measured
   against paragraphs. A forced break leaves the tail of the previous line empty,
   so text of many short lines is taller than the same characters flowing - which
   is why 4 of 279 banded cards overflowed on 164-240 characters while sixty
   ordinary cards with more than 200 overflowed none. `fitLen` charges half a
   line per break, and it is the same ladder underneath: no new step, no new size. */
{
  const one = 'x'.repeat(96);
  const many = Array.from({ length: 8 }, () => 'x'.repeat(12)).join('\n');
  assert.strictEqual(one.length, many.replace(/\n/g, '').length, 'the two fixtures are not the same length');
  assert.ok(t.fitLen(many) > t.fitLen(one), 'a break costs nothing, so banded text is measured as a paragraph');
  assert.strictEqual(t.fitLen(one), 96, 'text with no break is charged for one');
  // ...and it reaches the ladder: same characters, smaller type when they are lines
  assert.ok(parseFloat(t.textFit(t.fitLen(many)).match(/[\d.]+/)[0])
    < parseFloat(t.textFit(t.fitLen(one)).match(/[\d.]+/)[0]),
    'eight lines are set at the same size as one paragraph of the same length');
  // a real Leveler is the case this exists for: 175 characters over 8 lines
  const kargan = 'Level up {R}\nLEVEL 1-3\n3/3\nFirst strike\nLEVEL 4-7\n4/4\nFirst strike, flying\nLEVEL 8+\n8/8\nFirst strike, flying, trample';
  assert.ok(t.fitLen(kargan) > kargan.length + 100,
    'a ten-line Leveler is barely charged for its bands');
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
  /* A COMPACT ROW IS THE CARD'S TITLE PLATE, so it sizes in em off the row's own
     font size - em has something to resolve against anywhere. What it must not
     pick up is cqw, which needs the container query the list has not got. */
  const row = t.TitleRow({ n: 'Noble Hierarch', cost: ['1', 'G'], set: 'CON', col: 'G' });
  assert.ok(!/cqw/.test(row), 'the list row went container-relative with no container to measure');
  assert.ok(/text-\[[\d.]+em\]/.test(row), 'the row does not size off its own text');
  /* ...and it is the SAME plate, not one that matches today: both come from
     plateOf, so a change to the mix reaches the card and the list together. */
  const green = { n: 'Llanowar Elves', cost: ['G'], col: 'G', type: 'Creature - Elf' };
  assert.ok(t.TitleRow(green).includes(t.plateOf(green).title), 'the row does not use the card plate');
  assert.ok(t.MockCard(green).includes(t.plateOf(green).title), 'the card no longer uses its own plate');
  assert.ok(t.TitleRow(green).includes(t.frameOf(green)), 'the row is not wrapped in the frame colour');
  // a multicolour card is gold in the list exactly as it is on the card, and the
  // gold is SURFACE.M rather than a hex typed twice - measured off six printings
  assert.strictEqual(t.frameOf({ col: 'GW' }), t.SURFACE.M[0], 'multicolour lost its gold');
  assert.ok(t.TitleRow({ n: 'X', col: 'GW' }).includes(t.SURFACE.M[0]), 'a gold card is not gold in the list');
  /* THE THREE SURFACES ARE THREE, and the two the print makes PALE are pale.
     Every plate used to be `color-mix(45%, #000)` - the frame darkened by more
     than half - so the title bar came out darker than the printed one and the
     rules box came out light-on-dark, which no printed Magic card is. Measured
     off the scans: a Swamp-frame card is #1f201c on the rail and #eae9ed in its
     text box, so the box is asserted LIGHTER than the rail on every colour,
     black included. */
  for (const [k, [rail, type, box]] of Object.entries(t.SURFACE)) {
    assert.ok(t.lum(box) > t.lum(rail), `${k}: the text box is not lighter than the frame rail`);
    assert.ok(t.lum(box) > 0.7, `${k}: the text box is not a pale tint`);
    assert.ok(t.lum(type) > t.lum(rail), `${k}: the type bar is not lighter than the frame rail`);
  }
  // ...and the title bar is the frame itself, separated by an edge rather than by tone
  const swamp = { n: 'Duress', col: 'B' };
  assert.ok(t.plateOf(swamp).title.includes(t.FRAME.B), 'the title bar is no longer the frame colour');
  assert.ok(/box-shadow:inset/.test(t.plateOf(swamp).title), 'the title bar lost the edge that separates it');
  assert.ok(t.plateOf(swamp).box.includes(t.SURFACE.B[2]), 'the rules box is not the measured text-box tint');
  /* A TRANSFORM'S BACK GETS ITS OWN TINTS. The bg override always carried the
     back's frame colour; the tints would have kept the front's, so a red front
     with a blue back drew a blue rail over a red text box. */
  assert.ok(t.plateOf({ col: 'R' }, t.FRAME.U, 'U').box.includes(t.SURFACE.U[2]),
    'the back face keeps the front face\'s text box');
}

// 3. rules text renders its symbols
const tapped = t.MockCard({ n: 'Elf', text: '{T}: Add {G}. Pay {2} or {U/P}.' });
assert.ok(!/\{T\}|\{G\}|\{2\}/.test(tapped), 'rules text is still printing braces instead of symbols');
assert.ok(tapped.includes(t.glyphOf('T')), 'the tap symbol is not rendered');
assert.ok(tapped.includes(t.glyphOf('G')) && tapped.includes(t.glyphOf('2')),
  'a colour or a number in rules text lost its glyph');
/* A SPLIT PIP IS DRAWN, NOT SPELLED. This asserted the opposite until the font
   was read properly: it has no single codepoint for {U/P}, and it composes one
   from the glyphs it does have. Phyrexian is the half that needs no split -
   {U/P} is one Φ on a blue disc - so the test is that the disc is blue, the mark
   is Φ, and the characters "U/P" appear nowhere. */
assert.ok(!tapped.includes('>U/P<'), 'a split symbol is still being spelled out instead of drawn');
assert.ok(tapped.includes(`background:${t.MTG.U};color:${t.INK.U}`), 'Phyrexian blue lost its own disc');
assert.ok(tapped.includes(t.glyphOf('P')), 'the Phyrexian mark is not rendered');
/* THE FIVE FAMILIES ARE NOT ONE RULE, and the catalogue has all five: 10 hybrid
   pairs, 5 twobrid, 6 Phyrexian, 5 colourless hybrids and 4 Phyrexian hybrids
   over 1,501 printings. Each is asserted for the thing that makes it different
   from its neighbours, because one recipe that happens to pass for {W/U} can be
   wrong for {R/W/P} in a way no shared assertion would notice. */
{
  const halves = s => [...s.matchAll(/<i class="ms[^>]*>([^<]*)<\/i>/g)].map(m => m[1]);
  const P = t.glyphOf('P');
  const pair = t.pipOf('W/U');
  assert.deepStrictEqual(halves(pair), [t.glyphOf('W'), t.glyphOf('U')], 'a hybrid lost one of its two marks');
  assert.ok(pair.includes(`linear-gradient(135deg,${t.MTG.W} 0%,${t.MTG.W} 50%,${t.MTG.U} 50%,${t.MTG.U} 100%)`),
    'the disc is not split down the diagonal into the two colours');
  // twobrid: the generic half is a number on the neutral disc, not a colour
  assert.deepStrictEqual(halves(t.pipOf('2/R')), [t.glyphOf('2'), t.glyphOf('R')], 'a twobrid lost its 2');
  assert.ok(t.pipOf('2/R').includes('#cdc6bf'), 'the generic half of a twobrid took a colour it has not got');
  // Phyrexian: ONE mark on the colour's own disc, and no gradient at all
  const phy = t.pipOf('G/P');
  assert.deepStrictEqual(halves(phy), [P], 'Phyrexian mana is drawn as a split when it is one mark');
  assert.ok(!phy.includes('gradient') && phy.includes(t.MTG.G), 'Phyrexian lost its colour');
  /* ...and a Phyrexian hybrid is the odd one out twice over: a split disc like a
     hybrid, but ONE Φ centred across it rather than a mark per half. Checked
     against the printed symbol, not inferred from the other two families. */
  const both = t.pipOf('R/W/P');
  assert.deepStrictEqual(halves(both), [P], 'a Phyrexian hybrid draws a mark per half instead of one across the split');
  assert.ok(both.includes(`${t.MTG.R} 50%,${t.MTG.W} 50%`), 'a Phyrexian hybrid lost its two colours');
  // colourless hybrid, the family that reads as a colour and is not one
  assert.deepStrictEqual(halves(t.pipOf('C/W')), [t.glyphOf('C'), t.glyphOf('W')], 'a colourless hybrid lost a mark');
  // the fallback still exists for anything genuinely unknown
  assert.ok(t.pipOf('QQ').includes('>QQ<'), 'an unknown symbol no longer falls back to its text');
  /* A TWOBRID PIP IS WORTH TWO. Flame Javelin is {2/R}{2/R}{2/R} - a six-mana
     card the range filter was placing at three. The other split families are
     worth one each, and X is worth none. */
  const mv = cost => t.manaValue({ cost });
  assert.strictEqual(mv(['2/R', '2/R', '2/R']), 6, 'a twobrid pip counts as one instead of two');
  assert.strictEqual(mv(['1', 'G/W', 'G/W']), 3, 'a hybrid pip stopped counting as one');
  assert.strictEqual(mv(['U/P']), 1, 'a Phyrexian pip stopped counting as one');
  assert.strictEqual(mv(['X', 'R']), 1, 'X is being counted as mana');
}
assert.strictEqual(t.glyphOf('15'), String.fromCodePoint(0xe614), 'the digit run does not reach {15}');
assert.strictEqual(t.glyphOf('16'), '', 'a number past the font pretends to have a glyph');
// symbols must not become an injection point now that text is parsed
assert.ok(!t.symbolise('<img src=x onerror=alert(1)>').includes('<img'), 'rules text renders raw HTML');
assert.ok(t.symbolise('a &mdash; b').includes('&mdash;'), 'escaping broke the entities the mocks use');

// A NAME IS THE WHOLE MINIMUM. /resolve draws this frame from a scanned line
// before any printing is known, so every other slot has to degrade on its own -
// and degrade to nothing, not to a default. "Common" invented from a missing
// rarity is worse than a blank, because it reads as a fact.
const bare = t.MockCard({ n: 'Lighming Bolt' });
assert.ok(bare.includes('Lighming Bolt'), 'the frame lost the one field it must have');
for (const leak of ['undefined', 'NaN', 'null'])
  assert.ok(!bare.includes(leak), `a name-only card leaked "${leak}" into the frame`);
assert.ok(/min-h-\[36%\] max-h-\[58%\]/.test(bare) && bare.includes('no printing'),
  'a name-only card is missing the art window or claims a printing');
for (const invented of ['Common', 'Nonfoil', 'Mythic'])
  assert.ok(!bare.includes(invented), `a name-only card invented "${invented}"`);
// ...and the same for the anatomy the card page reads off it
const bareFacts = Object.entries(t.factsOf({ n: 'Lighming Bolt' }));
for (const [k, v] of bareFacts)
  assert.ok(k === 'Legality' || !v, `a name-only card claims to know "${k}" (${v})`);
// pokemon exercises the other half of the frame: HP, attacks, retreat, no cost
t.pickGame('pokemon');
const pkmCards = t.scopedCards();
for (const kind of ['Basic', 'Stage 1', 'Stage 2', 'V ', 'ex ', 'Trainer', 'Energy'])
  assert.ok(pkmCards.some(c => c.type.includes(kind)), `no ${kind.trim()} in the pokemon fixtures`);
assert.ok(pkmCards.some(c => c.hp) && pkmCards.some(c => !c.hp), 'every pokemon fixture has HP, or none does');
assert.ok(pkmCards.some(c => c.atk) && pkmCards.some(c => c.retreat), 'no attacks or no retreat cost');
assert.ok(t.MockCard(pkmCards[0]).includes('HP'), 'the pokemon frame does not show HP');
/* The kit draws the real frame, not a picture of one - and it draws the HEAD OF
   THE SORTED LIST, which is what this now asserts against. It used to name
   `scopedCards()[0]`, the first card in scope UNSORTED, and passed only while
   the default order happened to put the same card first: changing main type to
   a binary reordered the head and failed an assertion that was never about the
   sort at all. */
t.pickGame('mtg'); go('#/kit');
assert.ok(painted.includes('aspect-[5/7]') && painted.includes(t.CARDS()[0].n),
  'the control kit does not draw the card frame the rest of the app uses');

/* The name has to be readable on every frame, which a hardcoded "dark frames"
   list does not deliver. Asserted over the REAL surfaces now - the four plates
   `plateOf` hands out - rather than over the frame and a 45%-over-black mix,
   which is the model that got deleted when the printed colours were measured.
   Two invariants, neither of them a threshold that happens to hold today:
     the ink is the BETTER of the two on that surface, and
     it either clears the 4.5:1 body-text floor or carries an outline.
   The second is why the outline exists: the measured green frame #5d7f5b is a
   dead tie at 3.92 and 3.91, so on green NEITHER ink clears, and the collector
   line printed on it is 0.73em. A list of colours to except would go stale the
   next time the palette is measured; this does not. */
const surfaces = c => Object.values(t.plateOf(c))
  .map(s => [/background-color:(#[0-9a-f]{6})/.exec(s)[1], /;color:(#[0-9a-f]{6})/.exec(s)[1], /text-shadow/.test(s)]);
for (const c of [...mtgCards, ...pkmCards]) {
  for (const [bg, chosen, outlined] of surfaces(c)) {
    const other = chosen === '#1a1a1a' ? '#f0f0f0' : '#1a1a1a';
    assert.ok(t.contrast(chosen, bg) >= t.contrast(other, bg),
      `${c.n}: the other ink reads better on ${bg} - the luminance test is backwards`);
    assert.ok(t.contrast(chosen, bg) >= 4.5 || outlined,
      `${c.n}: ${t.contrast(chosen, bg).toFixed(2)}:1 on ${bg} and no outline to carry it`);
    assert.ok(t.contrast(chosen, bg) >= 3, `${c.n}: ${t.contrast(chosen, bg).toFixed(2)}:1 on ${bg} is below the large-text floor`);
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
// from a card page, a tab click gets you back cleared - same as Back
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
assert.ok(/openCard\('[^']+','[^']*'\)/.test(painted),
  'a result row does not open the printing it drew');
t.openCard('Noble Hierarch');
assert.strictEqual(ctx.location.hash, '#/card', 'opening a card did not navigate');
/* OPENING A CARD FROM THE CATALOGUE IS NOT AN IMPORT. This asserted the opposite
   and the opposite was the bug: clicking a real printing in a real list landed on
   "unmatched - everything unknown until this line is matched", which is the
   import story told about a card nobody imported. The story still holds for a
   flat line and every assertion about it below still runs; it is reached by the
   Unmatch button now rather than by looking at a card. */
assert.strictEqual(t.P.matched, true, 'a card opened from the catalogue arrives unmatched');
assert.ok(painted.includes('>matched<'), 'the card page does not say it is matched');
t.setMatched(false);
assert.ok(painted.includes('>unmatched<'), 'the card page does not say it is unmatched');
// the source line is shown verbatim and every parsed token with it - built from
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
// unmatched draws the SAME frame, fed the one field a card must have - and the
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
// the fields are the game's, not the page's - the registry claim again
t.pickGame('pokemon'); t.openCard('Pikachu'); t.setMatched(true);
for (const l of ['HP', 'Stage', 'Retreat cost', 'Illustrator'])
  assert.ok(painted.includes(`>${l}</span>`), `the pokemon card page is missing "${l}"`);
assert.ok(!painted.includes('>Toughness</span>'), 'the pokemon card page leaked MTG anatomy');
/* THE HOLDINGS BAND IS FOLDED INTO THE PRINTINGS LIST. It was a second list of
   the same cards under the same page, from when the printings list had no
   quantity column and could not say what you owned. Qty is a column everywhere
   now, so the band was one answer given twice - and two lists of the same cards
   on one page is how they come to disagree. What it carried that a column does
   not is WHERE, so a held printing names its containers on its own row. */
t.setMatched(false);
assert.ok(!painted.includes('>holdings<'), 'the holdings band is back as a section of its own');
assert.ok(painted.includes('>printings<') || painted.includes('>candidates<'),
  'the printings band went with it');
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
assert.strictEqual(t.P.filterDraft.cost.join(','), 'Snow', 'toggling one symbol did not select just it');
t.toggleCost('X'); t.toggleCost('Phyrexian');
assert.strictEqual(t.P.filterDraft.cost.length, 3, 'the three symbols are not independently selectable');
assert.strictEqual((mv().match(/border-emerald-500/g) || []).length, 3, 'a selected symbol is not marked');
t.toggleCost('X'); t.toggleCost('Snow'); t.toggleCost('Phyrexian');
assert.strictEqual(t.P.filterDraft.cost.length, 0, 'a symbol would not toggle back off');

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
assert.strictEqual(t.P.filterDraft.colours.length, 0, 'the colour slicer starts with a selection');
assert.strictEqual(t.P.filterDraft.comboMode, 'contained', 'the default mode is not contained');
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
  assert.ok(/hintCombo\('[^']+ - \d+ cards'\)/.test(first), `${label}: dropped a label with no hover`);
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

// name, then the marks, then the count - the marks are what the two flanking
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
assert.ok(!/hintCombo\('\s*-/.test(combo()), 'a hover hint has no name');
assert.strictEqual([...combo().matchAll(/onmouseenter="hintCombo\('[^']+ - \d+ cards'\)"/g)].length,
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
// this is the whole "ready for another TCG" claim - assert it, don't trust it
for (const [k, g] of Object.entries(t.GAMES)) {
  t.pickGame(k);
  setSort([{ f: 'colour', d: 'a' }, { f: 'rarity', d: 'd' }, { f: 'BREAK' }, { f: 'name', d: 'a' }]);
  t.P.view = 'grid';
  go('#/printings');
  // every labelled group renders; "combos" is the one that draws its own header
  for (const [, label] of g.anatomy)
    if (label) assert.ok(painted.includes(`>${label}<`), `${k}: anatomy missing "${label}"`);
  // the order is the order you narrow in: what a card is legal for, what it
  // costs, then what it is - the rest is book-keeping and collapses away
  const drawn = g.anatomy.map(x => x[0] === 'combos' ? 'Colour' : x[1]);
  const at = l => painted.indexOf(`>${l}<`);
  for (let i = 1; i < drawn.length; i++)
    assert.ok(at(drawn[i - 1]) < at(drawn[i]),
      `${k}: "${drawn[i]}" is not drawn after "${drawn[i - 1]}"`);
  /* LANGUAGE IS FIRST, and it is the only group that arrives already set. It
     is at the top because it is the one you open to WIDEN rather than to
     narrow, which is the opposite of every group under it, and because a
     narrowing that arrives applied has to be the first thing you see. */
  if (k === 'mtg') assert.strictEqual(drawn.slice(0, 8).join(' > '),
    'Language > Legality > Colour > Mana value > Type > Subtype > Keywords > Rarity',
    'the main filter order changed');
  // rarely-browsed groups collapse into "Other" - FilterSidebar's own order
  const rare = g.anatomy.filter(x => (x[3] || {}).other);
  assert.ok(rare.length, `${k}: nothing is filed under Other`);
  assert.ok(painted.includes('>Other</summary>'), `${k}: no collapsible Other group`);
  const otherAt = painted.indexOf('>Other</summary>');
  for (const [, label] of rare)
    assert.ok(painted.indexOf(`>${label}<`) > otherAt, `${k}: "${label}" should be under Other`);
  for (const f of g.sort) {
    // the label the chip actually carries, read off the app's own table rather
    // than a copy of it here: `capitalize` is not enough for an acronym, and
    // the short forms (Lang, #) are the same ones the details header uses
    const lbl = t.fieldLabel(f);
    assert.ok(painted.includes(`>${lbl}</button>`) || painted.includes(`>${lbl}</span>`),
      `${k}: sort field "${f}" is not offered`);
  }
  assert.ok(!painted.includes('>Hp<'), `${k}: "capitalize" mangled an acronym`);
  /* LANGUAGE CAME OUT OF "OTHER", where it was filed as rarely narrowed. That
     was true of a catalogue that could not answer the question: `default-cards`
     is one row per printing and 104,713 of 107,347 are English, so the group
     had six chips and five of them read as curiosities. Against the language
     index it is 63,990 printings in more than one language and eleven codes
     over twenty thousand printings each - a group that is always in force,
     which cannot be behind a fold. */
  assert.ok(!rare.some(x => x[1] === 'Language'), `${k}: Language is back under Other, where it cannot be seen to be applied`);
  assert.ok(painted.indexOf('>Language<') < otherAt, `${k}: Language is drawn after the Other fold`);
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
  // it has to stay one line tall - name + numbers + Export + Clear wrapped once
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
// the scope no longer lives in the sidebar at all - the subheader replaced it
go('#/search');
assert.strictEqual((painted.slice(painted.indexOf('<main')).match(/>scope</gi) || []).length, 0,
  'the sidebar still has a scope band - the subheader replaced it');

// --- the page's headline number lives in the top bar, not above the body -
// match the Stats container itself, not its words - "cards in Magic" also shows
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
for (const v of ['grid', 'compact', 'details'])
  assert.ok(sortBar.includes(`setView('${v}')`), `sort bar is missing the "${v}" display type`);
// ...and the three card layouts are all Printings offers: the binder belongs to
// Binders, where the container that owns a page shape actually is
for (const v of ['binder', 'deck'])
  assert.ok(!sortBar.includes(`setView('${v}')`), `the "${v}" layout is back on Printings`);
// the order is a list you rearrange, not one you rebuild
const order = () => sortBarNow().slice(sortBarNow().indexOf('>Group order<'));
assert.ok(!/border-dashed/.test(order()), 'an order chip is still dashed');
// every chip is the same shape in or out of the order, so clicking one does
// not shove the row sideways
setSort([{ f: 'rarity', d: 'a' }, { f: 'BREAK' }, { f: 'set', d: 'd' }]);
const slots = l => [...l.matchAll(/w-3 shrink-0 text-center/g)].length;
assert.strictEqual(slots(order()) % 2, 0, 'an order chip is missing its rank or direction slot');
/* Every field is offered ONCE, in the zone its role puts it in - category
   fields make pages, continuous ones arrange them - and each chip carries both
   slots so adding one does not shove the row sideways. */
{
  const staged = t.P.sortDraft.filter(x => x.f !== 'BREAK').length;
  const free = t.GAMES.mtg.sort.filter(f => !t.P.sortDraft.some(x => x.f === f));
  assert.strictEqual(slots(order()), 2 * (staged + free.length),
    'staged and unstaged chips are not the same shape');
}
// one control, three states - the same vocabulary as the include/exclude chips
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
// colour is the only thing that changes - the chip must not resize as it cycles
t.addSort('name');
const wide = slots(order());
t.cycleSort(0);
assert.strictEqual(slots(order()), wide, 'reversing a term changed the chip shape');
// the starting state has to be legal too: `name` is sort-only now, so it can no
// longer sit left of the break even as a fixture
setSort([{ f: 'BREAK' }, { f: 'name', d: 'a' }, { f: 'rarity', d: 'd' }]);

// drag reorders in place rather than dropping the term and losing the rest
// index 0 is the first STAGED term wherever it sits; with a zone empty the
// first draggable may be any index, so the test is that staged chips drag at all
assert.ok(/draggable="true"[^>]*ondragstart="dragSort\(\d+\)"/.test(order()), 'order chips are not draggable');
t.dragSort(2); t.moveSort(0);
assert.strictEqual(t.P.sortDraft.map(x => x.f).join(','), 'rarity,BREAK,name',
  'dragging a term did not move it');
/* ...and a SORT-ONLY field cannot be dragged left of the break at all. This
   case used to depend on how many cards happened to be in front of you: the
   role was counted over the current scope, so `set` was a grouping inside a
   small binder and not in Search, and this very fixture passed only because 18
   mocks hold fewer than twenty sets. Refused rather than corrected - a drop
   that would make 986 pages meant something else. */
setSort([{ f: 'rarity', d: 'a' }, { f: 'BREAK' }, { f: 'set', d: 'd' }]);
t.dragSort(2); t.moveSort(0);
assert.strictEqual(t.P.sortDraft.map(x => x.f).join(','), 'rarity,BREAK,set',
  'a sort-only field was dragged left of the break, where it makes a page per value');
assert.strictEqual(t.P.sortDraft.length, 3, 'dragging lost a term');
t.dragSort(0); t.moveSort(0);
assert.strictEqual(t.P.sortDraft.map(x => x.f).join(','), 'rarity,BREAK,set', 'a no-op drag changed the order');
setSort([]);

// display first, order second, and on one line
assert.ok(sortBar.indexOf('>Display<') < sortBar.indexOf('>Group order<'), 'the display is not first');
/* A ZONE ONLY OFFERS WHAT IT CAN TAKE, so an impossible arrangement is never on
   the screen rather than refused after the fact: the group zone lists the
   category fields and the sort zone lists the rest. EACH FIELD IN ONE ZONE
   ONLY - a category field used to be offered in both, so Language appeared on
   the bar twice and read as two fields. */
{
  // from a known empty order, so every field is on offer and the zones can be
  // read for what they WILL take rather than what happens to be staged
  setSort([{ f: 'BREAK' }]);
  const bar = sortBarNow();
  const gz = bar.slice(bar.indexOf('>Group order<'), bar.indexOf('>Sort order<'));
  const sz = bar.slice(bar.indexOf('>Sort order<'));
  assert.ok(gz.includes("addSortTo('rarity','group')"), 'a category field is not offered as a grouping');
  for (const f of ['set', 'number', 'release', 'name'])
    assert.ok(!gz.includes(`addSortTo('${f}','group')`), `"${f}" is offered as a page grouping`);
  for (const f of ['set', 'number'])
    assert.ok(sz.includes(`addSortTo('${f}','sort')`), `"${f}" cannot be added to the sort order`);
  for (const f of ['rarity', 'language', 'colour'])
    assert.ok(!sz.includes(`addSortTo('${f}','sort')`),
      `"${f}" is offered in both zones, so the bar names it twice`);
  // ...and clicking one lands it on the side its zone names
  t.addSortTo('rarity', 'group'); t.addSortTo('set', 'sort');
  assert.strictEqual(t.P.sortDraft.map(x => x.f).join(','), 'rarity,BREAK,set',
    'a field did not land in the zone it was added from');
  setSort([{ f: 'BREAK' }]);
}
assert.strictEqual([...sortBar.matchAll(/setView\('(\w+)'\)/g)].map(m => m[1]).join(','),
  'compact,details,grid', 'the display order changed');
/* EACH CONTAINER LAYOUT BELONGS TO ITS OWN TAB AND NOWHERE ELSE. A binder
   layout of a deck is not a thing, a deck layout of a set is not a thing, and
   the binder layout of a SET was a thing until it was taken out: it drew the
   catalogue as pages of pockets, which looks like your collection and is a list
   of every card Wizards printed. */
go('#/decks');
const deckBar = painted.slice(painted.indexOf('>sort<'), painted.indexOf('>view<'));
assert.ok(deckBar.includes("setView('deck')") && !deckBar.includes("setView('binder')"),
  'the decks tab offers binder, or withholds deck');
go('#/printings');
const printBar = painted.slice(painted.indexOf('>sort<'), painted.indexOf('>view<'));
assert.ok(!printBar.includes("setView('binder')") && !printBar.includes("setView('deck')"),
  'printings offers a container layout for a thing that is not a container');
// and the three card layouts survive on both, which is what those tabs are for
for (const v of ['compact', 'details', 'grid'])
  assert.ok(printBar.includes(`setView('${v}')`) && deckBar.includes(`setView('${v}')`),
    `the "${v}" layout went missing from printings or decks`);
// binders renders no chooser at all - its one layout is stated in the band note
go('#/binders');
assert.ok(!/setView\('\w+'\)/.test(painted), 'the binders tab still renders a display button');
assert.ok(/binder &mdash; the only layout here/.test(painted),
  'with no chooser, the binders view band does not say what it is drawing');
go('#/printings');
/* ONE CONTROL, ONCE - and it needs a display CHOSEN to be a fair test. With
   none picked the results band deliberately offers the chips a second time as
   its empty state ("No display chosen"), which is the one case where two is
   right. Coming straight off the binders tab leaves P.view unset here, because
   the tab guard drops a layout the new tab does not offer. */
t.setView('grid'); t.render();
assert.strictEqual(painted.match(/setView\('grid'\)/g).length, 1, 'display type is rendered twice');
// what a break means lives on each layout's own tooltip, not a paragraph
assert.ok(/title="break = a new row"[^>]*>\s*<span[^>]*>[^<]*<\/span>grid</.test(painted),
  'the grid layout does not say what a break means');

// --- BREAK: grouping is everything left of it, in every layout ---------
setSort([{ f: 'colour', d: 'a' }, { f: 'rarity', d: 'd' }, { f: 'BREAK' }, { f: 'name', d: 'a' }]);
// join rather than deepStrictEqual: arrays from the vm realm have a different prototype
assert.strictEqual(t.grouping().map(x => x.f).join(','), 'colour,rarity',
  'grouping is not the sort terms left of the break');
/* ...ON THE TAB THAT OFFERS EACH ONE. This ran all five against Printings,
   which worked only while Printings offered the binder layout. The container
   layouts are now on their own tabs, so the loop goes where they live - and a
   container has to be PICKED first, because until then the tab is its selector
   rather than the inside of one. */
for (const [view, marker, route] of [
  ['grid', 'Green', '#/printings'], ['compact', 'Green', '#/printings'], ['details', 'Green', '#/printings'],
  ['binder', 'Page 1', '#/binders'], ['deck', 'cards', '#/decks']]) {
  go(route);
  if (route === '#/binders') t.selectItem(t.LISTS.binders[0][0]);
  if (route === '#/decks') t.selectItem(t.LISTS.decks[0][0]);
  t.setView(view); t.render();
  assert.ok(painted.includes(marker), `break not honoured in the ${view} layout (no "${marker}")`);
}
t.clearItem(); go('#/printings'); t.setView('grid'); t.render();

// --- printings: indented, fixed order, no search over SETS -------------
// the card filter is fine and intended; the rule is that the SET LIST has no
// search and no sort - its order is fixed by block + release date
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
/* THE PAGE NAMES THE SOURCES IT CAN ACTUALLY MAP, which is the column map's own
   list - names as Archidekt's own importer spells them, see
   docs/import-formats.md. It used to name ten, because a Source dropdown offered
   ten; that control read nothing (readImport auto-detects by header, 144/144 on
   the sample and 2,453/2,607 on the real export) and three of its options -
   Helvault, Archidekt, Deckstats - had no column in the table below it. */
for (const s of t.COLS) assert.ok(painted.includes(s), `import is missing the "${s}" source`);
assert.ok(!/>Auto-detect</.test(painted),
  'the Source dropdown is back, and nothing reads it any more than it did before');
/* LANGUAGE HAS A COLUMN. This used to assert `NO COLUMN YET` was on the page -
   asserting the drift, not the behaviour. That string described the DELETED
   Postgres app's `cards` table, while the schema map two bands below on the same
   page listed `lang` as a column of `mtg_card_printings`, so the page
   contradicted itself and the check pinned the wrong half. Language is read off
   the printing, is in `printKey`, and reaches the import line. */
assert.ok(!painted.includes('NO COLUMN YET'), 'the import map still claims language has nowhere to land');
{
  const lang = t.CANON.find(r => r[0] === 'language');
  assert.ok(lang && /lang/.test(lang[1]), 'language maps to no column');
  assert.strictEqual(lang[lang.length - 1], 1, 'language is still flagged as unrepresentable');
  // ...and it is not merely storable: it is in the key and on the flat line
  assert.ok(t.printKey({ set: 'X', num: '1', lang: 'ja' }).endsWith('/ja'), 'the identity key drops language');
  assert.ok(t.flatLine({ n: 'A', set: 'X', num: '1', lang: 'ja' }).includes('[ja]'), 'the import line drops language');
  // external ids identify nothing this app needs - set, number and language do
  assert.ok(!t.CANON.some(r => /uid|uuid/i.test(r[0])), 'the column map still carries an external id');
}
assert.ok(painted.includes('Resolve ambiguous'), 'no ambiguous-row resolver');
// the grouping step is a one-off, and says so
assert.ok(/one-off/.test(painted), 'the grouping step is not marked as a one-off');
/* THE GROUPS IN THE FILE YOU LOADED, and with no file there are none. This
   listed Main 2410 rows, Mono-Red Burn 74, Trade box 312, (blank) 94 - an import
   that had never run, with counts precise enough to read as one that had. */
assert.strictEqual(t.IMPORT_GROUPS.length, 0, 'a fresh app has groups from a file nobody chose');
assert.ok(painted.includes('Choose a file above'), 'the grouping step invents groups');
for (const g of ['Trade box', '2410 rows']) assert.ok(!painted.includes(g), `the hardcoded group "${g}" is back`);
// ...and once a file is read, each group is a row that can go to any of the three
t.IMPORT_GROUPS.push(['Main', 2410, 'binder'], ['(blank)', 94, '']);
ctx.location.hash = '#/io'; t.render();
assert.ok(/>binder<[\s\S]{0,400}>box<[\s\S]{0,400}>deck</.test(painted), 'grouping column cannot designate binder/box/deck');
// ...and the three are CONTROLS now, not captions: they were chips with no
// handler under a Run button with no handler, describing a decision nothing took
for (const k of ['binder', 'box', 'deck'])
  assert.ok(painted.includes(`setGroupKind('Main','${k}')`), `the "${k}" choice does nothing`);
/* "SKIPPED", NOT "UNSORTED" -- and the word had to change because Apply now
   runs. Unsorted read as a place the cards would land; a group with no kind is
   one applyImport writes nowhere, and saying so is the difference between a
   default you accepted and cards you cannot find afterwards. */
assert.ok(painted.includes('&rarr; skipped'), 'a group sent nowhere does not say where it lands');

/* AN AMBIGUOUS ROW YOU CAN ACTUALLY DO SOMETHING WITH. The section rendered 154
   rows of ranked candidates whose tiles and Skip button had no handlers, so the
   only available action was to leave it - the inert Run button one screen down,
   again. Both directions are asserted because they are different outcomes: a
   pick writes the holding you meant, a skip records that you declined. */
{
  const before = t.IMPORT_MATCHED.length, skipped = t.IMPORT_SKIPPED;
  const cand = (set, num) => ({ n: 'Terminate', set, num, lang: 'en', rar: 2, usd: 5.82 });
  const row = () => ({ line: { n: 'Terminate', set: 'FNM', num: '1', qty: 2, foil: 1, lang: 'ja' },
    why: '2 printings match', hold: { qty: 2, foil: 1, lang: 'ja' }, group: 'Promos',
    candidates: [[cand('MM3', '85'), 50], [cand('APC', '110'), 50]] });
  t.UNRESOLVED.push(row(), row());
  ctx.location.hash = '#/io'; t.render();
  // every tile is a way to file that row, and Skip is the row's other answer
  assert.ok(painted.includes('resolveUnresolved(0,0)') && painted.includes('resolveUnresolved(0,1)'),
    'the candidate tiles still have no handler');
  assert.ok(painted.includes('resolveUnresolved(0,-1)'), 'Skip still has no handler');
  // a tile has to say WHICH printing it is - two crops of the same card are the
  // same picture, so the set and number are the only thing telling them apart
  assert.ok(painted.includes('MM3 85') && painted.includes('APC 110'),
    'the candidates are not identified by set and number');
  // ...and the row says where it would land, because that is half the decision
  assert.ok(painted.includes('&rarr; Promos'), 'an ambiguous row does not say which group it belongs to');

  /* THE HOLDING'S OWN FACTS SURVIVE THE PICK. Without `hold` the resolved copy
     took the candidate's defaults - a foil Japanese copy came back nonfoil and
     English, which is the rehydrate bug in a new place. */
  t.resolveUnresolved(0, 1);
  assert.strictEqual(t.UNRESOLVED.length, 1, 'resolving a row did not remove it');
  const got = t.IMPORT_MATCHED[t.IMPORT_MATCHED.length - 1];
  assert.strictEqual(got.card.set, 'APC', 'the pick landed on a printing that was not clicked');
  assert.strictEqual(got.card.foil, 1, 'the resolved copy lost its finish');
  assert.strictEqual(got.card.lang, 'ja', 'the resolved copy lost its language');
  assert.strictEqual(got.card.qty, 2, 'the resolved copy lost its quantity');
  assert.strictEqual(got.group, 'Promos', 'the resolved copy lost its group');
  /* The group is CREATED by the first row resolved into it: IMPORT_GROUPS is
     built from rows that already matched, so a portfolio whose every row was
     ambiguous had no line on the grouping table to send anywhere. */
  assert.ok(t.IMPORT_GROUPS.some(g => g[0] === 'Promos' && g[1] === 1 && g[2] === 'binder'),
    'resolving into a group that had no matched rows did not create it');

  // skip is a decision, and counted apart from "no printing matched"
  t.resolveUnresolved(0, -1);
  assert.strictEqual(t.UNRESOLVED.length, 0, 'skipping a row did not remove it');
  assert.strictEqual(t.IMPORT_SKIPPED, skipped + 1, 'a skipped row is not counted');
  assert.strictEqual(t.IMPORT_MATCHED.length, before + 1, 'a skipped row was filed anyway');
  t.IMPORT_MATCHED.length = before;
}
t.IMPORT_GROUPS.length = 0;

// --- config: two columns, coherent groups, a source toggle that moves ---
go('#/config');
assert.ok(/xl:grid-cols-2/.test(painted), 'config is not two columns');
// data on the left, behaviour on the right - assert the order, not just presence
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
/* CONFIG IS SPLIT BY GAME. It listed all eight sources whichever game you were
   browsing, so a Magic session was asked to reason about pokemontcg.io and the
   "6 of 8 online" summary counted rows that could never matter to it. */
const srcShown = t.srcKeys();
assert.ok(srcShown.length && srcShown.every(k => !t.SOURCES[k].game || t.SOURCES[k].game === 'mtg'),
  'a source for another game is listed while browsing Magic');
assert.ok(srcShown.length < Object.keys(t.SOURCES).length, 'the game split shows every source anyway');
for (const k of Object.keys(t.SOURCES)) {
  const there = painted.includes(`>${t.SOURCES[k].name}<`);
  assert.strictEqual(there, srcShown.includes(k),
    `"${t.SOURCES[k].name}" is ${there ? 'srcShown' : 'hidden'} on a Magic config and should not be`);
}
/* DEAREST FIRST, both down the source list and down each source's sizes: the
   top is the biggest thing you could put on this disk, the bottom the smallest
   thing to pull when a page asks for it. The declarations are in whatever order
   they were written - Scryfall's five run 24 MB, 78, 392, 37, 5 - which reads
   as no order at all. */
for (const kind of ['images', 'data']) {
  const ks = t.srcKeys(kind);
  const cost = ks.map(k => t.srcBytes(k, t.SOURCES[k].full));
  assert.deepStrictEqual(cost.join(), [...cost].sort((a, b) => b - a).join(),
    `the ${kind} sources are not ordered dearest first`);
}
for (const k of srcShown) {
  const b = t.srcQualities(k).map(q => q[2]);
  assert.deepStrictEqual(b.join(), [...b].sort((x, y) => y - x).join(),
    `${k}'s sizes are not ordered dearest first`);
  assert.strictEqual(t.srcQualities(k).length, t.SOURCES[k].q.length, `${k} lost a size in the sort`);
}
/* The page is STATIC and downloads nothing, so the control that matters is the
   command, not a button. There used to be a "Download & cache now" button here
   that did nothing at all - asserting it existed was asserting the lie. */
for (const k of srcShown) {
  const s = t.SOURCES[k], cmd = s.cmd(t.CFG.src[k].q);
  assert.ok(cmd || s.why_local, `"${s.name}" offers no command and no reason it needs none`);
  if (cmd) assert.ok(painted.includes(cmd.replace(/&/g, '&amp;').replace(/</g, '&lt;')),
    `"${s.name}" does not show the command that fetches it`);
}
/* NOTHING CLAIMS WORK OR CONTENTS THAT DO NOT EXIST. Three counters were
   literals painted onto a fresh app: the nav's amber Import pip said 3, the IO
   tab's stat said "3 unresolved", and Config's files band listed
   binders/alara-block.csv and decks/bant-exalted.csv -- the four mock containers
   written out a second time, so it went on naming them after they were deleted.
   An amber pip means "there is work waiting for you here"; saying so when there
   is none is the same fiction as a Collected bar over an empty collection. */
assert.strictEqual(t.UNRESOLVED.length, 0, 'a fresh app has rows waiting to be resolved');
/* THE CACHE COUNTS ARE COUNTED. They were typed - cards 108,412 against a
   catalogue of 107,347 and sets 947 against 986 - close enough to read as
   measured and wrong, which is the worst of both. */
assert.ok(painted.includes(t.ALL().length.toLocaleString('en-GB')), 'the cache row does not count the catalogue');
assert.ok(painted.includes(t.SETS.length.toLocaleString('en-GB')), 'the cache row does not count the sets');
for (const stale of ['108,412', '947<', '311,905', '144,201'])
  assert.ok(!painted.includes(stale), `the typed cache count "${stale}" is back`);
{
  // this file's own fixtures are containers, so the empty case is asserted with
  // them set aside - the app itself ships with neither
  const [bs, ds] = [t.LISTS.binders.splice(0), t.LISTS.decks.splice(0)];
  ctx.location.hash = '#/config'; t.render();
  assert.ok(painted.includes('Nothing collected yet'), 'the files band invents files for an empty collection');
  t.LISTS.binders.push(...bs); t.LISTS.decks.push(...ds);
  ctx.location.hash = '#/config'; t.render();
  // ...and with containers it names THEM, derived, rather than four dead literals
  assert.ok(painted.includes('binders/alara-block.csv'), 'the files band does not name the containers that exist');
  for (const f of ['bant-exalted', 'unsorted.csv'])
    assert.ok(painted.includes(f) === t.LISTS.decks.concat(t.LISTS.binders).some(r =>
      f.startsWith(String(r[0]).toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-'))),
      `Config's files band and the container list disagree about "${f}"`);
}
{
  ctx.location.hash = '#/io'; t.render();
  assert.ok(!/bg-amber-500[^>]*>\d/.test(painted), 'the Import badge shows a count with nothing to resolve');
  assert.ok(painted.includes('nothing imported yet'), 'the resolve section invents rows to resolve');
  assert.ok(!painted.includes('Lighming Bolt'), 'the hardcoded unresolved row is back');
  ctx.location.hash = '#/config'; t.render();
}

// the one question the band exists to answer, and both answers to it
assert.ok(painted.includes('Work offline'), 'config has no offline control');
for (const m of Object.keys(t.OFFLINE_MODES))
  assert.ok(painted.includes(`goOffline('${m}')`), `offline mode "${m}" is not offerable`);
/* Sizes are DERIVED from bytes-per-unit now, so the two that used to be typed
   prose and had drifted have to come out of the arithmetic. 135 GB is what the
   fullest card art actually costs and it must be visible before it is chosen. */
assert.ok(t.offlineBytes('full') > t.offlineBytes('drawn') * 5,
  'the fullest-size offline total is not dramatically bigger - is srcBytes wired up?');
assert.ok(/1[0-9]{2}\.[0-9] GB/.test(painted), 'the full-size offline cost is not stated on the page');
// a source that cannot go local is named, not counted as an outstanding chore
assert.ok(Object.keys(t.SOURCES).some(k => t.SOURCES[k].noLocalYet),
  'nothing declares that it cannot go local, so the named-not-counted rule is untested');
assert.ok(t.missingLocal().every(k => !t.canBeLocal().includes(k)),
  'a source with no local side is being counted as one that has one');
t.goOffline('full');
assert.ok(t.allLocal(), 'going offline left a source online');
for (const k of t.canBeLocal())
  assert.strictEqual(t.CFG.src[k].q, t.SOURCES[k].full, `${k} went local but not at its fullest size`);
assert.ok(t.artUrl(t.CARDS()[0]).startsWith('art/'), 'offline mode still hotlinks card art');
t.goOnline();
assert.strictEqual(t.CFG.src.sfart.at, 'online', 'back-to-defaults did not restore the art source');
go('#/config');

/* Every source reads the same way or the row is not doing its job: each one
   names what it gives, offers BOTH sides, and prices both - a source that
   quietly drops the side it doesn't have is the drift this replaced. */
const srcBand = painted.slice(bandAt('sources'), bandAt('schema source map'));
assert.strictEqual(Object.keys(t.SOURCES).length, 9, 'the source list changed size - is the new one in Config?');
/* SET SYMBOLS ARE A SOURCE NOW, and that is the whole fix. `setIconUrl` used to
   return an svgs.scryfall.io URL unconditionally with no local branch and no
   entry here - so it was the most frequent request in the app (one per card AND
   per set row, where art is one per card) and `allLocal()` had never counted it,
   which is how Config came to print "nothing on this page needs the network" in
   green while the page was asking Scryfall for dozens of symbols per render. */
{
  assert.ok(t.canBeLocal().includes('sfsym'), 'set symbols are still not a source that can go local');
  const before = t.CFG.src.sfsym.at;
  t.setSrc('sfsym', 'local');
  assert.ok(t.setIconUrl('MKM').startsWith('sym/'), 'set symbols ignore the Local setting');
  t.setSrc('sfsym', 'online');
  assert.ok(t.setIconUrl('MKM').startsWith('https://svgs.scryfall.io/'), 'the online side is gone');
  // a set nobody knows still gets no symbol, so an unmatched card cannot borrow one
  assert.strictEqual(t.setIconUrl('ZZZZ'), '', 'an unknown set borrowed a symbol');

  /* NOT PUBLISHED IS NOT NOT FETCHED. Scryfall serves no symbol for a few codes
     we carry - MBC and FRC - and the symbol is a CSS MASK, so there is no
     `onerror`: a mask whose file 404s renders as a solid coloured square, which
     is worse than the plain rarity disc the page draws when it has no URL. With
     the index those sets fall back to the disc; without it, everything is
     optimistic, because a square for one render beats no symbols at all. */
  t.setSrc('sfsym', 'local');
  t.loadSymIndex(new Set(['mkm']));
  assert.ok(t.setIconUrl('MKM').startsWith('sym/'), 'a symbol that IS on disk was dropped');
  assert.strictEqual(t.setIconUrl('MBC'), '',
    'a symbol Scryfall never published still draws a mask, so it renders as a solid square');
  t.loadSymIndex(null);
  assert.ok(t.setIconUrl('MBC').startsWith('sym/'),
    'with no index yet the page gave up on symbols instead of trying');

  /* CONFLUX'S SYMBOL IS `con`, WHICH WINDOWS WILL NOT LET BE A FILE. It bit here
     exactly as it bit the boosters: node "wrote" sym/con.svg, reported success,
     and created nothing, because the path IS the console device - the fetch
     counted 334 successes and git then refused to add a path that did not exist.
     The local URL has to carry the same trailing underscore the file does; the
     CDN is unaffected, so only the local side is asserted. */
  t.loadSymIndex(new Set(['con']));
  assert.strictEqual(t.setIconUrl('CON'), 'sym/con_.svg',
    'the local set symbol for Conflux names a file Windows cannot create');
  t.setSrc('sfsym', 'online');
  assert.strictEqual(t.setIconUrl('CON'), 'https://svgs.scryfall.io/sets/con.svg',
    'the underscore leaked into the CDN URL, which has no such file');
  t.loadSymIndex(null);
  t.setSrc('sfsym', before);
}
for (const k of srcShown) {
  const s = t.SOURCES[k];
  const at = srcBand.indexOf(`>${s.name}<`);
  assert.ok(at > 0, `"${s.name}" is not in the sources band`);
  // to the next source's name rather than a fixed window: a row is a header
  // plus one line per size now, so its length varies with how many it offers
  const next = srcShown.map(o => srcBand.indexOf(`>${t.SOURCES[o].name}<`, at + 1))
    .filter(i => i > at).sort((x, y) => x - y)[0];
  const row = srcBand.slice(at, next > 0 ? next : undefined);
  assert.ok(row.includes(s.gives), `"${s.name}" does not say what it gives`);
  for (const side of ['Local', 'Online'])
    assert.ok(row.includes(`>${side}</span>`), `"${s.name}" is missing its ${side} chip`);
  assert.ok(s.online || s.why, `"${s.name}" has no online side and no reason given`);
  assert.ok(s.q.length && s.q.every(q => row.includes(`setQuality('${k}','${q[0]}')`)),
    `"${s.name}" offers no quality choice`);
  /* Asked PER SIZE, not per source. It used to answer only for whichever size
     happened to be selected, so a directory holding 107k art crops read "not
     fetched" the moment you clicked png - true of png, and it hid the one thing
     the row is for: which of these five have I actually got. */
  assert.strictEqual((row.match(/serve\.py answers this|on disk|&mdash;<\/span>/g) || []).length >= s.q.length,
    true, `"${s.name}" does not answer "is it here" for every size it offers`);
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

/* PERSISTENCE. What you CHOSE (Config's per-source Local/Online and quality) and
   what you MADE (the deck list, which is where a kept draft lands) survive a
   reload; what you had OPEN does not, because the page forgets the tab and the
   selection on navigation by design and a store that remembered them would be
   arguing with that rule rather than extending it. */
{
  t.setSrc('tcg', 'local'); t.setQuality('sfart', 'large');
  t.LISTS.decks.unshift(['Persisted draft', 2, '2 distinct', 'test', [{ n: 'A' }, { n: 'B' }]]);
  t.saveState();
  const raw = JSON.parse(globalThis.__store.getItem(t.STORE));
  assert.strictEqual(raw.v, 1, 'the saved payload carries no version, so a later format cannot be told from this one');
  for (const k of ['tab', 'pick', 'view', 'sort'])
    assert.ok(!(k in raw), `"${k}" is saved, but the page deliberately forgets it on navigation`);

  // ...and it comes back
  t.CFG.src.tcg.at = 'online'; t.CFG.src.sfart.q = 'art_crop';
  const decks = t.LISTS.decks; t.LISTS.decks = [];
  t.loadState();
  assert.strictEqual(t.CFG.src.tcg.at, 'local', 'a Local/Online choice does not survive a reload');
  assert.strictEqual(t.CFG.src.sfart.q, 'large', 'an image-size choice does not survive a reload');
  assert.strictEqual(t.LISTS.decks.length, decks.length, 'the deck list does not survive a reload');
  // joined, not deepStrictEqual: an array built inside the vm carries the vm's
  // Array.prototype, and deepStrictEqual compares prototypes - it fails on two
  // identical arrays from different realms
  assert.strictEqual(t.LISTS.decks[0][4].map(c => c.n).join(','), 'A,B',
    'a kept draft comes back without the cards that were the point of keeping it');

  /* THE COLUMN COUNT IS A CHOICE, so it survives like every other one. It was
     the only thing on the page that did not: source, quality, language and the
     containers all came back and `P.cols` did not, so setting 7 across and
     reloading gave you 6. Written through setCols, which is the control - a
     value the store carries but nothing writes to it is a slower version of the
     same bug. */
  t.P.view = 'grid'; t.setCols(9);
  t.P.cols.grid = 3;
  t.loadState();
  assert.strictEqual(t.P.cols.grid, 9, 'the column count does not survive a reload');
  /* ...and it is CLAMPED on the way back in, per view. A layout's range can
     change; a stored 9 must not outlive a grid whose maximum is now 6, and it
     is read back through the same [lo, hi] the control enforces. */
  {
    const stored = JSON.parse(globalThis.__store.getItem(t.STORE));
    stored.cols = { grid: 999, compact: 0, gone: 4 };
    globalThis.__store.setItem(t.STORE, JSON.stringify(stored));
    t.loadState();
    assert.strictEqual(t.P.cols.grid, 12, 'a stored column count above the layout maximum was taken as-is');
    assert.strictEqual(t.P.cols.compact, 1, 'a stored column count below the layout minimum was taken as-is');
    assert.ok(!('gone' in t.P.cols), 'a view removed since the save came back out of the store');
  }

  /* A SOURCE ADDED SINCE A SAVE KEEPS ITS DEFAULT, and one removed does not come
     back. Assigning the stored object wholesale would get both wrong, and the
     failure is silent - a new source would arrive already configured to whatever
     was in an old payload, or absent. */
  const stored = JSON.parse(globalThis.__store.getItem(t.STORE));
  delete stored.src.tcg;                      // as if tcg were added after this save
  stored.src.gone = { at: 'local', q: 'x' };  // as if a source had been removed since
  globalThis.__store.setItem(t.STORE, JSON.stringify(stored));
  t.CFG.src.tcg.at = 'online';
  t.loadState();
  assert.ok(t.CFG.src.tcg, 'a source absent from the save was dropped from CFG entirely');
  assert.strictEqual(t.CFG.src.tcg.at, 'online', 'a source absent from the save was overwritten anyway');
  assert.ok(!('gone' in t.CFG.src), 'a source removed from SOURCES came back out of the store');

  // corrupt or foreign payloads must not stop the page loading at all
  for (const junk of ['{', 'null', '[]', '{"v":99,"src":{}}']) {
    globalThis.__store.setItem(t.STORE, junk);
    assert.doesNotThrow(() => t.loadState(), `a stored payload of ${junk} stops the page loading`);
  }
  globalThis.__store.removeItem(t.STORE);
  t.LISTS.decks = decks.slice(1);             // put the fixture deck back on the shelf
  t.setSrc('tcg', 'online'); t.setQuality('sfart', 'art_crop');

  // the store has to be visible and removable, or a kept draft you did not want
  // has no cure short of devtools - nothing else on the page deletes a deck
  go('#/config');
  assert.ok(painted.includes('saved on this device'), '#/config does not say what is being remembered');
  assert.ok(painted.includes('forgetState()'), 'there is no way to clear what was saved');
}

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

/* THE ART WINDOW ALWAYS DRAWS THE CROP. The five Scryfall sizes are two
   different pictures: `art_crop` is the illustration alone, and the other four
   are the whole printed card. Letting the configured size reach the art window
   put an entire card - frame, type line, rules text - inside the art window of
   a drawn one, on every card on the page, at every setting but the default. It
   looked fine until someone changed the chip, and then it looked fine in the
   sense that a picture appeared. */
{
  const card = t.CARDS()[0];
  for (const q of ['small', 'normal', 'large', 'png']) {
    t.setQuality('sfart', q);
    const drawn = t.MockCard(card);
    assert.ok(drawn.includes('/art_crop/'),
      `at size "${q}" the art window stopped asking for the crop`);
    assert.ok(!drawn.includes(`/${q}/`),
      `at size "${q}" the art window draws a whole printed card inside itself`);
  }
  t.setQuality('sfart', 'art_crop');
  // ...and the whole-card paths still follow the setting, since that is what it is for
  t.setQuality('sfart', 'large');
  assert.ok(t.artUrl(card, 0, t.cardQ(card)).includes('/large/'),
    'the size chip no longer reaches the places that show a whole card');
  t.setQuality('sfart', 'art_crop');
  assert.ok(t.artUrl(card, 0, t.cardQ(card)).includes('/normal/'),
    'a whole-card render asks for art_crop, which is not a whole card');
}

/* LANGUAGE IS READ, NOT ASSUMED. Every row used to carry a hardcoded 'en',
   which is a literal wearing a field's clothes - it prints in the identity key
   beside the set and collector number, where it reads as a fact about the
   printing. `default_cards` is one printing per card *preferring* English, not
   a set of English printings: 2,634 of 107,347 are Foreign Black Border,
   Rinascimento, Phyrexian, Quenya, and one card each in Latin, Hebrew, Arabic
   and Ancient Greek. Asserted on the generator's shape, since the fixtures here
   are English and would pass either way. */
{
  const gc = readFileSync('gen-cards.mjs', 'utf8');
  assert.ok(/c\.lang === 'en' \? 0 : c\.lang/.test(gc),
    'gen-cards.mjs no longer carries the printing language');
  assert.ok(/\[oracle, set, number, rarity, artId, usd, treatment, finishes, lang, artist, flavour, dfc, langMask\]/.test(gc),
    'the printing tuple comment and its contents disagree about language');
  /* ...AND `lang` IS NOT `langMask`. The row's language is which language THIS
     row was catalogued in; the mask is which languages the printing was
     PRINTED in, and only the second can answer the pip column. Measured, the
     two disagree about 63,990 printings - the catalogue has 651 Japanese rows
     against 61,628 Japanese printings - so a page reading `lang` for
     availability would be wrong about most of the collection. */
  assert.ok(/data\/lang-index\.json/.test(gc), 'gen-cards.mjs no longer folds in the language index');
  assert.ok(/LANG_INDEX\?\.index\[/.test(gc), 'the language mask is not written per printing');
  // narrowed to materialise: the 18 mock rows carry `lang: 'en'` as data, which
  // is what a hand-written mock card is for and not the fault
  const mat = readFileSync('index.html', 'utf8').match(/const materialise = [\s\S]*?\n};/)[0];
  assert.ok(!/lang: 'en'/.test(mat), 'materialise hardcodes a language on every printing again');
  assert.ok(/lang: lang \|\| 'en'/.test(mat), 'materialise does not read the printing language');
  // ...and a non-English printing keeps its language through materialise
  const one = t.materialise({ o: [['X', '', 'Creature', '', '', 'G', 1, 'normal', '', 0, 0]],
    p: [[0, 'FBB', '1', 1, '00000000-0000-4000-8000-00000000abcd', 0, 0, 1, 'de']] })[0];
  assert.strictEqual(one.lang, 'de', 'a non-English printing arrives claiming English');
}

/* ARTIST AND FLAVOUR, both interned and both per PRINTING. MockCard has drawn
   `c.art` on the collector bar and `c.flav` under the rules box since it was
   written, and the mock rows carry both - so the slots looked implemented and
   were empty on all 107,347 real cards. The interesting half is flavour on a
   two-faced card: it is printed on the face it belongs to, faces are SHARED by
   reference across every printing of an oracle, and writing one printing's
   flavour onto a shared face would give it to every reprint. */
{
  const gc = readFileSync('gen-cards.mjs', 'utf8');
  assert.ok(/intern\(\[artists, artistIdx\], c\.artist\)/.test(gc),
    'gen-cards.mjs no longer interns the artist');
  assert.ok(/o: oracles, p: printings, artists, flavour/.test(gc),
    'the payload no longer carries the two dictionaries');
  // per-face, not per-card: 744 printings have flavour ONLY on their faces
  assert.ok(/c\.card_faces\.map\(\(fc, k\) =>/.test(gc),
    'gen-cards.mjs reads one flavour per card again, so a transform loses its back');

  const id = (n) => `00000000-0000-4000-8000-0000000000${n}`;
  const oracle = ['X', '', 'Creature', '', '', 'G', 1, 'normal', '', 0, 0];
  const two = ['T // B', '{G}', 'Creature', 'Front.', '', 'G', 1, 'transform', '',
    [['T', '{G}', 'Creature', 'Front.', '', '', 'G'],
     ['B', '', 'Creature', 'Back.', '', '', 'G']], 0];
  const cat = t.materialise({
    o: [oracle, two],
    p: [
      [0, 'AAA', '1', 1, id(11), 0, 0, 1, 0, 1, 1],   // both
      [0, 'AAA', '2', 1, id(12), 0, 0, 1, 0, 0, 0],   // neither
      [1, 'AAA', '3', 1, id(13), 0, 0, 1, 0, 2, [2, 3]],  // one flavour per face
      [1, 'AAA', '4', 1, id(14), 0, 0, 1, 0, 0, 0],   // ...and a reprint with none
    ],
    artists: ['', 'Rebecca Guay', 'Terese Nielsen'],
    flavour: ['', 'Only a line.', 'Front line.', 'Back line.'],
  });
  assert.strictEqual(cat[0].art, 'Rebecca Guay', 'the artist did not survive materialise');
  assert.strictEqual(cat[0].flav, 'Only a line.', 'the flavour text did not survive materialise');
  assert.strictEqual(cat[1].art, '', 'a printing with no artist invented one');
  assert.strictEqual(cat[1].flav, '', 'a printing with no flavour invented some');
  assert.strictEqual(cat[2].faces[0].flav, 'Front line.', 'a face lost its own flavour');
  assert.strictEqual(cat[2].faces[1].flav, 'Back line.', 'the back face shows the front\'s flavour');
  assert.strictEqual(cat[2].flav, '',
    'a two-faced card also carries a card-level flavour, so both faces draw it twice');
  // the shared faces were not scribbled on: the reprint gets its own answer
  assert.ok(!cat[3].faces[0].flav, 'one printing\'s flavour leaked onto every reprint of it');
  assert.notStrictEqual(cat[2].faces, cat[3].faces,
    'a printing with its own face flavour is sharing face objects with one without');
  // ...and both reach the drawn card
  assert.ok(t.MockCard(cat[0]).includes('Illus. Rebecca Guay'), 'the collector bar names no artist');
  assert.ok(t.MockCard(cat[0]).includes('Only a line.'), 'the rules box draws no flavour');
  const both = t.MockCard(cat[2]);
  assert.ok(both.includes('Front line.') && both.includes('Back line.'),
    'a two-faced card draws only one of its two flavour texts');
  // an older cards.json.gz has neither dictionary: absent, not a throw
  const old = t.materialise({ o: [oracle], p: [[0, 'AAA', '9', 1, id(15), 0, 0, 1, 0]] })[0];
  assert.strictEqual(old.art, '', 'a payload predating the artist dictionary invented an artist');
  assert.strictEqual(old.flav, '', 'a payload predating the flavour dictionary invented flavour');
}

// --- every declared name is used; every name a handler calls exists --------
const declared = [...src.matchAll(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
for (const name of declared) {
  const uses = src.match(new RegExp(`\\b${name}\\b`, 'g')).length;
  assert.ok(uses > 1, `"${name}" is declared and never used - delete it`);
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
  // blank out string literals first - "Eternities" inside 'Edge of Eternities (EOE)'
  // is not an identifier, and the lookbehind alone can't tell
  const code = h.replace(/'[^']*'|"[^"]*"/g, "''");
  for (const m of code.matchAll(/(?<![.\w$'"])([A-Za-z_$][\w$]*)\s*(?=[.(=[]|$)/g)) {
    const id = m[1];
    if (KEYWORDS.has(id)) continue;
    // `id in ctx` misses const/let - they live in the realm's global lexical
    // scope, not on the global object. Ask the realm itself.
    assert.notStrictEqual(vm.runInContext(`typeof ${id}`, ctx), 'undefined',
      `handler "${h}" calls "${id}", which is not defined`);
  }
}
console.log(`  ${String(declared.length).padStart(3)} declarations, all used · ${handlers.size} inline handlers, all resolve`);

/* WRITTEN DOWN ONCE. Each of these vocabularies existed twice - once as the
   constant the filter counts against, and again inside the anatomy spec with an
   invented number beside it - and two of the four copies had already drifted:
   the spec's Legality listed eight formats to FORMATS' nine and its Rarity four
   to RARITIES' five, so the sidebar offered a vocabulary the filter, the sort
   and the card page did not share. These assert the spec is DERIVED, by
   checking it against the one place each list is now declared. */
{
  const specOf = n => (t.GAMES.mtg.anatomy.find(g => g[1] === n) || [])[2] || [];
  const names = n => specOf(n).map(x => x[0]).join();
  assert.strictEqual(names('Type'), t.CARD_TYPES.join(), 'the Type chips are not CARD_TYPES');
  assert.strictEqual(names('Finish'), t.FINISHES.join(), 'the Finish chips are not FINISHES');
  assert.strictEqual(names('Rarity'), t.RARITIES.map(r => r[0]).join(), 'the Rarity chips are not RARITIES');
  assert.strictEqual(t.RARITY_NAME.mtg.join(), t.RARITIES.map(r => r[0]).join(),
    'the rarity NAMES are a second spelling of RARITIES');
  assert.strictEqual(t.FINISH.mtg.join(), t.FINISHES.slice(0, 2).join(),
    "a holding's two finishes are a second spelling of the printing's three");
  /* A closed vocabulary carries NO count here: an invented one is a lie the
     moment the catalogue loads, and these were 41 / 68 / 92 / 131 for formats
     that hold 100k printings between them. */
  for (const n of ['Legality', 'Type', 'Rarity', 'Finish'])
    assert.ok(specOf(n).every(x => x.length === 1), `the ${n} chips still carry a hardcoded count`);
  // ...and an OPEN one is not written down at all - it comes from the data
  for (const n of ['Subtype', 'Keywords', 'Language', 'Artist'])
    assert.strictEqual(specOf(n).length, 0, `${n} is a hand-picked sample presented as a vocabulary`);
}
/* ONE MAP FOR THE THREE CARD DISPLAYS. The name, the icon and the renderer were
   written out separately in the sort bar and in each of the card page's two
   bands, which is how two lists of the same cards ended up on one page
   disagreeing about what a card looks like. */
assert.strictEqual(Object.keys(t.CARD_VIEWS).join(), 'compact,details,grid',
  'the card displays are no longer the three the bands and the sort bar share');
for (const [v, o] of Object.entries(t.CARD_VIEWS)) {
  assert.strictEqual(typeof o.draw, 'function', `${v} names no renderer`);
  assert.ok(t.VIEWS.some(r => r[0] === v && r[1] === o.icon), `${v}'s icon is typed twice`);
}
// the sort bar's chips and the card page's are the same function
assert.ok(t.DisplayChip('grid', '#', true, "setView('grid')").includes("setView('grid')"),
  'the display chip does not carry its own handler');

/* THE SORT IS COMPUTED ONCE PER (LIST, ORDER) -- the one step in the pipeline
   that was not memoised, while `filtered()` and `facetCounts()` both were.
   `CARDS()` is called four or five times in a render and each call re-sorted the
   whole filtered list: measured on Search with nothing filtered, one sort of
   107,347 printings is 506ms and a render was 2,398ms. What this pins is the
   IDENTITY guarantee that makes the memo safe and observable: the same list in
   the same order is the same array back, and a changed order is not. */
{
  const cs = t.filtered();
  const a = t.sortCards(cs), b = t.sortCards(cs);
  assert.strictEqual(a, b, 'the same list in the same order is re-sorted rather than reused');
  const before = t.P.sort;
  t.P.sort = [{ f: 'name', d: 'a' }];
  const asc = t.sortCards(cs);
  assert.notStrictEqual(asc, a, 'changing the order handed back the previous sort');
  assert.strictEqual(asc.length, a.length, 'a re-sort lost or gained cards');
  t.P.sort = [{ f: 'name', d: 'd' }];
  const desc = t.sortCards(cs);
  assert.notStrictEqual(desc, asc, 'reversing the direction handed back the ascending sort');
  if (asc.length > 1)
    assert.strictEqual(desc[0].n, asc[asc.length - 1].n, 'descending is not the reverse of ascending');
  // ...and a DIFFERENT list is not the same list, however similar
  const other = [...cs].reverse();
  assert.notStrictEqual(t.sortCards(other), t.sortCards(cs),
    'two different lists share one memoised sort');
  t.P.sort = before;
}


console.log('\ngame gated on the main then locked. fresh page applies nothing.');
console.log('one page shape everywhere: selector -> filter -> sort -> view. break honoured in 5 layouts.');
console.log('selector collapses on pick, reopens on click, and forgets on navigation.');
console.log('config: 2 columns, 11 groups in order. 8 sources, each priced local and online,'
  + ' and the art sizes reach the URL.');

// --- drawing boosters ---------------------------------------------------
// A pack is a thing a SET prints, so the control exists on one set and nowhere
// else - not on a binder, a deck, a search, or an unpicked set list.
t.pickGame('mtg'); go('#/printings'); t.clearItem();
/* THE TRIGGER IS ON THE BAR, NOT HOVERING OVER THE PAGE. It used to be a fixed
   bottom-right button labelled "Boosters"; it is the bar's Draft button now,
   beside the set it acts on and alongside Export and Clear. So the check is that
   nothing floats, and that the bar carries it. */
assert.ok(!painted.includes('fixed bottom-6'), 'the draw trigger still hovers over the page');
const drawable = t.SETS.find(r => t.packsFor(r[0])?.length);
t.selectItem(drawable[0]); t.render();
assert.ok(painted.includes(`askDraw('${t.jsArg(drawable[0])}')`), `a picked set (${drawable[1]}) offers no draw`);
assert.ok(!painted.includes('Boosters<'), 'the trigger still names the thing rather than the action');
for (const r of ['#/binders', '#/decks', '#/search']) {
  go(r);
  const list = t.LISTS[r.slice(2)];
  if (list) { t.selectItem(list[0][0]); t.render(); }
  assert.ok(!painted.includes('askDraw('), `${r} offers a pack it cannot print`);
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
for (const r of t.SETS) { const v = byType[r[5]] ??= [0, 0]; v[0]++; if (r[6]) v[1]++; }
assert.ok(byType.token[1] === 0 && byType.expansion[1] / byType.expansion[0] > 0.9,
  'set_type does not separate the sets you can open from the ones you cannot');
const trk = t.SETS.find(r => r[1] === 'TRK');
assert.ok(trk[5] === 'expansion' && !trk[6], 'TRK is no longer the un-collated expansion this tests');
assert.deepStrictEqual(t.packsFor(trk[0]).length, 0, 'a draftable set with no collation is treated as undraftable');
go('#/printings'); t.selectItem(trk[0]); t.render();
// "not yet" rather than "never", and no button at all rather than a dead one
assert.ok(painted.includes('>no pack data</span>') && /No booster collation published/.test(painted),
  'an un-collated set does not say why it cannot be drafted');
assert.ok(!painted.includes('askDraw('), 'an un-collated set can still be drafted');
const tokenSet = t.SETS.find(r => r[5] === 'token');
assert.strictEqual(t.packsFor(tokenSet[0]), null, 'a token set offers a booster');

/* The collation itself. Which booster a set is drafted with is read from
   MTGJSON's set.booster, not inferred from the release date - the published
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
assert.ok(mkm && mkm[0] === 'play', 'MKM is not read as a Play Booster set - the date rule is back');
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
   they are not the play-era ones - Lost Caverns of Ixalan is a draft-era set
   with one. The drafted kind always leads, because that is what a draft uses. */
for (const [name, code] of [['Murders at Karlov Manor', 'MKM'], ['The Lost Caverns of Ixalan', 'LCI'],
                            ['Ice Age', 'ICE'], ['Modern Horizons 3', 'MH3']]) {
  const got = t.packsFor(name);
  assert.strictEqual(got[0], B[code][0], `${code}: the drafted booster does not lead`);
  assert.strictEqual([...got].sort().join(' '), [...packIndex[code]].sort().join(' '),
    `${code}: the boosters offered are not the ones the collation has`);
}
// a set whose collation is real but holds no draft/play config is not draftable
const undraftable = t.SETS.find(r => r[6] && !B[r[1]] && !r[4] && t.DRAFTABLE?.has?.(r[5]));
if (undraftable) assert.deepStrictEqual(t.packsFor(undraftable[0]).length, 0,
  'a set collated only into non-draft products still offers a draft');
// the note that carries the numbers, since they get no column of their own
/* The catalogue. check.mjs renders with no network, so what runs here is the
   fallback path - which is exactly the property worth pinning: the page has to
   work before 5 MB arrives, and gets no fetch at all in the harness. */
assert.ok(t.CARDS().length && t.CARDS().length <= t.P.page,
  'the render slice is empty or ignores its own cap');
/* NOT CAPPED, WHICH IS WHAT THIS ASSERTED -- and it said so by comparing
   CARDS() to ALL(), which stopped being the same question when the default
   language filter arrived. CARDS() is the drawable page: filtered, then sorted,
   then sliced. So the cap is what is pinned, and the filter is pinned beside it
   rather than through it. */
assert.ok(t.CARDS().length < t.P.page, 'the mock fallback is being capped, so the harness is not seeing every mock');
assert.strictEqual(t.CARDS().length, t.ALL().filter(c => (c.lang || 'en') === t.P.lang).length,
  'the drawn page is not the default language, or it is dropping cards the filter keeps');
assert.ok(t.ALL().length > t.CARDS().length,
  'no foreign mock survives, so the default language filter is untestable here');
assert.ok(t.openedCard()?.n, 'no card opens without a catalogue');
// the shape the generator writes must be the shape MockCard reads
const built = t.materialise({
  o: [['Llanowar Elves', '{G}', 'Creature - Elf Druid', '{T}: Add {G}.', '1/1', 'G', 1]],
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
   own - which is exactly what shipped and had to be fixed. Seeded rather than
   fetched: the harness has no network, and the mock fallback is a fixed sample
   that is deliberately never filtered, so only a real catalogue tests this. */
const twoSets = t.SETS.filter(r => !r[4]).slice(0, 2);
await t.loadCards({
  o: [['Alpha Card', '{G}', 'Creature - Elf', 'One.', '1/1', 'G', 1],
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

/* A CONTAINER HOLDS WHAT IS STORED ON IT, and a binder is a deck in this one
   respect. Every binder used to draw the same 18 mock cards, which was the
   original complaint; the answer at the time was `BINDER_RULE` - a predicate per
   binder over the catalogue (the Alara sets, twenty duals, twenty-five Commander
   staples, Unsorted as the remainder), explicitly a stand-in until holdings
   arrived. They have, so the rule is gone and membership is index 4, the shape a
   kept draft has always used. What this pins is that the two tabs read the SAME
   index: they were two answers to one question and only one of them was real. */
await t.loadCards({
  o: [['Noble Hierarch', '{G}', 'Creature - Human Druid', '', '0/1', 'G', 1],
      ['Misty Rainforest', '', 'Land', '', '', '', 0],
      ['Sol Ring', '{1}', 'Artifact', '', '', '', 1],
      ['Some Other Card', '{R}', 'Instant', '', '', 'R', 1]],
  p: [[0, 'CON', '71', 3, 'alara', 42], [1, 'ZEN', '225', 3, 'dual', 60],
      [2, 'C21', '263', 2, 'staple', 2], [3, 'MKM', '99', 1, 'other', 0.1]],
});
{
  const by = Object.fromEntries(t.ALL().map(c => [c.art_id, c]));
  const give = (list, name, ids) => list.find(r => r[0] === name)[4] = ids.map(i => ({ ...by[i], qty: 1 }));
  give(t.LISTS.binders, 'Alara block', ['alara']);
  give(t.LISTS.binders, 'Duals &amp; fetches', ['dual']);
  give(t.LISTS.binders, 'Commander staples', ['staple']);
  give(t.LISTS.binders, 'Unsorted', ['other']);
  give(t.LISTS.decks, 'Mono-Red Burn', ['other', 'staple']);
  const holds = {};
  for (const [name] of t.LISTS.binders) {
    go('#/binders'); t.selectItem(name); t.render();
    holds[name] = t.CARDS().map(c => c.art_id).sort().join();
  }
  assert.strictEqual(holds['Alara block'], 'alara', 'a binder does not hold what is stored on it');
  assert.strictEqual(holds['Duals &amp; fetches'], 'dual', 'a binder is holding another binder\'s cards');
  assert.strictEqual(holds['Commander staples'], 'staple', 'a binder is holding another binder\'s cards');
  assert.strictEqual(holds['Unsorted'], 'other', 'a binder is holding another binder\'s cards');
  assert.strictEqual(new Set(Object.values(holds)).size, 4, 'two binders hold the same cards');
  // ...and a deck reads the same index, which is the point of there being one branch
  go('#/decks'); t.selectItem('Mono-Red Burn'); t.render();
  assert.strictEqual(t.CARDS().map(c => c.art_id).sort().join(), 'other,staple',
    'a deck and a binder do not read membership the same way');
  // a container with nothing stored claims no catalogue cards as its contents
  t.LISTS.binders.find(r => r[0] === 'Unsorted')[4] = undefined;
  go('#/binders'); t.selectItem('Unsorted'); t.render();
  assert.ok(t.CARDS().every(c => !['alara', 'dual', 'staple', 'other'].includes(c.art_id)),
    'an empty binder is claiming catalogue cards as its contents');
  // ...and a copy in a BINDER is a copy you own. heldOf searched decks alone,
  // which was right while a binder's contents were a predicate over the
  // catalogue and is not now that they are stored the same way.
  // Sol Ring is in both fixtures - the staples binder and the burn deck - so it
  // is two holdings, which is the whole point of the band naming WHERE each is
  const sol = t.heldOf('Sol Ring');
  assert.strictEqual(sol.length, 2, 'a copy held in a binder is not reported as held');
  assert.strictEqual(sol.map(h => `${h[0]}:${h[1]}`).sort().join(),
    'binder:Commander staples,deck:Mono-Red Burn',
    'a holding does not name the kind and the container it is in');
  // the fixtures go back to empty: the suites below assert on an uncollected app
  for (const list of [t.LISTS.binders, t.LISTS.decks]) for (const r of list) r[4] = undefined;
}
t.clearItem();

const note = t.collationNote('Modern Horizons 3');
assert.ok(/Play Booster/.test(note) && /\d+ cards on the sheets/.test(note) && /rarest 1 in \d+ packs/.test(note),
  `collationNote does not carry the collation: ${note}`);
assert.strictEqual(t.collationNote('nonesuch'), '', 'an unknown set claims a collation');
go('#/printings'); t.selectItem(tokenSet[0]); t.render();
assert.ok(!painted.includes('askDraw('), 'a token set draws the button anyway');

// every draw below deals from the real collation, so the set's sheets and a
// catalogue covering them are seeded first
const sheetKeys = seedCollation(drawable[1]);
go('#/printings'); t.selectItem(drawable[0]); t.render();
// the trigger sits on the bar with the set's other actions, and asks before it
// does anything
assert.ok(/askDraw\([^)]*\)[^>]*>Draft</.test(painted), 'the bar does not carry the draft trigger');
assert.ok(!painted.includes('booster 1 of'), 'clicking nothing already opened a pack');
/* The question is step one of a PAGE of its own: it names the three things you
   can be opening boosters for and how many each takes, and nothing else - no
   filter rail, no nav, nothing behind it to click by mistake. The page you came
   from is restored on the way out rather than sat under it the whole time. */
t.askDraw(drawable[0]);
assert.ok(painted.includes('What are you opening them for?'), 'the trigger does not ask what for');
assert.ok(!painted.includes('How many'), 'the pack count is still a question - it is a rule of the format');
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
// the same seed is the same pack, every render - a pack that reshuffles under
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
/* Every card in the pack is a printing the SHEETS named - which is a stronger
   claim than "from this set", and a different one: the List and Special Guest
   slots deal cards from other sets entirely. What must never happen is a card
   the collation did not put there, which is what the old tier table did on
   every slot. */
for (const c of pack)
  assert.ok(sheetKeys.has(`${c.set}:${c.num}`), `${c.n} (${c.set} ${c.num}) is on no sheet of this booster`);
assert.ok(pack.some(c => c.set === code), 'no card in the pack is from the set it was opened from');
assert.ok(pack.every(c => c.num), 'a drawn card has no collector number');
// nothing is face-up until you turn it over, and you turn over the one you
// reached for - not whichever is next in line
assert.strictEqual((painted.match(/repeating-linear-gradient/g) || []).length, pack.length,
  'the pack does not start face down');
t.revealAt(pack.length - 1);
assert.strictEqual((painted.match(/repeating-linear-gradient/g) || []).length, pack.length - 1,
  'clicking a card turned over a different number of cards');
assert.ok(painted.includes(pack[pack.length - 1].n), 'the card clicked is not the card revealed');
/* TWO ROWS, running left to right - a booster you are opening rather than a
   list of cards. The rows are the height of the window and the columns hug the
   card, so a 14-card pack and a 15-card pack are the same size of card and the
   longer one simply reaches further right. Nothing counts the pack. */
// scoped to the draw. Anchored on the shell's own hook rather than on whatever
// layout classes it happens to wear this week - those have now changed three
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
/* ONE BUTTON, TWO JOBS, AND NEVER BOTH AT ONCE. While the cards are being dealt
   the only useful verb is "stop waiting" - the capture reads Skip to End there,
   and only once they are down does it become Reveal All. Ours offered Reveal all
   throughout, including mid-fly, where pressing it fought the animation.
   `P.opening` could not carry this: it goes false the moment `flyGhosts` is
   CALLED, because it is not awaited, so it is true for the tear and false for
   the entire deal. `P.dealing` spans the deal itself. */
{
  const src = readFileSync('index.html', 'utf8');
  assert.ok(/P\.ask = null; P\.dealing = true; render\(\);/.test(src),
    'the render that paints the draw does not know a deal is starting');
  assert.ok(/P\.dealing = false;\s*\n\s*render\(\);/.test(src),
    'nothing redraws the sidebar when the deal ends, so Skip to End stays up');
  // Skip is a handle on the ending the loop already has, not a second ending
  assert.ok(/SKIP = land;/.test(src) && /function skipDeal\(\) \{ const end = SKIP; if \(end\) end\(\); \}/.test(src),
    'Skip to End does not reuse land(), so there are two ways for a deal to finish');
  assert.ok(/SKIP = null;/.test(src), 'SKIP outlives its deal, so the button can fire a finished one');
  // ...and Reveal all cannot run over the top of it
  assert.ok(/if \(!P\.draw \|\| P\.draw\.mode === 'robin' \|\| P\.opening \|\| P\.dealing\) return;/.test(src),
    'Reveal all still runs during the deal, where it fights the animation');
  const was = t.P.dealing;
  t.P.dealing = true; go('#/draw');
  assert.ok(painted.includes('>Skip to End<'), 'the deal offers no way to skip it');
  assert.ok(!painted.includes('>Reveal all<'), 'Reveal all is offered mid-deal, where it fights the fly');
  assert.ok(painted.includes('onclick="skipDeal()"'), 'Skip to End is not wired to anything');
  t.P.dealing = false; go('#/draw');
  assert.ok(painted.includes('>Reveal all<'), 'Reveal all never comes back once the cards have landed');
  assert.ok(!painted.includes('>Skip to End<'), 'Skip to End survives the deal it was for');
  t.P.dealing = was;
}

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
   Both orders are real and they are reverses of each other - pinned here
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
// change what is in it - the cards already turned over stay exactly as they were
assert.ok(pack.every(c => combined.some(x => x.n === c.n && x.num === c.num)),
  'revealing everything changed what was already face up');
/* THE SCROLL EASE IS IN TIME, NOT IN FRAMES. Both the deal and the reveal sweep
   choose WHICH card to send off the clock - `(now - start) / DEAL_MS` - and both
   used to move the scroll a fixed fraction per frame. Those units disagree the
   moment a frame is dropped: cards keep leaving on schedule while the scroll
   advances once per frame, so at 30fps it covers half the ground in the same
   second and the pool visibly trails the cards being dealt into it. Compounding
   per millisecond makes a dropped frame free - two frames' worth of time in one
   frame moves two frames' worth of distance. */
{
  const per = 1 / 60 * 1000;
  assert.ok(Math.abs(t.ease(per, 0.1) - 0.1) < 0.002,
    'one frame of easing no longer moves one frame of distance');
  // two frames' worth of time in ONE frame must cover what two frames would
  const one = t.ease(per, 0.1);
  assert.ok(Math.abs(t.ease(per * 2, 0.1) - (1 - (1 - one) ** 2)) < 1e-9,
    'a dropped frame costs the scroll its distance, so the view falls behind the deal');
  // ...and a tab that was backgrounded for a second may not teleport it
  assert.ok(t.ease(5000, 0.1) < 0.5, 'a long stall makes the scroll jump rather than ease');
  assert.ok(t.DEAL_MS >= 80 && t.SWEEP_MS >= 100,
    'the deal and sweep are back to the cadence that read as frantic');
  assert.ok(t.BURST >= 1 && t.BURST <= 5,
    'the per-frame cap is gone, so a stall launches its whole backlog in one frame');
}
/* The two buttons that are NOT there any more, pinned as absences because both
   were doing something worse than nothing. `Booster by booster` offered a view
   that was already the default and threw the draw back to pack one on the way;
   `Next booster` made opening the second pack a different gesture from opening
   the first, which the sidebar's fan now does with the same click as the rest. */
assert.ok(!painted.includes('Booster by booster'), 'the combined view still offers the reset');
assert.ok(!painted.includes('Next booster'), 'a Next booster button is still painted');
/* And Keep is DEAD until the draw is finished. Half a sealed pool kept at booster
   three is six packs you never looked at, so the button offering it is offering a
   mistake - it is disabled, and says how many are left. */
assert.ok(painted.includes('Keep as deck'), 'the draw offers no way to keep it');
assert.ok(painted.includes('disabled'), 'Keep as deck is live before every card is seen');
t.revealSequentialSync ? 0 : 0;
for (const c of t.allDrawn()) t.revealOne(c.id);
assert.ok(!painted.includes('disabled'), 'Keep as deck stayed dead after every card was turned over');

/* KEEPING IT HAS TO KEEP THE CARDS. The pool was computed, counted, and thrown
   away: the deck arrived on #/decks with the right numbers printed on its row
   and the MOCK rows inside it, so five minutes of opening packs bought you a
   name. The cards go in the row at index 4 and `scopedCards` reads them. */
{
  const kept = t.pool().map(c => c.n);
  const before = t.LISTS.decks.length;
  t.keepDraw();
  assert.strictEqual(t.LISTS.decks.length, before + 1, 'keeping the draw made no deck');
  const [name, count, , , cards] = t.LISTS.decks[0];
  assert.ok(Array.isArray(cards) && cards.length, `"${name}" was kept without its cards`);
  assert.strictEqual(cards.length, count, `"${name}" says ${count} cards and holds ${cards.length}`);
  assert.deepStrictEqual(cards.map(c => c.n), kept, `"${name}" holds cards the draw never dealt`);
  // a drafted pool is cards you have SEEN, and the zero is the shopping list
  assert.ok(cards.every(c => c.qty === 0), 'a drafted deck arrives claiming you own it');
  // ...and selecting it shows those cards, not the mocks
  t.goTab('decks'); t.selectItem(name);
  assert.deepStrictEqual(t.scopedCards().map(c => c.n), kept,
    'a kept deck shows the mock rows instead of the pool that was drafted into it');
  // a deck tab has five layouts and so no default one; nothing paints until a
  // view is picked, which is the page's own rule and not this deck's problem
  t.setView('grid'); t.render();
  for (const n of [...new Set(kept)].slice(0, 3))
    assert.ok(painted.includes(n), `the kept deck does not paint "${n}"`);
  // the four sample decks state no membership, so they still fall through
  t.selectItem('Mono-Red Burn');
  assert.ok(t.scopedCards().length && t.scopedCards() !== cards,
    'a deck with no stated membership stopped falling through to the mocks');
}
t.askDraw(`${drawable[0]} (${drawable[1]})`); t.setPackMode('complete'); t.nextPack();
for (const c of t.allDrawn()) t.revealOne(c.id);
// Discard goes back to the question, not out of the window
t.discardDraw();
assert.ok(t.P.ask && !t.P.draw && t.P.ask.mode === null,
  'Discard did not go back to the draft chooser');
assert.ok(painted.includes('What are you opening them for?'), 'Discard did not repaint the chooser');
t.askDraw(`${drawable[0]} (${drawable[1]})`); t.setPackMode('complete'); t.nextPack();
/* THE COLLATION ITSELF. The recipes and sheets are generated out of MTGJSON by
   gen-boosters.mjs and read here off disk - the hand-written rarity-tier table
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
// file. A card with no id still draws - that's the resolver's whole case.
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

// --- card anatomy: every shape of card, and the frame that survives it -----
/* The mock rows are all one shape - one face, art in a window - so they cannot
   exercise the half of the catalogue that isn't. This seeds the real thing:
   one printing per layout family and one per art treatment, in the payload
   shape gen-cards.mjs actually writes, and asserts the frame CHANGES for each.
   A renderer that quietly drew all of them as a normal card would pass every
   assertion above this line. */
t.pickGame('mtg');
const anatOracle = (name, layout, faces) =>
  [name, '{1}{G}', 'Creature - Elf', 'Rules text.', '1/1', 'G', 2, layout, '', faces || 0];
const twoFaces = (a, b) => [
  [a, '{G}', 'Creature - Elf', 'Front rules.', '1/1', '', 'G'],
  [b, '{U}', 'Instant', 'Back rules.', '', '', 'U'],
];
const ANAT = {
  o: [
    anatOracle('Plain Card', 'normal'),
    anatOracle('Turner // Turned', 'transform', twoFaces('Turner', 'Turned')),
    anatOracle('Left // Right', 'split', twoFaces('Left', 'Right')),
    anatOracle('Hero // Quest', 'adventure', twoFaces('Hero', 'Quest')),
    anatOracle('Upright // Inverted', 'flip', twoFaces('Upright', 'Inverted')),
    anatOracle('A Plane', 'planar'),
    ['A Saga', '{2}{W}', 'Enchantment - Saga', 'I, II - Do a thing.\nIII - Do another.', '', 'W', 3, 'saga', '', 0],
    ['A Class', '{1}{U}', 'Enchantment - Class', 'Base ability.\n{2}{U}: Level 2\nSecond ability.', '', 'U', 2, 'class', '', 0],
    /* NOTHING FOR A FRAME TO HOLD. No cost, no type line ("Card" is Scryfall's
       placeholder for absence, not a type), and either no rules or one
       parenthetical. An art card and a Jumpstart theme divider, 3% of the real
       catalogue between them and their kin. */
    ['Art // Art', '', 'Card', '', '', '', 0, 'art_series', '',
      [['Art', '', 'Card', '', '', '', ''], ['Art', '', 'Card', '', '', '', '']]],
    ['Theme', '', 'Card', '(Theme color: {G})', '', '', 0, 'front_card', '', 0],
    // ...and the near miss that must still get a frame: no cost either, but a
    // real type line, which is every token, land, emblem, plane and scheme
    ['A Token', '', 'Token Creature - Bear', '', '2/2', 'G', 0, 'token', '', 0],
    /* Written the way the source writes one, capitals and all, because that is
       the whole fault: `LEVEL 1-4` is not `Level 1`, and the `0/6` under it is
       this band's power and toughness rather than a stray line of rules. */
    ['A Leveler', '{1}{U}', 'Creature - Merfolk',
      'Level up {2} ({2}: Put a level counter on this.)\nLEVEL 1-4\n0/6\nLEVEL 5+\n6/6\nIslandwalk',
      '0/1', 'U', 2, 'leveler', '', 0],
    /* An aftermath card is `layout: split` like the one above it, and the only
       thing that tells them apart is the keyword's reminder text opening the
       back face - so the fixture writes it exactly as the source does. */
    ['Now // Later', '{2}{W}', 'Sorcery', 'Do a thing.', '', 'W', 3, 'split', '',
      [['Now', '{2}{W}', 'Sorcery', 'Do a thing.', '', '', 'W'],
       ['Later', '{3}{W}', 'Sorcery',
        'Aftermath (Cast this spell only from your graveyard. Then exile it.)\nDo another.', '', '', 'W']], 0],
  ],
  // one printing per treatment on the plain card, then one per layout
  p: [
    [0, 'AAA', '1', 1, '00000000-0000-4000-8000-000000000001', 1, 0],
    [0, 'AAA', '2', 1, '00000000-0000-4000-8000-000000000002', 1, 'fullart'],
    [0, 'AAA', '3', 1, '00000000-0000-4000-8000-000000000003', 1, 'borderless'],
    [0, 'AAA', '4', 1, '00000000-0000-4000-8000-000000000004', 1, 'textless'],
    [0, 'AAA', '5', 1, '00000000-0000-4000-8000-000000000005', 1, 'extendedart'],
    [1, 'AAA', '6', 3, '00000000-0000-4000-8000-000000000006', 1, 0],
    [2, 'AAA', '7', 2, '00000000-0000-4000-8000-000000000007', 1, 0],
    [3, 'AAA', '8', 2, '00000000-0000-4000-8000-000000000008', 1, 0],
    [4, 'AAA', '9', 2, '00000000-0000-4000-8000-000000000009', 1, 0],
    [5, 'AAA', '10', 3, '00000000-0000-4000-8000-000000000010', 1, 0],
    [6, 'AAA', '11', 3, '00000000-0000-4000-8000-000000000011', 1, 0],
    [7, 'AAA', '12', 3, '00000000-0000-4000-8000-000000000012', 1, 0],
    [8, 'AAA', '13', 1, '00000000-0000-4000-8000-000000000013', 1, 'borderless'],
    [9, 'AAA', '14', 1, '00000000-0000-4000-8000-000000000014', 1, 0],
    [10, 'AAA', '15', 1, '00000000-0000-4000-8000-000000000015', 1, 0],
    [11, 'AAA', '16', 3, '00000000-0000-4000-8000-000000000016', 1, 0],
    [12, 'AAA', '17', 3, '00000000-0000-4000-8000-000000000017', 1, 0],
  ],
};
t.loadCards(ANAT);
const byName = Object.fromEntries(t.ALL().map(c => [`${c.n}|${c.treat}`, c]));

/* EVERY CHIPS GROUP IS COUNTED, or the sidebar falls back to the hand-written
   numbers beside it and they look exactly as authoritative as the real ones.
   Artist used to be the exception and said so on the page; now that it is in
   the catalogue nothing is, so the apology is gone and this is what stands in
   its place - a group added to the anatomy spec without a counter fails the
   build rather than shipping three invented names. */
go('#/search');
for (const [kind, label] of t.GAMES.mtg.anatomy)
  if (kind === 'chips') assert.ok(t.facetCounts()[label],
    `"${label}" is drawn from hand-written numbers - facetCounts does not answer it`);

/* ...AND NO GAME'S SPEC CARRIES A COUNT AT ALL, which is the rule the check
   above can only enforce for the game that has a catalogue. Pokemon is shelved,
   so nothing counts its chips - and its whole sidebar was typed pairs: Legality
   74/148/252, ten energy types, Card type, Stage, Rarity, Finish, and three
   named illustrators. Typed beside a chip, a number reads exactly as measured as
   a real one. The vocabularies are facts about the game and stay; the counts are
   `facetCounts`'s to supply, and until it can there is no number to draw. */
for (const [game, g] of Object.entries(t.GAMES))
  for (const [kind, label, arg] of g.anatomy)
    if (kind === 'chips')
      assert.ok(!(arg || []).some(x => Array.isArray(x) && x.length > 1),
        `${game}'s "${label}" chips carry hand-typed counts, which read as measured`);

/* A SAVED DECK IS A SNAPSHOT. A deck kept before a field existed has no such
   field, and the sidebar duly reported a Hobbit draft as containing nothing
   Modern-legal - the same plausible-looking lie as the hardcoded counts. The
   catalogue re-supplies the printing when it lands; the holding stays yours. */
t.LISTS.decks.unshift(['Stale draft', 1, '1 distinct', 'test',
  [{ n: 'Old Name', set: 'AAA', num: '1', qty: 3, foil: 1 }]]);
t.loadCards(ANAT);
const fresh = t.LISTS.decks[0][4][0];
assert.notStrictEqual(fresh.n, 'Old Name', 'a stored deck card was not refreshed from the catalogue');
assert.ok(fresh.legal !== undefined, 'a stored deck card still lacks fields the catalogue now carries');
assert.strictEqual(fresh.qty, 3, 'rehydrating a deck threw away how many you own');
assert.strictEqual(fresh.foil, 1, 'rehydrating a deck threw away the finish you own');
// ...and a printing the catalogue does not have is kept rather than dropped
t.LISTS.decks[0][4] = [{ n: 'Gone', set: 'ZZZ', num: '999', qty: 1 }];
t.loadCards(ANAT);
assert.strictEqual(t.LISTS.decks[0][4][0].n, 'Gone',
  'a card the catalogue no longer carries was dropped from a saved deck');
t.LISTS.decks.shift();


// the four families are what the geometry branches on, so nothing may be in two
for (const l of t.LANDSCAPE) assert.ok(!t.SIDED.has(l), `"${l}" is both landscape and two-sided`);
for (const l of t.SIDED) assert.ok(!t.PAIRED.has(l), `"${l}" has its faces on one side and on two`);

// LANDSCAPE turns the card, and a turned card must not keep the portrait art box
const plane = t.MockCard(byName['A Plane|framed']);
assert.ok(plane.includes('aspect-[7/5]'), 'a Plane is drawn portrait');
assert.ok(!plane.includes('aspect-[5/3.52]'), 'a Plane keeps the portrait art window and loses its rules');
assert.ok(plane.includes('Rules text.'), 'a Plane draws no rules at all');
assert.ok(t.MockCard(byName['Plain Card|framed']).includes('aspect-[5/7]'), 'an ordinary card is not portrait');

// SIDED draws both faces and hides one; the back is the same id at /back/
const dfc = t.MockCard(byName['Turner // Turned|framed']);
for (const s of ['side-a', 'side-b', 'anat-flip']) assert.ok(dfc.includes(s), `a transform has no ${s}`);
assert.ok(dfc.includes('>Turner<') && dfc.includes('>Turned<'), 'a transform drops one of its faces');
assert.ok(dfc.includes('/front/') && dfc.includes('/back/'), 'a transform asks for one side twice');
assert.ok(dfc.includes('Back rules.'), 'the back face has no rules text');
// ...and a single-faced card must not grow a flip control it cannot honour
assert.ok(!t.MockCard(byName['Plain Card|framed']).includes('anat-flip'), 'an ordinary card offers a flip');

// PAIRED puts both faces on ONE side, so there is no flip and both are visible
for (const [name, want] of [['Left // Right', 'Right'], ['Hero // Quest', 'Quest'], ['Upright // Inverted', 'Inverted']]) {
  const one = t.MockCard(byName[`${name}|framed`]);
  assert.ok(!one.includes('anat-flip'), `${name}: two faces on one side should not offer a flip`);
  assert.ok(one.includes(`>${want}<`), `${name}: the second face is not drawn`);
}
assert.ok(t.MockCard(byName['Left // Right|framed']).includes('aspect-[7/5]'), 'a split card is not turned sideways');
assert.ok(t.MockCard(byName['Upright // Inverted|framed']).includes('rotate-180'), 'a flip card draws its lower half the right way up');

// BANDED: a chapter line goes in the gutter, an ordinary line does not
const saga = t.MockCard(byName['A Saga|framed']);
assert.ok(/border-r border-black\/40/.test(saga), 'a Saga draws its chapters as a paragraph');
assert.ok(!/border-r border-black\/40/.test(t.MockCard(byName['Plain Card|framed'])),
  'an ordinary card grows a chapter gutter');

/* A LEVEL IS A BAR AND IT IS AT THE END OF THE LINE. Of the three BANDED
   layouts only Saga banded: the pattern wanted `Level 1` at the start of a line
   in title case, and a Class writes `{2}{U}: Level 2` with the level LAST while
   a Leveler writes `LEVEL 1-4` in capitals. 61 Levelers and 69 Classes drew as a
   run-on paragraph with their levels and P/Ts loose in the middle of it. */
const lev = t.MockCard(byName['A Leveler|framed']);
for (const [name, html, n] of [['Leveler', lev, 2], ['Class', t.MockCard(byName['A Class|framed']), 1]])
  assert.strictEqual([...html.matchAll(/bg-black\/25 px-1 font-bold/g)].length, n,
    `a ${name} draws ${n === 1 ? 'its level' : 'its levels'} as ordinary rules text`);
// the marker is normalised, so `LEVEL 1-4` and `Level 2` read the same way
assert.ok(lev.includes('Level 1-4') && lev.includes('Level 5+'), 'a Leveler lost one of its bands');
// ...and the band's own power/toughness is IN the oracle text, one line under
// its marker - the issue assumed this needed a field in gen-cards.mjs
assert.ok(/Level 1-4<\/span>\s*<span[^>]*>0\/6</.test(lev.replace(/\n\s*/g, '')),
  "a Leveler's band P/T is loose in the rules text instead of in its band");
assert.ok(!/<p[^>]*>0\/6<\/p>/.test(lev), 'a band power/toughness is still drawn as a paragraph');
// a Class carries a cost into its bar; a Leveler has none to carry
assert.ok(t.MockCard(byName['A Class|framed']).includes('</span>:</span>'),
  "a Class's level-up cost vanished from its band");
// and the base rules line that merely mentions levelling up is not a band
assert.ok(/<p[^>]*>Level up /.test(lev), '"Level up {2}" was mistaken for a band marker');

/* AN AFTERMATH CARD IS A SPLIT THAT IS NOT TURNED. Amonkhet's are `layout:
   split` like any other and were drawn landscape as two halves side by side;
   the printed card is PORTRAIT with the second spell rotated ninety degrees
   below the first. Scryfall gives them no layout of their own, so the whole
   thing hangs off the keyword's reminder text opening the back face - assert
   both directions, or the predicate silently claims every split or none. */
const aft = t.MockCard(byName['Now // Later|framed']);
const split = t.MockCard(byName['Left // Right|framed']);
assert.ok(t.aftermath(byName['Now // Later|framed']), 'an aftermath card is not recognised as one');
assert.ok(!t.aftermath(byName['Left // Right|framed']), 'an ordinary split is treated as aftermath');
assert.ok(aft.includes('aspect-[5/7]') && !aft.includes('aspect-[7/5]'),
  'an aftermath card is drawn landscape - it is read the right way up');
assert.ok(split.includes('aspect-[7/5]'), 'an ordinary split stopped being landscape');
// the second spell is turned, and clockwise: the printed card puts its title at
// the right-hand edge, which is where rotate(90deg) sends the top
assert.ok(/ rotate-90 /.test(aft), 'the aftermath half is not rotated');
assert.ok(!/-rotate-90/.test(aft), 'the aftermath half is turned anticlockwise, so its title is on the wrong side');
assert.ok(!/rotate-90/.test(split), 'an ordinary split grew a rotated half');
// both halves draw art, from ONE crop anchored to opposite ends: an aftermath
// art_crop is the two panels side by side in a single image
assert.ok(aft.includes('object-left') && aft.includes('object-right'),
  'the two aftermath halves show the same end of the shared art crop');
assert.ok(aft.indexOf('object-left') < aft.indexOf('object-right'),
  'the aftermath halves have their illustrations the wrong way round');

/* THE TURN INDICATOR. A two-sided card prints a mark in the top-left of its
   title bar saying which way it turns and into what - the one thing the corner
   flip button cannot say. `treatOf` dropped every DFC frame effect because it
   only looks for the four that change the ART, so 580 printings lost theirs.
   Read, not derived: only 110 of the 381 `sunmoondfc` printings say Daybound or
   Nightbound, so the 271 older Innistrad werewolves cannot be found in the text. */
{
  const gc = readFileSync('gen-cards.mjs', 'utf8');
  assert.ok(/find\(f => DFC\.includes\(f\)\)/.test(gc),
    'gen-cards.mjs no longer reads the DFC frame effect');
  const id = (n) => `00000000-0000-4000-8000-0000000000${n}`;
  const two = ['A // B', '{G}', 'Creature', 'Front.', '', 'G', 1, 'transform', '',
    [['A', '{G}', 'Creature', 'Front.', '', '', 'G'],
     ['B', '', 'Creature', 'Back.', '', '', 'G']], 0];
  const solo = ['Solo', '{G}', 'Creature', 'Text.', '', 'G', 1, 'normal', '', 0, 0];
  const [plain, sun, single] = t.materialise({ o: [two, solo], p: [
    [0, 'AAA', '1', 1, id(21), 0, 0, 1, 0, 0, 0, 0],
    [0, 'AAA', '2', 1, id(22), 0, 0, 1, 0, 0, 0, 'sunmoondfc'],
    [1, 'AAA', '3', 1, id(23), 0, 0, 1, 0, 0, 0, 0],
  ] }).map(t.MockCard);
  assert.ok(plain.includes('&#9650;') && plain.includes('&#9660;'),
    'an ordinary two-sided card draws no turn indicator');
  assert.ok(plain.indexOf('&#9650;') < plain.indexOf('&#9660;'),
    'the back of a two-sided card carries the front\'s mark');
  // the six effects with no character that is actually them fall back to the
  // triangle rather than to an invented symbol; the day/night pair does not
  assert.ok(sun.includes('&#9728;') && sun.includes('&#9790;'),
    'a day/night card does not draw its sun and crescent');
  assert.ok(!sun.includes('&#9650;'), 'a day/night card draws the generic triangle as well as its own');
  assert.ok(!single.includes('&#9650;') && !single.includes('&#9728;'),
    'a single-faced card grew a turn indicator');
  // the tooltip carries the source's own word, which is why the name is stored
  // rather than a flag for the one case the page draws specially
  assert.ok(sun.includes('sunmoon &mdash; turn the card over')
    || sun.includes('sunmoon - turn the card over'), 'the mark does not name what it turns into');
  assert.ok(plain.includes('transform'), 'an unnamed indicator does not say it is a transform');
}

/* MELD IS THREE CARDS, NOT TWO FACES. Scryfall gives the result its own row
   with no `card_faces` and `all_parts` naming the group, so without the group
   the result sits in the catalogue as an ordinary card with no link to either
   half and neither half knows what it becomes. Not derivable from the rules
   text - checked, because aftermath was: a part names its partner but not the
   result, and the result says nothing about melding at all. */
{
  const gc = readFileSync('gen-cards.mjs', 'utf8');
  // tokens share the group's all_parts and are not members of it
  assert.ok(/if \(c\.name !== res\.name && !parts\.includes\(c\.name\)\) return 0;/.test(gc),
    'gen-cards.mjs hands a meld group to every token printed alongside one');
  const id = (n) => `00000000-0000-4000-8000-0000000000${n}`;
  const group = ['Whole', 'Half A', 'Half B'];
  const card = (n, meld) => ['{2}{W}', 'Creature - Angel', 'Text.', '2/2', 'W', 3, 'meld', '', 0, 0, meld];
  const MELD = {
    o: [['Half A', ...card('Half A', group)], ['Whole', ...card('Whole', group)],
        ['Ordinary', ...card('Ordinary', 0)]],
    p: [[0, 'AAA', '1', 3, id(31), 0, 0, 1, 0, 0, 0, 0],
        [1, 'AAA', '2', 3, id(32), 0, 0, 1, 0, 0, 0, 0],
        [2, 'AAA', '3', 3, id(33), 0, 0, 1, 0, 0, 0, 0]],
  };
  const cat = t.materialise(MELD);
  assert.strictEqual(cat[0].meld.join('|'), 'Whole|Half A|Half B', 'the meld group did not survive materialise');
  assert.strictEqual(cat[2].meld, null, 'a card outside a meld group was given one');
  t.loadCards(MELD);
  // a half names its partner AND what they become; both are walkable
  t.openCard('Half A');
  assert.ok(/Melds with .*Half B.*into .*Whole/s.test(painted), 'a meld half does not say what it becomes');
  assert.ok(painted.includes("openCard('Half B')") && painted.includes("openCard('Whole')"),
    'a meld half names the rest of its group without linking to them');
  // ...and the result names the two cards it is printed across
  t.openCard('Whole');
  assert.ok(/Melded from .*Half A.*Half B/s.test(painted), 'the meld result does not name its halves');
  assert.ok(!/Melds with/.test(painted), 'the meld result is described as if it were a half');
  // there is no other side, and the card says so rather than growing a flip
  assert.ok(painted.includes('nothing here to turn over'), 'the meld band does not say why it has no flip');
  assert.ok(!t.MockCard(t.ALL().find(c => c.n === 'Whole')).includes('anat-flip'),
    'a meld card grew a flip control for a side that does not exist');
  // an ordinary card gets no band at all
  t.openCard('Ordinary');
  assert.ok(!/Melds with|Melded from/.test(painted), 'a card outside a meld group drew a meld band');
  // put the anatomy catalogue back - everything below this line still reads it
  t.loadCards(ANAT);
}

/* TWO-COLUMN: a Saga and a Class are not stacked cards. The illustration is a
   tall strip down one side - Scryfall crops them 312x752 rather than the 626x457
   an ordinary card gets, which is the tell - with the track beside it and the
   type line ACROSS THE BOTTOM. Drawn stacked they are legible and the wrong
   shape, which is exactly the failure a render-only test cannot see, so it is
   asserted structurally: the art column exists, and the type line follows it. */
const klass = t.MockCard(byName['A Class|framed']);
for (const [name, html] of [['Saga', saga], ['Class', klass]]) {
  assert.ok(html.includes('w-[42%]'), `a ${name} is not drawn as a two-column card`);
  assert.ok(html.indexOf('w-[42%]') < html.indexOf(`Enchantment - ${name}`),
    `a ${name} puts its type line above the art instead of across the bottom`);
  assert.ok(!html.includes('aspect-[5/3.52]'), `a ${name} kept the stacked card's art band`);
}
// ...and they are mirrors: Saga reads its chapters left of the art, Class right
// probed against the RULES TEXT, not the chapter gutter: a Class does not
// currently band (its level marker sits at the end of the line, which the
// gutter regex misses and ISSUES.md tracks), so a probe that assumed banding
// was testing that open bug rather than which side the art is on
const artFirst = (h, txt) => h.indexOf('w-[42%]') < h.indexOf(txt) ? 'art-first' : 'track-first';
assert.strictEqual(artFirst(saga, 'Do a thing'), 'track-first', 'a Saga has its art on the wrong side');
assert.strictEqual(artFirst(klass, 'Base ability'), 'art-first', 'a Class has its art on the wrong side');
/* SHRINK TO FIT, NOT SHRINK ON PRINCIPLE. `room` tells textFit how much box
   this plate has relative to an ordinary card's, and the first set of values
   was picked by eye against the STACKED frames, then never revisited when the
   frames were rebuilt underneath them - so a Saga, whose track column is half
   again the standard rules box, was still being set two steps smaller than the
   ordinary cards beside it. This is that complaint as an assertion: given the
   same text, a frame with MORE room may not choose a smaller type size.
   (The clip rate itself cannot be asserted here - it needs layout, and this
   harness has a stubbed DOM with none. It is measured in the browser: 14 of 411
   samples, all of them either on the standard room-1 path or under 13px.) */
const smallestEm = h => Math.min(...[...h.matchAll(/text-\[([\d.]+)em\]/g)].map(m => +m[1]));
const LONG = 'Whenever a creature you control deals combat damage to a player, exile the top card of that player library face down. You may look at it for as long as it remains exiled.';
const asNormal = t.MockCard({ n: 'X', type: 'Creature', text: LONG, cost: [], layout: 'normal', treat: 'framed' });
const asSaga = t.MockCard({ n: 'X', type: 'Enchantment - Saga', text: LONG, cost: [], layout: 'saga', treat: 'framed' });
const asFullArt = t.MockCard({ n: 'X', type: 'Creature', text: LONG, cost: [], layout: 'normal', treat: 'fullart' });
assert.ok(smallestEm(asSaga) >= smallestEm(asNormal),
  'a Saga is set smaller than an ordinary card with the same text, and its box is bigger');
assert.ok(smallestEm(asFullArt) >= smallestEm(asNormal),
  'a full-art card is set smaller than an ordinary card with the same text, and its box is bigger');

/* A Saga is not always `layout: saga` - 127 printings are one on the front of a
   card whose layout says transform - so the frame is chosen off the TYPE LINE. */
assert.ok(t.MockCard({ n: 'Front // Back', layout: 'transform', treat: 'framed',
  faces: [{ n: 'Front', type: 'Enchantment - Saga', text: 'I - Go.', cost: [] },
          { n: 'Back', type: 'Creature - Human', text: 'Hi.', cost: [] }] }).includes('w-[42%]'),
  'a Saga printed under another layout does not get the Saga frame');

// THE BREAKOUT ART: each treatment has to change something, or it is decoration
const treat = n => t.MockCard(byName[`Plain Card|${n}`]);
// anchored to the wrapper's own class, not a bare substring: the plates inside
// are padded `p-0.5`, which contains "p-0" and made the naive test always true
const edge = h => h.match(/bg-black\/70 (\S+) shadow-lg/)[1];
assert.strictEqual(edge(treat('borderless')), 'p-0', 'a borderless printing keeps its black edge');
assert.strictEqual(edge(treat('framed')), 'p-[3.5%]', 'an ordinary printing lost its black edge');
/* FULLART IS PULLED, NOT DRAWN - decided at #/card's Align display, which is
   what that display is for. Drawn, a full-art card got opaque plates at fixed
   positions over the illustration; printed, it has a translucent title bar, an
   ornate border, a text panel of a different shape, and on a full-art land
   almost no furniture at all, placed per card and per promo. Checked over six
   samples of `normal | fullart` and again down twelve printings of Laboratory
   Maniac: not one matched. 6,085 printings stop being invented. */
assert.ok(t.UNALIGNED.has('fullart'), 'fullart is being drawn again rather than pulled');
assert.ok(!treat('fullart').includes('mottle'), 'a full-art printing still draws frame plates');
assert.ok(/cards\.scryfall\.io\/(normal|large|png|small)\//.test(treat('fullart')),
  'a full-art printing draws neither a frame nor the printed card');
/* A KEY IS A TREATMENT OR A FULL CLASS. `fullart` crosses fourteen layouts, and
   listing all fourteen would be a list to keep in step with the catalogue
   rather than a decision. */
for (const layout of ['normal', 'token', 'transform', 'saga', 'split', 'meld'])
  assert.ok(t.unaligned({ layout, treat: 'fullart' }), `${layout}/fullart is drawn despite the treatment`);
assert.ok(!t.unaligned({ layout: 'normal', treat: 'framed' }), 'an ordinary card stopped being drawn');
{
  // ...and a class key still works, for where it is one layout's version
  t.UNALIGNED.add('saga | framed');
  assert.ok(t.unaligned({ layout: 'saga', treat: 'framed' }), 'a full-class key no longer matches');
  assert.ok(!t.unaligned({ layout: 'normal', treat: 'framed' }), 'a class key matched the wrong class');
  t.UNALIGNED.delete('saga | framed');
}
/* THE CROP'S SHAPE IS NOT IN THE DATA. Measured across the overlaid classes,
   Scryfall's art_crop comes back 626x457, 626x747, 684x722, 745x505, 619x808
   and 312x752, and the bulk file says which for none of them. `object-cover`
   therefore cannot be right when the art is the whole card: fitting a 1.37-wide
   crop to a 0.71-tall card by height scales it 2x and discards 49% of its
   width, which is what made full-art transforms look zoomed into their own
   middles. Contain shows all of it whatever shape it is; the cover copy behind
   is blurred filler, and top-anchoring puts that filler under the type line
   instead of across the visible top of the card. */
/* NO TREATMENT IS DRAWN THIS WAY ANY MORE, and the path is asserted through the
   LAYOUTS that still reach it. fullart left when it was declared unalignable,
   extendedart left when its type line turned out to have nothing to sit against
   (see below), and textless was the last - 225 printings whose only uniform
   feature is the name, SLD 1471 Mountain printing as a Windows-95 joke frame
   and P09 Cryptic Command as an oval-window promo.
   Planes and Schemes keep the geometry alive: they are printed full-bleed with
   the title and rules ON the illustration, and Scryfall calls them `framed`
   because full_art is a flag about a frame these do not have. */
for (const layout of [...t.LANDSCAPE].filter(l => l !== 'split')) {
  // the art id matters: with no illustration to place there is no <img> to
  // assert about, and the card draws "no art loaded" instead
  const h = t.MockCard({ n: 'X', layout, treat: 'framed', cost: [],
    type: 'Plane - Zendikar', text: 'Rules text.', art_id: '00000000-0000-4000-8000-000000000001' });
  assert.ok(h.includes('object-contain object-top'),
    `"${layout}" scales the art to cover a card-shaped box, which crops a landscape illustration in half`);
  assert.ok(h.includes('blur-md') && h.includes('object-cover'),
    `"${layout}" contains the art but leaves the rest of the card empty`);
  assert.strictEqual((h.match(/object-contain/g) || []).length, 1,
    `"${layout}" contains the blurred backdrop too, so nothing fills the card`);
}
// ...and both overlaid TREATMENTS are pulled rather than drawn, which is the
// decision itself: a class the shared geometry cannot draw is not drawn at all
for (const n of t.OVERLAID)
  assert.ok(t.unaligned({ layout: 'normal', treat: n }),
    `"${n}" lays plates over an illustration whose furniture is chosen per card`);
/* ...and the art WINDOW no longer scales its crop AT ALL, in either direction.
   It used to cover a fixed `aspect-[5/3.52]` box - 1.42 against the crop's
   1.37, so every ordinary card lost a sliver off the top and bottom of its
   illustration to a number picked before the shape was known. `h-auto` is the
   whole fix: the image is its own ratio and the plates below it move with it,
   which is also why the type bar now sits where a printed one does. No
   `object-*` on it, because there is nothing left to fit. */
const framedArt = treat('framed');
assert.ok(/class="block h-auto w-full"/.test(framedArt),
  'the ordinary art window is scaling its crop instead of taking its shape');
assert.ok(!framedArt.includes('object-cover') && !framedArt.includes('object-contain'),
  'the ordinary art window still fits its crop to a box');
assert.ok(!treat('textless').includes('Rules text.'), 'a textless printing draws a rules box');
/* EXTENDED ART FLOWS, IT DOES NOT OVERLAY - and this assertion used to say the
   opposite, which is worth keeping in view. It was drawn as an art window with
   a negative margin, then moved to OVERLAID so the art became the whole card
   with the plates floating on it. That is right for fullart and textless and
   wrong here, and the tell is the TYPE LINE: an overlaid card has no base to
   its art, so the type bar hung in the middle of open illustration with nothing
   to sit against.
   The printed article is an ordinary frame missing only its side rails: title
   at the top, art beneath it, type at the base of the art, an opaque text box
   under that. The crop says the same thing - an extended-art `art_crop` is 1.62
   wide against an ordinary printing's 1.36-1.37, measured over six of each - so
   the window taking the crop's own shape puts the type where the print does
   without a number being picked for it. */
{
  const ea = treat('extendedart');
  assert.ok(!ea.includes('object-contain object-top'), 'extended art is back to being drawn as a full-art card');
  assert.ok(ea.includes('-mx-1.5'), "the extended art window does not run past the frame's side rails");
  assert.ok(/class="block h-auto w-full"/.test(ea), "the extended art window is not taking the crop's own shape");
  // the type line sits at the BASE of the art, which is the tuck an ordinary
  // framed card uses - not the `mt-1` an overlaid one gets
  assert.ok(ea.includes('-my-2.5'), 'the extended art type line no longer sits at the base of the art');
  assert.ok(ea.indexOf('Plain Card') < ea.indexOf('-mx-1.5'), 'the title is not above the art');
  assert.ok(ea.indexOf('-mx-1.5') < ea.indexOf('-my-2.5'), 'the type line is not below the art');
}
assert.ok(treat('extendedart').includes('Rules text.'),
  'extended art dropped its rules box - it is fullart with text, not textless');
for (const n of ['fullart', 'borderless', 'textless', 'extendedart'])
  assert.notStrictEqual(treat(n), treat('framed'), `"${n}" renders identically to a framed card`);

/* WHEN THERE IS NO FRAME TO DRAW, DRAW THE CARD. A frame holds a cost, a type
   line and a rules box; an art card, a theme divider and a punchcard have none
   of the three, and the frame drawn over them is a name above two-thirds of
   empty box - which is what art series looked like, at 2,649 printings the
   fifth most common class in the catalogue. The test is structural, on the
   face, so the layout Wizards prints next is covered without an edit: that is
   not hypothetical, `front_card` arrived after the rule was written. */
assert.ok(t.framable(byName['Plain Card|framed']), 'an ordinary card is treated as unframable');
assert.ok(t.framable(byName['A Token|framed']),
  'a token has no mana cost and a real type line - a frame draws it fine');
assert.ok(t.framable(byName['A Saga|framed']) && t.framable(byName['A Plane|framed']),
  'a Saga or a Plane was mistaken for something with no frame');
for (const k of ['Art // Art|borderless', 'Theme|framed'])
  assert.ok(!t.framable(byName[k]), `"${k}" has no cost, no type and no rules, yet claims a frame`);

const printed = t.MockCard(byName['Art // Art|borderless']);
assert.ok(!printed.includes('mottle'), 'an unframable printing still draws frame plates');
assert.ok(/cards\.scryfall\.io\/normal\//.test(printed) && !printed.includes('art_crop'),
  'an unframable printing asks for the art crop rather than the whole printed card');
assert.strictEqual(edge(printed), 'p-0', 'the scan is padded as though the wrapper drew its border');
// an art series card is still two-sided, and its back is the whole point of it
assert.ok(printed.includes('anat-flip') && printed.includes('/front/') && printed.includes('/back/'),
  'an unframable two-sided card lost the control that turns it over');
// ...and the size follows Config, because art_crop is the only one that cannot work
t.setQuality('sfart', 'large');
assert.ok(/cards\.scryfall\.io\/large\//.test(t.MockCard(byName['Theme|framed'])),
  'the printed card ignores the configured image size');
t.setQuality('sfart', 'art_crop');

// the class carries the count, so the page can say so rather than looking broken
const nf = Object.fromEntries(t.anatomyClasses().map(a => [a.k, a.nf]));
assert.strictEqual(nf['art_series | borderless'], 1, 'the census did not count the unframable art card');
assert.strictEqual(nf['normal | framed'], 0, 'the census called an ordinary card unframable');

// the page: one section per class, six each, strided rather than taken off the front
const classes = t.anatomyClasses();
assert.strictEqual(classes.length, new Set(t.ALL().map(t.anatomyKey)).size, 'the anatomy census lost a class');
for (const a of classes) {
  assert.ok(a.s.length <= t.ANATOMY_SAMPLES, `${a.k}: more than ${t.ANATOMY_SAMPLES} samples`);
  assert.strictEqual(a.s.length, Math.min(a.n, t.ANATOMY_SAMPLES), `${a.k}: wrong sample count`);
}
assert.ok(classes.every((a, i) => i === 0 || classes[i - 1].n >= a.n), 'classes are not ordered by how common they are');
go('#/anatomy');
for (const a of classes) assert.ok(painted.includes(`>${a.layout}</span>`), `#/anatomy lost the "${a.k}" section`);
assert.ok(painted.includes('no frame to draw'),
  '#/anatomy shows a scan in place of a frame and says nothing about why');

/* gen-art.mjs reads SIDED and the frameable rule from anatomy.js - the same
   file the page loads - so the two cannot disagree about which layouts have a
   back to fetch, or about which printings need the whole card rather than the
   crop. Both used to be copied in here and asserted equal. */
const genArt = readFileSync('gen-art.mjs', 'utf8');
assert.ok(/new Function\(`\$\{readFileSync\('anatomy\.js'/.test(genArt),
  'gen-art.mjs has its own copy of the anatomy rules again, which is how it asks for files it never wrote');
assert.ok(readFileSync('index.html', 'utf8').includes('src="anatomy.js"'),
  'the page does not load anatomy.js');
assert.ok(readFileSync('serve.py', 'utf8').includes("'/anatomy.js'"),
  'serve.py will 404 anatomy.js');
assert.ok(genArt.includes('User-Agent'),
  'gen-art.mjs sends the default node UA, which Scryfall 400s with a reason only the body carries');

assert.ok(/size === 'art_crop' && !framable\(or\)/.test(genArt),
  'gen-art.mjs fetches the art crop for printings that are drawn as whole cards');

// local art is a path, online art is a URL, and both key the back off /back/
t.setSrc('sfart', 'local');
assert.ok(t.artUrl(byName['Turner // Turned|framed'], 1).startsWith('art/sf/art_crop/back/'),
  'the local back-face path is wrong');
assert.ok(t.MockCard(byName['Turner // Turned|framed']).includes('onerror='),
  'local art does not fall through to the CDN when the file was never fetched');
t.setSrc('sfart', 'online');
assert.ok(t.artUrl(byName['Turner // Turned|framed'], 1).startsWith('https://cards.scryfall.io/art_crop/back/'),
  'the online back-face URL is wrong');

console.log(`card anatomy: ${classes.length} classes drawn, ${t.SIDED.size} two-sided layouts, ${
  t.PAIRED.size} paired, ${t.LANDSCAPE.size} sideways, ${t.OVERLAID.size} with the art under the text.`);

/* THE FILTER FILTERS. Every chip drew a real count and narrowed nothing: CARDS()
   sorted the scope and sliced it, chip() rendered a span with no handler, and
   Apply had no onclick at all. The counts became real before the click did,
   which made it worse rather than better - a number you can trust on a control
   that does nothing.

   Asserted against answers written out here rather than asked of the app: the
   app agreeing with itself is what a shared bug looks like. */
{
  /* Bear HAS flying; Sliver only TALKS about it, and Sliver's oracle tuple stops
     before the keyword slot the way a cards.json.gz generated before the field
     existed does. Between them they are the whole keyword fix: the regex over
     the rules text said yes to both. */
  const FIX = { kws: ['', 'Flying|Trample'], o: [
      ['Bear',   '{1}{G}', 'Creature - Bear',  'Text.', '2/2', 'G', 2, 'normal', '', 0, 0b000000100, 0, 1],
      ['Bolt',   '{R}',    'Instant',          'Text.', '',    'R', 1, 'normal', '', 0, 0b000000100],
      ['Wrath',  '{2}{W}{W}', 'Sorcery',       'Text.', '',    'W', 4, 'normal', '', 0, 0],
      ['Sliver', '{U}',    'Creature - Sliver', 'Creatures you control have flying.', '1/1', 'U', 1, 'normal', '', 0, 0b000000100],
  ], p: [
      [0, 'AAA', '1', 1, '00000000-0000-4000-8000-000000000041', 0, 0, 1],
      [1, 'AAA', '2', 3, '00000000-0000-4000-8000-000000000042', 0, 0, 1],
      [2, 'AAA', '3', 4, '00000000-0000-4000-8000-000000000043', 0, 0, 1],
      [3, 'AAA', '4', 1, '00000000-0000-4000-8000-000000000044', 0, 0, 1],
  ] };
  const only = () => t.filtered().map(c => c.n).sort().join(',');
  t.loadCards(FIX);
  t.pickGame('mtg'); go('#/search'); t.clearFilter();
  assert.strictEqual(only(), 'Bear,Bolt,Sliver,Wrath', 'a cleared filter is not the whole scope');

  /* NOTHING NARROWS UNTIL APPLY, the convention the sort bar sets. A chip that
     filtered on click would make this a different app from the one the sort
     lives in. */
  t.toggleChip('Type', 'Creature');
  assert.strictEqual(only(), 'Bear,Bolt,Sliver,Wrath', 'a staged chip narrowed the list before Apply');
  assert.ok(t.filterDirty(), 'a staged chip leaves the filter clean, so Apply stays dimmed');
  t.applyFilter();
  assert.strictEqual(only(), 'Bear,Sliver', 'Apply did not apply');
  assert.ok(!t.filterDirty(), 'the filter is still dirty after Apply');

  // OR inside a group: two types means either, because ANDing them is always empty
  t.toggleChip('Type', 'Instant'); t.applyFilter();
  assert.strictEqual(only(), 'Bear,Bolt,Sliver', 'two chips in one group ANDed, which can only be empty');
  // AND across groups
  t.toggleChip('Rarity', 'Common'); t.applyFilter();
  assert.strictEqual(only(), 'Bear,Sliver', 'two groups ORed, so narrowing one widened the list');
  // TRI-STATE: a second click is a veto, whatever else the card matches
  t.toggleChip('Type', 'Creature');
  assert.strictEqual(t.chipState('Type', 'Creature'), '-', 'the second click did not make a chip a veto');
  t.applyFilter();
  assert.strictEqual(only(), '', 'an excluded chip still let its cards through');
  t.toggleChip('Type', 'Creature');
  assert.strictEqual(t.chipState('Type', 'Creature'), '', 'the third click did not clear the chip');
  // ...and the three states on ONE chip with nothing else in the way, so the
  // round trip is the assertion rather than an interaction with two other groups
  t.clearFilter();
  t.toggleChip('Type', 'Creature'); t.applyFilter();
  assert.strictEqual(only(), 'Bear,Sliver', 'include did not shortlist');
  t.toggleChip('Type', 'Creature'); t.applyFilter();
  assert.strictEqual(only(), 'Bolt,Wrath', 'exclude did not veto');
  t.toggleChip('Type', 'Creature'); t.applyFilter();
  assert.strictEqual(only(), 'Bear,Bolt,Sliver,Wrath', 'off did not put the whole scope back');

  // ranges: both ends optional, and a blank end is not a zero
  t.clearFilter(); t.setRange('Mana value', 0, 2); t.applyFilter();
  assert.strictEqual(only(), 'Bear,Wrath', 'a from-only range did not bound one end');
  t.setRange('Mana value', 1, 2); t.applyFilter();
  assert.strictEqual(only(), 'Bear', 'a two-ended range did not bound both');
  t.setRange('Mana value', 0, ''); t.applyFilter();
  assert.strictEqual(only(), 'Bear,Bolt,Sliver', 'clearing one end of a range did not open it');
  // ...and a card with no number is OUT of a numeric range rather than a zero
  t.clearFilter(); t.setRange('Power', 0, 0); t.applyFilter();
  assert.strictEqual(only(), 'Bear,Sliver', 'a card with no power was filed under power zero');

  // the bitmask groups reach the right bit
  t.clearFilter(); t.toggleChip('Legality', 'Modern'); t.applyFilter();
  assert.strictEqual(only(), 'Bear,Bolt,Sliver', 'the legality chip reads the wrong bit');

  /* KEYWORDS ARE THE CARD'S OWN LIST, NOT A SEARCH OF ITS TEXT. Sliver says
     "creatures you control have flying" and does not have flying; the regex this
     replaces could not tell the difference, and no amount of \b fixes it. */
  t.clearFilter(); t.toggleChip('Keywords', 'Flying'); t.applyFilter();
  assert.strictEqual(only(), 'Bear', 'a card that only mentions a keyword is filtered as having it');
  // a card whose payload predates the field has no keywords, not every keyword
  t.toggleChip('Keywords', 'Flying'); t.applyFilter();
  assert.strictEqual(only(), 'Bolt,Sliver,Wrath', 'excluding a keyword took out cards that never had one');
  /* And the vocabulary is the catalogue's, not four words hardcoded in the
     anatomy spec - which is why Exalted, one of those four, is not in it. */
  t.clearFilter();
  // stringified because the page's arrays are built in the vm's realm, where
  // deepStrictEqual's prototype check fails on values that are otherwise equal
  assert.strictEqual(JSON.stringify(t.facetCounts().Keywords), '[["Flying",1],["Trample",1]]',
    'the keyword chips are still the hand-picked list rather than what is in scope');

  /* COUNTS ARE TAKEN WITH THE OTHER GROUPS APPLIED AND THIS ONE'S IGNORED, so a
     chip reads what you would get by ALSO clicking it. Counted against the whole
     filter, everything you have not picked reads 0 and the sidebar becomes a
     wall of zeroes the moment you narrow anything. */
  t.clearFilter(); t.toggleChip('Type', 'Creature'); t.applyFilter();
  const byLabel = (g) => Object.fromEntries(t.facetCounts()[g]);
  assert.strictEqual(byLabel('Type').Instant, 1,
    'the counted group applies its own terms, so every chip you have not picked reads zero');
  assert.strictEqual(byLabel('Type').Creature, 2, 'the counted group lost its own chip');
  assert.strictEqual(byLabel('Rarity').Common, 2,
    'another group is counted without the filter, so it promises cards the filter will not give');
  assert.strictEqual(byLabel('Rarity').Mythic, 0, 'a rarity the filter excludes is still counted');

  /* A PAGE, NOT A CEILING. The old ceiling sliced and stopped; this is how many are
     drawn now, and the sentinel at the end asks for the next page. */
  t.clearFilter();
  assert.strictEqual(t.P.page, t.PAGE, 'clearing the filter did not put the paging back to the top');
  // a display first: with none chosen the page draws no cards, and the sentinel
  // is deliberately absent there - see the assertion at the end of this block
  t.setView('compact');
  t.P.page = 2; go('#/search');
  assert.strictEqual(t.CARDS().length, 2, 'the page size is not what gets drawn');
  assert.ok(painted.includes('data-more'), 'there is no sentinel, so the rest of the list is unreachable');
  assert.ok(painted.includes('2 more'), 'the sentinel does not say how many are still to come');
  t.P.page = 99; go('#/search');
  assert.ok(!painted.includes('data-more'), 'the sentinel survives a fully drawn list');
  /* ...and a page that draws NO cards has no end to reach. The sentinel used to
     render under "No display chosen", where it is on screen from the first frame
     with nothing above it: it came into view, paged, re-rendered, came into view
     again, and had the whole filtered list drawn - 9,838 cards - before anyone
     touched the scroll wheel. */
  const view = t.P.view; t.P.view = null; t.P.page = 2; go('#/search');
  assert.ok(!painted.includes('data-more'),
    'a page with nothing drawn still asks for more, which pages the whole list on its own');
  t.P.view = view; t.P.page = t.PAGE;

  // and the controls are controls now, where there is a rule behind them
  t.clearFilter(); go('#/search');
  assert.ok(/onclick="toggleChip\('Type','Creature'\)"/.test(painted), 'a Type chip is not clickable');
  assert.ok(/onchange="setRange\('Mana value',0,this.value\)"/.test(painted), 'a range end is not wired');
  assert.ok(painted.includes('onclick="applyFilter()"') && painted.includes('onclick="clearFilter()"'),
    'Apply and Clear are still decoration');
  /* The other game keeps the picture: FACET is Magic's vocabulary, and a Pokemon
     Legality chip says Expanded, which FORMATS knows nothing about. */
  t.pickGame('pokemon'); go('#/search');
  assert.ok(!/onclick="toggleChip\('Legality'/.test(painted), 'the other game filters by Magic vocabulary');
  t.pickGame('mtg'); t.clearFilter();
}

/* --- the break is one element, and continuous fields cannot group -----
   Needs a scope with more than twenty of something: over the 18 mock rows every
   field has under twenty values, so every field is groupable and the rule this
   asserts is invisible. That is the rule working - twenty sets is a grouping,
   four hundred is a caption on every row - but it is not a test. */
{
  const many = { o: [], p: [] };
  for (let i = 0; i < 25; i++) {
    many.o.push([`Card ${i}`, '{G}', 'Creature - Elf', 'Text.', '1/1', 'G', 1, 'normal', '', 0, 0]);
    many.p.push([i, `S${String(i).padStart(2, '0')}`, String(i + 1), 1,
      `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, 0, 0, 1]);
  }
  t.loadCards(many);
  t.pickGame('mtg'); go('#/search');
  assert.strictEqual(t.scopedCards().length, 25, 'the wide fixture did not load');

  // 25 sets and 25 numbers against one main type and one rarity
  /* THE ROLE IS DECLARED, NOT SAMPLED, so it is the same answer in a binder of
     twelve and in a search of 107,347. It used to be counted over the first
     2,000 rows of the current scope, which made the same chip movable in one
     place and refused in another.
     The line is not 20 either. Counted over the whole catalogue every field's
     group label lands in one of two clusters with NOTHING between them: 1..94
     (hp, rarity, price, kind, colour, mana, language, ... type at 94) and
     411..37,115 (release date, release, set, artist, number, full name). The
     4.4x gap is the boundary, and it is measured rather than chosen. */
  assert.strictEqual(t.groupable('set'), false, '986 sets is being offered as a grouping');
  assert.strictEqual(t.groupable('number'), false, '12,651 collector numbers is being offered as a grouping');
  assert.strictEqual(t.groupable('release'), false, '460 releases is being offered as a grouping');
  assert.strictEqual(t.groupable('name'), false, 'name is a grouping again - A-Z pages are captions, not a filing');
  assert.strictEqual(t.groupable('kind'), true, 'main type is not groupable');
  assert.strictEqual(t.groupable('rarity'), true, 'rarity is not groupable');
  assert.strictEqual(t.groupable('type'), true, 'the type line at 94 is under the step and should group');
  // an unknown field is sort, never category: a role nobody counted cannot
  // become a page grouping by default
  assert.strictEqual(t.groupable('nonesuch'), false, 'an uncounted field defaults to being a grouping');
  /* THE SPLIT IS DERIVED, so what can be asserted here is the RULE, not a table.
     The harness runs on mocks and a handful of rows cannot be clustered - every
     field lands in one bucket, which would make collector number a grouping -
     so below ROLE_MIN everything is `sort` and the assertions above are about
     that safe direction. The derivation itself is exercised against a real
     catalogue further down. */
  /* THE COLD-START TABLE IS WHAT IS RUNNING HERE, and that is the case worth
     pinning in a harness with no network: eighteen mock rows cannot be
     clustered - every field lands under any boundary you pick, which would make
     collector number a page grouping - so the roles the real catalogue last
     produced stand in until it arrives. */
  assert.ok(t.ALL().length < t.ROLE_MIN, 'the mock fallback is no longer the case under test here');
  assert.strictEqual(t.roleCount('set'), null, 'the cold-start roles are claiming a measured count');

  /* THE BREAK IS STILL ALWAYS THERE, AND IT IS NO LONGER ON SCREEN. One is all
     the layout can use - `grouping()` is everything left of the FIRST one - so
     it stays a permanent element of the array, and every layout and the export
     read the split off it. What changed is that it is not DRAWN: the two sides
     are two labelled zones, so the separator is the boundary between them
     rather than a chip you drag into place and have to reason about. */
  t.clearSort();
  assert.strictEqual(t.P.sortDraft.map(x => x.f).join(), 'BREAK', 'Clear did not leave the break behind');
  go('#/search');
  assert.ok(!painted.includes('+ Break'), 'the Add Break button is still there');
  assert.ok(!painted.includes('&#8801; Break'), 'the break is drawn as a chip again');
  assert.ok(!/dragSort\(\d+\)"[^>]*>[\s\S]{0,80}Break/.test(painted), 'the break is draggable again');
  // one break in the array, always - the zones are a view of it, not a copy
  assert.strictEqual(t.P.sortDraft.filter(x => x.f === 'BREAK').length, 1, 'there is not exactly one break');
  t.addSortTo('rarity', 'group'); t.addSortTo('set', 'sort');
  assert.strictEqual(t.P.sortDraft.filter(x => x.f === 'BREAK').length, 1,
    'adding to the zones changed how many breaks there are');
  t.clearSort();

  // a field lands on the side it can work on
  t.addSort('kind');
  assert.strictEqual(t.P.sortDraft.map(x => x.f).join(), 'kind,BREAK', 'a groupable field did not join the grouping');
  t.addSort('set');
  assert.strictEqual(t.P.sortDraft.map(x => x.f).join(), 'kind,BREAK,set',
    'a field with too many values to group landed on the grouping side');

  // and it cannot be dragged across - refused, not corrected
  t.dragSort(2); t.moveSort(0);
  assert.strictEqual(t.P.sortDraft.map(x => x.f).join(), 'kind,BREAK,set',
    'a continuous field was dragged into the grouping');
  // nor can the break be dragged over it, which is the same illegal state
  t.dragSort(1); t.moveSort(2);
  assert.strictEqual(t.P.sortDraft.map(x => x.f).join(), 'kind,BREAK,set',
    'the break was dragged past a field that cannot group');
  // a legal drag still works: the break to the front, so nothing groups
  t.dragSort(1); t.moveSort(0);
  assert.strictEqual(t.P.sortDraft.map(x => x.f).join(), 'BREAK,kind,set',
    'the break cannot be dragged to the front');
  t.applySort();
  assert.strictEqual(t.grouping().length, 0, 'the break at the front still groups');
  t.clearSort();
}

/* EVERY PRINTING, OUT OF THE CATALOGUE. This band drew four invented rows -
   the same set in another language, the opposite finish at a made-up multiple of
   the price, and a hardcoded reprint - under a heading reading "every printing of
   this card". Seeded here rather than asserted against the mocks, because the
   fault was that four was a plausible-looking number: the fixture gives one name
   three real printings and another one, and the band must draw exactly those. */
{
  const oracle = (n) => [n, '{1}', 'Artifact', 'Text.', '', '', 1, 'normal', '', 0, 0];
  t.loadCards({ o: [oracle('Sol Ring'), oracle('Black Lotus')], p: [
    [0, 'LEA', '269', 3, '00000000-0000-4000-8000-000000000051', 1.5, 0, 1],
    [0, 'LEB', '270', 3, '00000000-0000-4000-8000-000000000052', 800, 0, 1],
    [0, 'CMD', '261', 3, '00000000-0000-4000-8000-000000000053', 1.84, 0, 2, 'de'],
    [1, 'LEA', '232', 3, '00000000-0000-4000-8000-000000000054', 9999, 0, 1],
  ] });
  t.pickGame('mtg');
  assert.strictEqual(t.printingsOf('Sol Ring').length, 3, 'the card page invents or drops printings');
  assert.strictEqual(t.printingsOf('Black Lotus').length, 1, 'a one-printing card gets more than one');
  // opened on the printing you clicked, not on whichever the catalogue lists first
  t.openCard('Sol Ring', 'CMD/261/de');
  assert.strictEqual(t.openedCard().set, 'CMD', 'the card did not open on the printing that was clicked');
  assert.ok(painted.includes('>de<'), 'the opened printing did not bring its own language');
  // ...and every printing is drawn, each one selectable
  for (const code of ['LEA', 'LEB', 'CMD'])
    assert.ok(painted.includes(`>${code}</span>`), `the printings band is missing ${code}`);
  assert.ok(!painted.includes('>232<'), 'another card\'s printing is listed under this one');
  /* Each row is a way to show that printing - and it is the LIST's own renderer
     doing it, not a table the card page drew for itself. `openCard(name, key)`
     on the page you are already on IS pickPrinting: same name, new printing,
     same route, so the ordinary row needs no card-page special case. */
  assert.strictEqual((painted.match(/openCard\('Sol Ring','[A-Z]+\//g) || []).length, 3,
    'the printings are not each a way to show that printing');
  t.pickPrinting('LEA/269/en');
  assert.strictEqual(t.openedCard().set, 'LEA', 'picking a printing did not switch to it');
  assert.ok(painted.includes('>showing<'), 'nothing says which printing is on show');
  // the band counts what it drew rather than a number written next to it
  assert.ok(painted.includes('>3 in the catalogue'), 'the printings band does not state its own count');

  /* A PRINTING'S FINISHES ARE NOT A HOLDING'S FOIL FLAG. `finishOf` answers "is
     the copy in your binder foil", which is 0 on every catalogue row - so a
     foil-only printing read "Nonfoil", and 12,396 of them did. The printing's
     own finishes are the `fin` bitmask, and a printing can be more than one. */
  const nonfoil = { fin: 0b001 }, foil = { fin: 0b010 }, both = { fin: 0b011 }, etched = { fin: 0b100 };
  assert.strictEqual(t.finishesOf(nonfoil), 'Nonfoil', 'a nonfoil printing lost its finish');
  assert.strictEqual(t.finishesOf(foil), 'Foil', 'a foil-only printing still reads Nonfoil');
  assert.strictEqual(t.finishesOf(both), 'Nonfoil &middot; Foil', 'a printing issued in both shows only one');
  assert.strictEqual(t.finishesOf(etched), 'Etched', 'etched is not read off the mask');
  // ...and a card with no mask at all - the mocks - still answers from its flag
  assert.strictEqual(t.finishesOf({ foil: 1 }), 'Foil', 'a card with no mask lost its holding finish');
  assert.strictEqual(t.finishesOf({}), '', 'a card with neither invented a finish');

  /* LEGALITY IS READ, NOT RECITED. The card page printed one fixed string for
     every Magic card - "Modern · Legacy · Vintage · Commander" - which is right
     for 11,405 of 107,347 and wrong for the other 89%. The bitmask has been
     there since the filter started counting it, so the page was contradicting
     the band above it. */
  const legalOf = (bits) => t.factsOf({ legal: bits }).Legality;
  assert.strictEqual(legalOf(0b000000100), 'Modern', 'a single-format card does not read its one format');
  assert.strictEqual(legalOf(0b000011100), 'Modern &middot; Legacy &middot; Vintage',
    'the formats are not read off the mask in order');
  /* Against the SPEC's own list, with no correction bolted on. This assertion
     used to read `... + ' · Historic'`, which was the drift written down: the
     sidebar's Legality chips were a hand-typed copy of FORMATS that had lost
     one, so the filter counted nine formats and offered eight. Both read the
     one list now, and a suffix here would hide it going wrong again. */
  // found by LABEL, not by position: Language moved in front of it and an index
  // read would have silently started asserting against a different group
  const legalityChips = t.GAMES.mtg.anatomy.find(x => x[1] === 'Legality')[2];
  assert.strictEqual(legalOf(0b111111111), legalityChips.map(x => x[0]).join(' &middot; '),
    'the Legality chips and the legality bitmask are not the same nine formats');
  /* 0 is NOT the same as absent, and this is the distinction the fallback turns
     on: 9,222 catalogue cards are legal in nothing tracked - tokens, art series,
     un-cards - while a mock row has no bitmask at all and keeps its fiction. */
  assert.strictEqual(legalOf(0), '', 'a card legal in nothing claims a format');
  assert.strictEqual(t.factsOf({}).Legality, 'Modern &middot; Legacy &middot; Vintage &middot; Commander',
    'a card with no bitmask lost the mock fallback');
  /* RESTRICTED IS LEGAL, AT ONE COPY. The generator counted only `legal` of the
     source's four states, so every restricted card - the Power Nine, Sol Ring -
     read as legal in NOTHING. It rides in `legal` so the filter counts what you
     can actually play, and `rest` says which formats limit you to one. */
  const vintage = 1 << 4;
  assert.strictEqual(t.factsOf({ legal: vintage, rest: 0 }).Legality, 'Vintage',
    'an unrestricted format is being marked restricted');
  assert.ok(t.factsOf({ legal: vintage, rest: vintage }).Legality.includes('Vintage'),
    'a restricted card lost the format it is legal in');
  assert.ok(/Vintage[\s\S]*restricted/.test(t.factsOf({ legal: vintage, rest: vintage }).Legality),
    'a restricted format does not say it is restricted');
  // and the two masks cannot disagree: you cannot be restricted where you are not legal
  for (const c of t.ALL()) if (c.rest !== undefined)
    assert.strictEqual(c.rest & ~c.legal, 0, `${c.n} is restricted in a format it is not legal in`);

  /* HOLDINGS ARE THE COPIES THAT EXIST, AND THEY LIVE ON THE PRINTING'S OWN ROW.
     There used to be a separate Holdings band; it was a second list of the same
     cards under the same page, from back when the printings list had no quantity
     column and could not answer "do I own this". Qty is a column everywhere now,
     so the band was one answer given twice, and two lists of the same cards on
     one page is how they come to disagree. What it carried that a column does
     not is WHERE, so a held printing names its containers on its own row. */
  // length, not deepStrictEqual: the page's arrays are built in the vm's realm,
  // where the prototype check fails on two values that are otherwise equal
  assert.strictEqual(t.heldOf('Sol Ring').length, 0, 'a card nobody owns still reports copies');
  t.setBand('prints', 'details'); go('#/card');
  assert.ok(!painted.includes('Alara block') && !painted.includes('Bant Exalted'),
    'the invented binder and deck are back');
  /* A CATALOGUE ROW'S QTY IS 0 BY CONSTRUCTION, which is what made the band look
     necessary: `printingsOf` hands back catalogue rows, so the Qty column read
     "none" on a card that was sitting in your binder. The rows are decorated
     with your real quantities before anything draws them. */
  assert.ok(painted.includes('title="Qty"><span class="text-neutral-700">&mdash;</span>'),
    'an unowned printing does not read as owning none');
  const one = t.ALL().find(c => c.set === 'LEA' && c.n === 'Sol Ring');
  t.LISTS.decks.unshift(['Test deck', '', '', '', [{ ...one, qty: 2 }, { ...one, qty: 1 }]]);
  t.holdingsChanged();
  const held = t.heldOf('Sol Ring');
  assert.strictEqual(held.length, 1, 'two copies of one printing are two holdings');
  assert.strictEqual(held[0][1], 'Test deck', 'the holding does not name the deck it is in');
  assert.strictEqual(held[0][2].qty, 3, 'the copies are not added up');
  // ...and that reaches the row: the quantity, and where the copies are
  go('#/card');
  assert.ok(/>3<\/span>\s*<span class="px-0\.5[^"]*">\|<\/span>/.test(painted),
    'the printing does not carry the copies you own');
  assert.ok(painted.includes('deck Test deck'), 'the printing does not say where the copies are');
  /* WHERE IS A COLUMN, SO IT IS THE SAME WIDTH ON EVERY ROW. It was drawn only
     on rows you hold and sized to whatever it said; the card cell beside it is
     `flex-1`, so it took what was left and a held row shunted its own
     type/rarity/qty/price out of line with the rows above it. */
  /* +1 for the header's INVISIBLE copy of the marker: the column header sits
     beside the same fixed width the rows reserve, or its labels sit a marker
     wide of the columns they name. */
  assert.strictEqual((painted.match(/w-28 shrink-0 truncate text-\[10px\]/g) || []).length,
    t.printingsOf('Sol Ring').length + 1,
    'the container column is not drawn on every printing, so the rows cannot line up');
  /* AND DETAILS CARRIES WHAT DIFFERS BETWEEN PRINTINGS. Type, rarity and mana
     value are facts about the ORACLE: down a list of printings of one card they
     are one string repeated, so the row spent its width saying nothing while
     which set, when, whose art and which CLASS were on no screen at all. */
  {
    const ps = t.printingsOf('Sol Ring');
    const sets = new Set(ps.map(c => t.setFact(c, 0)).filter(Boolean));
    assert.ok(sets.size > 1, 'the fixture cannot show a column that differs printing to printing');
    for (const s of [...sets].slice(0, 3))
      assert.ok(painted.includes(s), `details does not name the set (${s}), only its code`);
    assert.ok(painted.includes(t.setFact(ps[0], 2)), 'details does not carry the released date');
    /* THE CLASS IS TWO FACTS, SO IT IS TWO COLUMNS. It used to be one cell
       reading "normal | framed" - a layout AND a treatment glued together,
       which cannot be scanned down a column, and scanning a column is the only
       reason a column exists. */
    for (const part of t.anatomyKey(ps[0]).split(' | '))
      assert.ok(painted.includes(`<span class="font-mono">${part}</span>`),
        `details does not carry "${part}" as a column of its own`);
    assert.ok(!painted.includes(t.anatomyKey(ps[0])), 'the class is glued back into one cell');
    // the artist column by its label, not its value: this fixture has no
    // artists dictionary, so asserting a name here would assert the fixture
    assert.ok(painted.includes('title="Artist"'), 'details does not carry the artist');
  }
  /* THE PRINTINGS BAND GETS THE LIST'S THREE DISPLAYS, drawn by the list's own
     renderers -- writing a fourth here is how the card page comes to disagree
     with the list about what a card looks like. */
  for (const v of ['compact', 'details', 'grid']) {
    t.setBand('prints', v); go('#/card');
    assert.ok(painted.includes(`setBand('prints','${v}')`), `${v} is not offered as a display`);
    assert.ok(painted.includes('>showing<'), `${v} printings lost which one is on show`);
  }
  t.setBand('prints', 'grid'); go('#/card');
  assert.ok(painted.includes('aspect-[5/7]'), 'the grid printings do not draw the card');
  t.setBand('prints', 'details');
  t.LISTS.decks.shift(); t.holdingsChanged();

  /* ALIGN ART - every printing beside its own high-quality pull, so a
     misalignment noticed on one card can be pinned to a printing and then to
     that printing's CLASS. Offered on the printings band alone: holdings are
     copies you own, and how well the frame draws them is not a question about
     ownership. */
  t.setBand('prints', 'align'); go('#/card');
  assert.ok(painted.includes(`setBand('prints','align')`), 'the align display is not offered');
  assert.ok(!painted.includes(`setBand('hold','align')`), 'align is offered on the holdings band, where it answers nothing');
  const pulls = (painted.match(/cards\.scryfall\.io\/large\//g) || []).length;
  assert.strictEqual(pulls, t.printingsOf('Sol Ring').length,
    'align does not pull one high-quality image per printing');
  assert.ok(painted.includes('drawn &middot; printed'), 'align does not label the two halves');
  assert.ok(painted.includes(t.anatomyKey(t.openedCard())),
    'align does not name the class, which is the unit the verdict applies to');

  /* A CLASS THE FRAME CANNOT DRAW IS DECLARED, NOT NUDGED. The tempting fix for
     a misaligned class is a per-class offset, which is right for the printings
     it was tuned against and wrong for the rest -- extended art was exactly that
     until this week. Naming it here drops the class to the printed card, which
     cannot be misaligned because it IS the card.
     `fullart` was the first, put there by looking at this display: 6,085
     printings whose drawn plates matched no printed card in six samples of
     `normal | fullart` or twelve printings of Laboratory Maniac.
     `textless` is the second, on evidence the anatomy page had already gathered
     and that was offered twice before it was taken: 225 printings whose only
     uniform feature is the name -- SLD 1471 Mountain prints as a Windows-95 joke
     frame, P09 Cryptic Command as an oval-window promo. Same argument, same
     answer. Anything else goes in the same way -- looked at first -- because a
     class listed here stops being drawn at all, which is why this assertion is
     an exact list and not a membership test. */
  assert.deepStrictEqual([...t.UNALIGNED].sort().join(), 'fullart,textless',
    'the unalignable list changed -- was that decided against #/card\'s align display?');
  {
    const drawn = t.printingsOf('Sol Ring').find(c => !t.unaligned(c) && t.framable(c));
    const key = t.anatomyKey(drawn);
    const before = t.MockCard(drawn);
    // `mottle` is the tell that a frame was DRAWN: every plate of a drawn card
    // carries it and a printed scan carries nothing of ours
    assert.ok(before.includes('mottle'), 'the sample card was not being drawn to begin with');
    t.UNALIGNED.add(key);
    const after = t.MockCard(drawn);
    assert.ok(!after.includes('mottle'), 'declaring a class unalignable did not stop it being drawn');
    assert.ok(after.includes('cards.scryfall.io') || after.includes('art/sf/'),
      'an unalignable class draws neither a frame nor the printed card');
    t.UNALIGNED.delete(key);
  }
  /* THE NUMBERS, BECAUSE THIS IS THE DEBUG VIEW. It showed two pictures and a
     class name, which says THAT a card is wrong and nothing about why -- and why
     is always one of a handful of facts that were already computed and simply
     not on screen. `natural` is the one nothing else in the app can know: the
     crop's shape is not in the catalogue, Scryfall returns 626x457, 312x752,
     684x722 and more, and it is the usual reason a frame looks stretched. */
  t.setBand('prints', 'align'); go('#/card');
  for (const f of ['verdict', 'layout', 'geometry', 'sided', 'crop', 'card', 'natural'])
    assert.ok(painted.includes(`>${f}</dt>`), `align does not report "${f}"`);
  assert.ok(/naturalWidth/.test(painted), 'align does not read the crop\'s real size off the image');
  assert.ok(painted.includes('art_crop') && /\/(normal|large|png)\//.test(painted),
    'align does not name both URLs, so a wrong picture cannot be told from a misplaced one');
  {
    // the verdict names the RULE, not just the outcome -- there are two ways to
    // be pulled and they are different problems
    const full = t.printingsOf('Sol Ring').find(c => c.treat === 'fullart');
    if (full) {
      t.openCard('Sol Ring', t.printKey(full)); t.setBand('prints', 'align'); go('#/card');
      assert.ok(painted.includes('class declared unalignable'),
        'align does not say which rule pulled the printed card');
    }
  }
  t.setBand('prints', 'details');

  /* THE IDENTITY KEY IS SET + NUMBER + LANGUAGE, and finish is not in it: it is
     an attribute of the printing, which is why one row can offer two. Asserted
     over the fixture, and true of all 107,347 catalogue rows - 107,347 distinct
     keys, no collisions. */
  const keys = t.ALL().map(t.printKey);
  assert.strictEqual(new Set(keys).size, keys.length, 'set/number/language is not unique');
  assert.strictEqual(t.printKey({ set: 'LEA', num: '269' }), 'LEA/269/en',
    'a printing with no language recorded is not read as English');
}

/* THE ROW'S NAME IS A PREFIX OF THE CATALOGUE'S -- both faults behind the six
   rows of the real export that resolved to nothing. Measured before and after
   over MTGCards.csv: 2,451 matched / 150 ambiguous / 6 missed became 2,453 /
   154 / 0, and the totals reconcile at 2,607 either way. The two rules pull in
   opposite directions and both are wanted: the front face MATCHES a row that
   was being dropped, the parenthetical strip makes four rows AMBIGUOUS, which
   is the honest outcome for a card whose set is "Buy-A-Box Promos". */
{
  const oracle = (n) => [n, '{1}', 'Artifact', 'Text.', '', '', 1, 'normal', '', 0, 0];
  t.loadCards({ o: [oracle('Grizzled Outcasts // Krallenhorde Wantons'), oracle('Herald’s Horn'),
                    oracle('Ambush'), oracle('Ambush (Version 2)')], p: [
    [0, 'ISD', '193', 2, 'a1', 0.1, 0, 1],
    [1, 'C17', '228', 2, 'a2', 4.4, 0, 1],
    [1, 'CMM', '300', 2, 'a3', 3.9, 0, 1],
    [2, 'CSP', '51', 1, 'a4', 0.1, 0, 1],
    [3, 'CSP', '51a', 1, 'a5', 0.1, 0, 1],
  ] });
  t.pickGame('mtg');
  const row = (o) => t.resolveRow({ 'card name': '', 'set code': '', 'set name': '',
    'collector number': '', language: '', ...o });

  // 1. a transform card named by its front face, where the catalogue carries both
  const dfc = row({ 'card name': 'Grizzled Outcasts', 'set code': 'ISD' });
  assert.strictEqual(dfc.hits.length, 1, 'a transform card named by its front face resolves to nothing');
  assert.strictEqual(dfc.hits[0].num, '193', 'the front-face match landed on the wrong printing');
  // ...and it must not need the set: 4,926 catalogue rows carry a // name
  assert.strictEqual(row({ 'card name': 'Grizzled Outcasts' }).hits.length, 1,
    'the front face only matches when the set is already known');

  // 2. Collectr writes the variant into the product name; stripping it finds the
  //    card, and with no set to narrow on that is AMBIGUOUS rather than matched
  const paren = row({ 'card name': 'Herald’s Horn (Extended Art)' });
  assert.strictEqual(paren.hits.length, 2, 'the parenthetical variant still resolves to nothing');

  // 3. AS WRITTEN BEATS REDUCED. Trying the stripped name first would file
  //    "Ambush (Version 2)" as Ambush while an exact row for it exists.
  assert.strictEqual(row({ 'card name': 'Ambush (Version 2)', 'set code': 'CSP' }).hits[0].num, '51a',
    'the reduced name won over an exact one');
  assert.strictEqual(row({ 'card name': 'Ambush', 'set code': 'CSP' }).hits[0].num, '51',
    'an exact name picked up a variant');

  // 4. ...and neither rule widens a miss into a match
  assert.strictEqual(row({ 'card name': 'Nothing At All' }).hits.length, 0, 'an unknown name found a card');
  assert.strictEqual(row({ 'card name': '(Extended Art)' }).hits.length, 0,
    'a name that is nothing but a parenthetical matched everything');
}

/* CONFIG NAMES THE FILE THE PIPELINE ACTUALLY READS, and this is asserted
   ACROSS the two files rather than against a string typed twice. The row said
   `all_cards` / 392 MB while gen-cards.mjs builds the catalogue from
   default-cards / 78 MB, so both "is it here" and the disk a fresh machine was
   told to budget for were about a file nothing reads. A generator that changes
   which bulk file it opens now fails here instead of drifting. */
{
  const s = t.SOURCES.scryfall;
  const wants = s.file(s.def[1]);
  assert.ok(readFileSync('gen-cards.mjs', 'utf8').includes(wants),
    `config offers "${s.def[1]}" by default but gen-cards.mjs does not read ${wants}`);
  /* ...and the SECOND bulk file is named where a person would look. all-cards is
     not an optional bigger default-cards: it is the only file that can say which
     languages a printing exists in, so a catalogue built without gen-langs.mjs
     loses the pip column silently - correctly drawn as absent, with nothing
     anywhere telling you why or what to run. */
  assert.ok(readFileSync('gen-langs.mjs', 'utf8').includes(s.file('all_cards')),
    'gen-langs.mjs no longer reads the all_cards file config sends you to fetch');
  assert.ok(s.cmd('all_cards').includes('gen-langs.mjs'),
    'nothing on the config page names gen-langs.mjs, so the language column just goes missing');
  assert.ok(!s.cmd('oracle_cards').includes('gen-langs.mjs'),
    'every size is being told to run gen-langs, which only all_cards feeds');
}

/* EVERY LANGUAGE IS OFFERED, NOT THE TOP SIX. The cap is right for Subtype (868
   values) and Artist (2,527), where any list is a sample of an open vocabulary.
   Language is closed at 19 and is the ONE group that arrives already applied -
   so at six, widening to Japanese was possible and widening to Korean was not,
   with nothing on screen saying which. */
{
  const codes = ['en', 'ja', 'fr', 'de', 'es', 'it', 'zhs', 'pt', 'ko'];
  const oracle = (n) => [n, '{1}', 'Artifact', 'Text.', '', '', 1, 'normal', '', 0, 0];
  t.loadCards({ o: [oracle('Polyglot')],
    p: codes.map((lang, i) => [0, 'PLG', String(i + 1), 2, `a${i}`, 0.1, 0, 1, lang]) });
  t.pickGame('mtg'); t.clearFilter();
  const offered = t.facetCounts().Language.map(([code]) => code);
  assert.strictEqual(offered.length, codes.length,
    `the Language facet offers ${offered.length} of ${codes.length} languages in scope`);
  // ...and the one you would widen TO is reachable, which is the whole point
  assert.ok(offered.includes('ko'), 'the least-printed language in scope cannot be widened to');
}

/* THE GENERATOR AND THE PAGE NAME A SYMBOL THE SAME WAY, asserted across the two
   files rather than trusted. gen-symbols.mjs decides which 336 files to fetch and
   setIcon decides which one to ask for; if they disagree the app requests a name
   that was never written and every card silently loses its symbol. This is the
   same cross-file guard gen-cards/gen-langs get for their bulk files. */
{
  const gs = readFileSync('gen-symbols.mjs', 'utf8');
  const icons = new Set(t.SETS.map(r => (r[7] || r[1].toLowerCase())).filter(Boolean));
  assert.ok(/r\[7\]\s*\|\|\s*r\[1\]\.toLowerCase\(\)/.test(gs),
    'gen-symbols.mjs no longer derives a symbol name the way setIcon does');
  assert.ok(gs.includes('sym'), 'gen-symbols.mjs does not write where the page reads');
  /* 986 sets, 336 symbols - the collapse is the reason the local mirror is a
     megabyte, and it is a fact about the data rather than a number anyone chose:
     promos, tokens and Secret Lair variants point at their parent's icon. */
  assert.ok(icons.size < t.SETS.length / 2,
    'the icon override stopped collapsing sets onto shared symbols');
  // every set the app can draw resolves to a name the generator would fetch
  for (const r of t.SETS)
    assert.ok(icons.has(t.setIconUrl(r[1]).replace(/^.*\//, '').replace('.svg', '')),
      `set ${r[1]} asks for a symbol gen-symbols.mjs would never write`);
}

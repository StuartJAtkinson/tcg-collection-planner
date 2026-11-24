// MCP SERVER OVER THE CATALOGUE.
//
//   node mcp-server.mjs [collection.csv] [catalogue.json.gz]
//
// Read-only on purpose. MCP.md says why: marking a card owned is a claim about
// the physical world, and a model cannot check it and has every incentive to
// infer it from conversation. Wrong ownership is worse than none, because
// find_gaps is the whole point. So every tool here answers a question; none of
// them changes what you own.
//
// WHAT IT READS, all of it already in the repo:
//   cards.json.gz    the catalogue - the same file the page fetches
//   sets.js          the set list
//   <collection.csv> what you own - the export your collection tool writes
//
// NO DEPENDENCY. The MCP stdio transport is JSON-RPC 2.0 with one message per
// line, and this server needs five methods. The official SDK would be the
// first runtime dependency in a repo that has none, and it would be here for
// four message handlers.
//
// THE PAGE'S OWN RULES, NOT A COPY OF THEM. Matching an export row to a
// printing is the delicate half of the import: Collectr gives the set by NAME,
// leaves the collector number blank on 936 of its 2,796 rows, writes the
// variant into the product name, and states the foil in a column one field
// away from the question. Those rules live in index.html, where the app has
// spent three rounds getting them right. So the server runs the page's script
// in a vm - the same trick check.mjs uses - and asks the page. One
// implementation, so "which printing is this row" cannot mean two things.
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const [csvArg, catArg] = process.argv.slice(2);
const CSV = path.resolve(ROOT, csvArg || 'MTGCards.csv');
/* The catalogue is an argument so a test can hand the server a small one: the
   real cards.json.gz is 7 MB of generated data and is not in git, so a check
   that needs it never runs on a fresh clone. */
const CATALOGUE = path.resolve(ROOT, catArg || 'cards.json.gz');

/* THE PAGE, IN A VM. The stubs are check.mjs's: the page draws into a fake
   element, reads a Map behind the localStorage shape and asks nothing of the
   network. loadCards(seed) is the seam - it takes the catalogue as given, so
   nothing here has to fake a fetch. The page's console goes to stderr: stdout
   is the protocol channel, and a log line written there corrupts the stream. */
const page = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const src = `${['sets.js', 'schema.js', 'trim.js', 'anatomy.js']
  .map(f => readFileSync(path.join(ROOT, f), 'utf8')).join('\n')}
${page.match(/<script>([\s\S]*)<\/script>/)[1]}`;
const stderr = (...a) => process.stderr.write(`${a.join(' ')}\n`);
const ctx = vm.createContext({
  document: { getElementById: () => ({ set innerHTML(v) {} }), querySelector: () => null, set title(v) {} },
  localStorage: (() => { const m = new Map(); return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k) }; })(),
  location: { hash: '', reload: () => {} }, addEventListener: () => {}, setInterval: () => {},
  console: { log: stderr, info: stderr, warn: stderr, error: stderr },
  confirm: () => true,
});
vm.runInContext(`${src}
globalThis.__t = { loadCards, ALL, readImport, setCodeOf, SETS, pickGame, RARITY_NAME, printingsOf,
  get IMPORT_MATCHED() { return IMPORT_MATCHED; },
  get IMPORT_MISSED() { return IMPORT_MISSED; },
  get IMPORT_OTHER() { return IMPORT_OTHER; },
  get IMPORT_ROWS() { return IMPORT_ROWS; },
  get UNRESOLVED() { return UNRESOLVED; } };`, ctx);
const t = ctx.__t;

/* THE CATALOGUE, MATERIALISED BY THE PAGE. */
t.pickGame('mtg');
await t.loadCards(JSON.parse(gunzipSync(readFileSync(CATALOGUE))));
const ALL = t.ALL();

/* WHAT YOU OWN, BY THE PAGE'S OWN IMPORT. readImport is the app's import path:
   it reads the file, maps the columns, resolves every row to a printing and
   reports the rows it could not decide. The server calls it and reads what it
   filed, so there is no second set of rules to keep in step - the set-name
   spellings, the blank collector numbers, the variant in the product name and
   the foil in the column one field away are all handled once, in the page.
   A row that matched more than one printing is a decision the app asks you
   for; a server cannot ask, so those rows are counted and left out rather
   than guessed at. */
const owned = new Map();       // "SET/number" -> { qty, foil, lang, name }
const ownedPerSet = new Map(); // set -> owned printings
const seen = { rows: 0, matched: 0, ambiguous: 0, missed: 0, other: 0 };
const readCollection = async () => {
  if (!existsSync(CSV)) { stderr(`no collection file at ${CSV} - the tools will read the catalogue only`); return; }
  const text = readFileSync(CSV, 'utf8');
  await t.readImport({ name: path.basename(CSV), text: async () => text });
  for (const { card } of t.IMPORT_MATCHED) {
    const key = `${card.set}/${card.num}`;
    const prev = owned.get(key);
    owned.set(key, { qty: (prev?.qty || 0) + (card.qty || 1),
      foil: card.foil || prev?.foil || 0, lang: card.lang, name: card.n });
  }
  for (const key of owned.keys()) {
    const code = key.slice(0, key.indexOf('/'));
    ownedPerSet.set(code, (ownedPerSet.get(code) || 0) + 1);
  }
  seen.rows = t.IMPORT_ROWS;
  seen.matched = t.IMPORT_MATCHED.length;
  seen.ambiguous = t.UNRESOLVED.length;
  seen.missed = t.IMPORT_MISSED;
  seen.other = t.IMPORT_OTHER;
};
await readCollection();

/* THE CATALOGUE, COUNTED. One pass, because 107k rows is a scan and every
   tool that needs a total should not do its own. */
const total = new Map();       // set -> printings
const bySet = new Map();       // set -> printings
for (const c of ALL) {
  total.set(c.set, (total.get(c.set) || 0) + 1);
  if (!bySet.has(c.set)) bySet.set(c.set, []);
  bySet.get(c.set).push(c);
}
const ownedIn = (code) => ownedPerSet.get(code) || 0;
const rarityOf = (c) => (t.RARITY_NAME.mtg[c.rar - 1] || '');
const SET_BY_CODE = new Map(t.SETS.map(r => [r[1], r]));
/* A set may be named by its code or by its name, because people use both. */
const codeOf = (s) => {
  const up = String(s || '').trim().toUpperCase();
  return SET_BY_CODE.has(up) ? up : (t.setCodeOf(s) || '');
};

/* ============================ THE TOOLS ============================ */
const listSets = () => t.SETS
  .filter(r => total.get(r[1]))
  .map(r => ({ code: r[1], name: r[0], released: r[2], total: total.get(r[1]),
    owned: ownedIn(r[1]), draftable: !!r[6] }));

const listCards = ({ set, q, owned: onlyOwned, limit = 50 }) => {
  const cap = Math.min(Math.max(+limit || 50, 1), 500);
  const needle = (q || '').trim().toLowerCase();
  const code = set ? codeOf(set) : '';
  /* a set that did not resolve is not "no filter" - it is a wrong answer, and
     the wrong answer is the whole catalogue */
  if (set && !code) throw new Error(`no set called "${set}"`);
  const out = [];
  for (const c of ALL) {
    if (code && c.set !== code) continue;
    if (needle && !c.n.toLowerCase().includes(needle)) continue;
    const hold = owned.get(`${c.set}/${c.num}`);
    if (onlyOwned === true && !hold) continue;
    if (onlyOwned === false && hold) continue;
    out.push({ set: c.set, num: c.num, name: c.n, type: c.type, rarity: rarityOf(c),
      cmc: c.cmc, usd: c.usd, owned: !!hold, qty: hold?.qty || 0, foil: hold?.foil || 0 });
    if (out.length >= cap) break;
  }
  return { count: out.length, cards: out };
};

const getCard = ({ id }) => {
  const raw = String(id || '').trim();
  const slash = raw.indexOf('/');
  let card = null;
  if (slash > 0) {
    const code = codeOf(raw.slice(0, slash));
    const num = raw.slice(slash + 1);
    card = (bySet.get(code) || []).find(c => c.num === num) || null;
  }
  if (!card) {
    const all = t.printingsOf(raw);
    card = all[0] || null;
    if (!card) return null;
  }
  const hold = owned.get(`${card.set}/${card.num}`);
  const one = (c) => ({ set: c.set, num: c.num, name: c.n, rarity: rarityOf(c), type: c.type,
    layout: c.layout, cmc: c.cmc, usd: c.usd, art: c.art, text: c.text, kw: c.kw,
    faces: (c.faces || []).map(f => ({ name: f.n, type: f.type, cost: f.cost, text: f.text })),
    owned: !!owned.get(`${c.set}/${c.num}`), qty: owned.get(`${c.set}/${c.num}`)?.qty || 0 });
  return { card: one(card), printings: t.printingsOf(card.n).map(one),
    holding: hold ? { qty: hold.qty, foil: !!hold.foil, lang: hold.lang } : null };
};

const collectionStats = ({ set } = {}) => {
  const code = set ? codeOf(set) : '';
  if (set && !code) throw new Error(`no set called "${set}"`);
  const rows = [...total].map(([s, n]) => ({ code: s, total: n, owned: ownedIn(s) }))
    .filter(r => !code || r.code === code);
  const all = code ? (bySet.get(code) || []) : ALL;
  const rarity = new Map();
  for (const c of all) {
    const k = rarityOf(c) || 'Unknown';
    const r = rarity.get(k) || { rarity: k, total: 0, owned: 0 };
    r.total++;
    if (owned.has(`${c.set}/${c.num}`)) r.owned++;
    rarity.set(k, r);
  }
  const tot = rows.reduce((t2, r) => t2 + r.total, 0);
  const own = rows.reduce((t2, r) => t2 + r.owned, 0);
  return { set: code || null, printings: tot, owned: own, missing: tot - own,
    percent: tot ? Math.round((own / tot) * 1000) / 10 : 0,
    byRarity: [...rarity.values()],
    bySet: rows.map(r => ({ ...r, percent: r.total ? Math.round((r.owned / r.total) * 1000) / 10 : 0 })),
    collection: { ...seen, file: path.basename(CSV) } };
};

const findGaps = ({ set }) => {
  const code = codeOf(set);
  if (!code) throw new Error(`no set called "${set}"`);
  const cards = bySet.get(code) || [];
  const missing = cards.filter(c => !owned.has(`${code}/${c.num}`))
    .sort((a, b) => String(a.num).localeCompare(String(b.num), undefined, { numeric: true }))
    .map(c => ({ num: c.num, name: c.n, type: c.type, rarity: rarityOf(c) }));
  const row = SET_BY_CODE.get(code);
  return { set: code, name: row ? row[0] : '', total: cards.length,
    owned: cards.length - missing.length, missing: missing.length, cards: missing };
};

/* =========================== THE RESOURCES =========================== */
const RESOURCES = [
  { uri: 'cards://sets', name: 'Sets', description: 'Every set in the catalogue, with how many printings it has and how many you own' },
  { uri: 'cards://stats', name: 'Stats', description: 'Ownership summary: totals, by rarity and by set' },
];
const resourceText = (uri) => uri === 'cards://sets'
  ? JSON.stringify({ sets: listSets() })
  : JSON.stringify(collectionStats());

/* =========================== THE PROTOCOL =========================== */
const TOOLS = [
  { name: 'list_sets', description: 'Every set in the catalogue with its printing count, how many you own and whether it can be drafted',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_cards', description: 'Cards in the catalogue, filtered by set, by name or by whether you own them',
    inputSchema: { type: 'object', properties: {
      set: { type: 'string', description: 'Set code or name' },
      q: { type: 'string', description: 'Substring of the card name' },
      owned: { type: 'boolean', description: 'true for cards you own, false for the ones you do not' },
      limit: { type: 'number', description: 'How many to return, 50 by default, 500 at most' } } } },
  { name: 'get_card', description: 'One card with every printing of it, and which of them you own',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'A printing as SET/number, or a card name' } }, required: ['id'] } },
  { name: 'collection_stats', description: 'How much of the collection you own: overall, by rarity and by set',
    inputSchema: { type: 'object', properties: {
      set: { type: 'string', description: 'One set to report on; every set when left out' } } } },
  { name: 'find_gaps', description: 'What you are still missing from a set - the question the server exists for',
    inputSchema: { type: 'object', properties: {
      set: { type: 'string', description: 'Set code or name' } }, required: ['set'] } },
];
const RUN = { list_sets: listSets, list_cards: listCards, get_card: getCard,
  collection_stats: collectionStats, find_gaps: findGaps };
/* The protocol versions this server answers to. A client that asks for one of
   them gets it back; anything else gets the newest, which is what the spec
   says to do. */
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const bad = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
/* A tool that fails is a result with isError, not a protocol error: the model
   should read what went wrong and try something else, not see a dead socket. */
const toolError = (id, message) => ok(id, { content: [{ type: 'text', text: message }], isError: true });

const handle = (m) => {
  const { id, method, params = {} } = m;
  /* NO ID, NO REPLY. A notification is a message with no id, and JSON-RPC says
     a server must not answer one - answering an unknown notification wrote a
     response with no id to stdout, which a strict client reads as a stray
     message. */
  if (id === undefined) return;
  if (method === 'initialize') {
    const asked = params.protocolVersion;
    return ok(id, { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'card-collection', version: '1.0.0' } });
  }
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'resources/list') return ok(id, { resources: RESOURCES });
  if (method === 'resources/read') {
    const uri = params.uri;
    if (!RESOURCES.some(r => r.uri === uri)) return bad(id, -32602, `no resource called ${uri}`);
    return ok(id, { contents: [{ uri, mimeType: 'application/json', text: resourceText(uri) }] });
  }
  if (method === 'tools/call') {
    const fn = RUN[params.name];
    if (!fn) return toolError(id, `no tool called ${params.name}`);
    try {
      const out = fn(params.arguments || {});
      const text = JSON.stringify(out, null, 2);
      return ok(id, { content: [{ type: 'text', text }] });
    } catch (err) {
      return toolError(id, `${params.name} failed: ${err.message}`);
    }
  }
  return bad(id, -32601, `no method called ${method}`);
};

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let at;
  while ((at = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, at).trim();
    buf = buf.slice(at + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }   // a broken line is not a message
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
stderr(`card-collection: ${ALL.length} printings, ${owned.size} owned from ${path.basename(CSV)}`);

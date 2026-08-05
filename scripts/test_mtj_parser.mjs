// Mirror of the production streamMtgjson() state machine — used as a quick
// smoke harness against the cached AllPrintings.json.gz.
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

async function parseStream(input) {
  let buf = Buffer.alloc(0);
  let bufStart = 0;
  let pos = 0;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let pastMeta = false;
  let inData = false;
  let setStart = -1;
  let keyStart = -1;
  const sets = [];
  const cards = [];
  let parseFails = 0;

  for await (const chunk of input) {
    const c = chunk;
    buf = Buffer.concat([buf, c]);
    for (let i = 0; i < c.length; i++) {
      const ch = c[i];
      const abs = pos++;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === 0x5c) esc = true;
        else if (ch === 0x22) inStr = false;
        continue;
      }
      if (ch === 0x22) {
        if (depth === 2 && !inStr && keyStart === -1 && pastMeta && inData) keyStart = abs;
        inStr = true;
        continue;
      }
      if (ch === 0x7b || ch === 0x5b) {
        depth++;
        if (pastMeta && !inData && depth === 2) inData = true;
        else if (inData && depth === 3 && keyStart !== -1) setStart = keyStart;
        continue;
      }
      if (ch === 0x7d || ch === 0x5d) {
        if (inData && depth === 3 && setStart !== -1) {
          const slice = buf.subarray(setStart - bufStart, abs - bufStart + 1).toString('utf8');
          try {
            const wrapper = JSON.parse('{' + slice + '}');
            const code = Object.keys(wrapper)[0];
            sets.push(code);
            const set = wrapper[code];
            if (Array.isArray(set.cards)) for (const card of set.cards) cards.push(card);
            if (Array.isArray(set.tokens)) for (const tok of set.tokens) cards.push(tok);
          } catch (e) {
            parseFails++;
            if (parseFails <= 3) console.error(`parse fail at offset ${setStart}: ${e.message}`);
          }
          setStart = -1;
          keyStart = -1;
        } else if (inData && depth === 2) {
          inData = false;
        } else if (!pastMeta && depth === 2) {
          pastMeta = true;
        }
        depth--;
        continue;
      }
    }
    const keepFrom = Math.max(pastMeta ? setStart - bufStart : 0, 0);
    if (keepFrom > 0) { buf = buf.subarray(keepFrom); bufStart += keepFrom; }
  }
  return { sets, cards, parseFails, depth, pastMeta };
}

// Test against the cached AllPrintings.json.gz (177MB gz → 650MB raw).
// We slice the first ~5MB raw by streaming only a partial decompressed chunk.
import { spawn } from 'node:child_process';
const child = spawn('gzip', ['-dc', 'H:/GitHub/card-collection/data/AllPrintings.json.gz'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
// Take only 5MB then close stdin (kill).
let bytes = 0;
const LIMITED = 5 * 1024 * 1024;
let killed = false;
child.stdout.on('data', (chunk) => {
  bytes += chunk.length;
  if (bytes >= LIMITED && !killed) {
    killed = true;
    child.kill();
  }
});
const t0 = Date.now();
const r = await parseStream(child.stdout);
const t1 = Date.now();
console.log(`5MB smoke: ${r.sets.length} sets, ${r.cards.length} cards, ${r.parseFails} parse fails, ${t1 - t0}ms`);
console.log('first sets:', r.sets.slice(0, 5));
console.log('first card uuids:', r.cards.slice(0, 3).map((c) => c.uuid));
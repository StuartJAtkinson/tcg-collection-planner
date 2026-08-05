// Download Scryfall's all_cards bulk to data/scryfall-all-cards.jsonl.gz
// (a one-shot probe dependency; the refactor will reuse the same `download()` helper).
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DATA_DIR = path.resolve('data');
const DEST = path.join(DATA_DIR, 'scryfall-all-cards.jsonl.gz');
const HEADERS = { 'User-Agent': 'card-collection-importer/0.1', Accept: '*/*' };

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(DEST)) {
    console.log(`  using cached ${DEST} (${(statSync(DEST).size / 1e6).toFixed(0)} MB)`);
    return;
  }
  const res = await fetch('https://api.scryfall.com/bulk-data', { headers: HEADERS });
  const bulk: any = await res.json();
  const entry = bulk.data.find((d: any) => d.type === 'all_cards');
  const url = entry.jsonl_download_uri ?? entry.download_uri;
  console.log(`  downloading ${url}`);
  const r2 = await fetch(url, { headers: HEADERS });
  if (!r2.ok || !r2.body) throw new Error(`${r2.status}`);
  await pipeline(Readable.fromWeb(r2.body as any), createWriteStream(DEST));
  console.log(`  done ${(statSync(DEST).size / 1e6).toFixed(0)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Fetch the bulk files everything else here is generated FROM.
//   node gen-data.mjs [what...]     default: the two the page actually needs
//     scryfall[:type]   default_cards (what gen-cards.mjs reads) — or any bulk
//                       type Scryfall publishes: all_cards, oracle_cards,
//                       unique_artwork, rulings
//     mtgjson[:file]    AllPrintings (what gen-sets.mjs and gen-boosters.mjs
//                       read) — or AllPrices, Standard, Modern, Legacy
//     pokemon           the pokemon-tcg-data repo tarball
//
// This is the one piece of `npm run import` worth keeping. The rest of that
// script parsed these files into Postgres for an app that no longer exists; the
// download itself is what `gen-cards.mjs`, `gen-sets.mjs` and `gen-boosters.mjs`
// all stand on, and losing it would have meant the catalogue could never be
// regenerated after a set release.
//
// ponytail: no cache directory, no manifest, no resume. `data/` IS the cache —
// a file younger than the window is reused, which is the same 20-hour rule the
// importer used and the same one Config's "Download cache" row describes.
// Scryfall republishes daily and MTGJSON nightly, so a shorter window buys
// nothing but bandwidth on a link that has none to spare.
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const DATA = path.resolve('data');
const MAX_AGE_HOURS = 20;
/* Both of these 400 the default node User-Agent. Scryfall says so in the
   response body and nowhere else, which cost a diagnostic round-trip the first
   time; MTGJSON is less fussy but there is no reason to find out. */
const HEADERS = { 'User-Agent': 'card-collection/1.0 (+bulk fetch)', Accept: '*/*' };
const gb = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;

async function download(url, file) {
  mkdirSync(DATA, { recursive: true });
  const dest = path.join(DATA, file);
  if (existsSync(dest) && (Date.now() - statSync(dest).mtimeMs) / 36e5 < MAX_AGE_HOURS) {
    console.log(`  ${file} — cached, ${gb(statSync(dest).size)}, ${
      ((Date.now() - statSync(dest).mtimeMs) / 36e5).toFixed(1)}h old`);
    return dest;
  }
  process.stdout.write(`  ${file} — fetching… `);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(gb(statSync(dest).size));
  return dest;
}

/* Scryfall's bulk files are NOT at a stable URL — they carry a timestamp and
   are republished daily, so the download_uri has to be read from the API each
   time rather than written down here. MTGJSON's are static. */
async function scryfall(type) {
  const res = await fetch('https://api.scryfall.com/bulk-data', { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} fetching the Scryfall bulk index`);
  const { data } = await res.json();
  const entry = data.find(b => b.type === type);
  if (!entry) throw new Error(`no Scryfall bulk type "${type}" — have: ${data.map(b => b.type).join(', ')}`);
  // the .jsonl form, because gen-cards.mjs streams it a line at a time rather
  // than holding a 400 MB array in memory
  return download(entry.jsonl_download_uri || entry.download_uri,
    `scryfall-${type.replace(/_/g, '-')}.jsonl.gz`);
}
const mtgjson = file => download(`https://mtgjson.com/api/v5/${file}.json.gz`, `${file}.json.gz`);
const pokemon = () => download('https://github.com/PokemonTCG/pokemon-tcg-data/archive/master.tar.gz',
  'pokemon-tcg-data.tar.gz');

const args = process.argv.slice(2);
const jobs = args.length ? args : ['scryfall:default_cards', 'mtgjson:AllPrintings'];
console.log(`data/ — ${jobs.join(', ')}`);
for (const job of jobs) {
  const [what, arg] = job.split(':');
  if (what === 'scryfall') await scryfall(arg || 'default_cards');
  else if (what === 'mtgjson') await mtgjson(arg || 'AllPrintings');
  else if (what === 'pokemon') await pokemon();
  else { console.error(`unknown: ${job}`); process.exit(1); }
}
console.log('regenerate with: node gen-cards.mjs · node gen-sets.mjs · node gen-boosters.mjs');

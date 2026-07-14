// phase 1 self-check: the catalogue is complete and queryable
import { client } from './db/index.ts';

let failed = false;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'ok ' : 'FAIL'} ${label}`);
  if (!cond) failed = true;
}

const [{ n: nGames }] = await client`select count(*)::int n from games`;
const [{ n: nSets }] = await client`select count(*)::int n from sets`;
const [{ n: nMtg }] = await client`select count(*)::int n from cards where game_id = 'mtg'`;
const [{ n: nPkm }] = await client`select count(*)::int n from cards where game_id = 'pokemon'`;
const [{ n: nFacets }] = await client`select count(*)::int n from card_facets`;
const [{ n: nPrices }] = await client`select count(*)::int n from prices`;

check(`2 games (got ${nGames})`, nGames === 2);
check(`sets > 500 (got ${nSets})`, nSets > 500);
check(`mtg cards > 40k (got ${nMtg})`, nMtg > 40_000);
check(`pokemon cards > 10k (got ${nPkm})`, nPkm > 10_000);
check(`facets ≈ 3/card (got ${nFacets})`, nFacets > (nMtg + nPkm) * 2.5);
check(`mtg prices > 50k rows (got ${nPrices})`, nPrices > 50_000);

console.log('\nset checklist order — Base Set (pokemon):');
console.table(await client`
  select collector_number, name, rarity_raw from cards
  where set_id = 'base1' order by sort_key limit 5`);

console.log('checklist + facet filter — Kamigawa: Neon Dynasty (mtg) by color_combo:');
console.table(await client`
  select f.value as color_combo, count(*)::int as cards
  from card_facets f
  join cards c on c.id = f.card_id
  join sets s on s.id = c.set_id
  where s.code = 'neo' and f.facet = 'color_combo'
  group by 1 order by 2 desc limit 8`);

console.log('sets by release year (master-sets grouping):');
console.table(await client`
  select date_part('year', release_date)::int as year, count(*)::int as sets
  from sets where release_date is not null
  group by 1 order by 1 desc limit 5`);

await client.end();
process.exit(failed ? 1 : 0);

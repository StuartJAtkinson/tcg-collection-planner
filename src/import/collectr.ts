// Imports a Collectr CSV export (Settings -> Export -> CSV in the Collectr app) into holdings.
//
// Parsing + catalogue matching lives in ./run.ts (shared with the in-app importer). This CLI is
// the "commit everything now" path: it writes matched cards straight to holdings and pushes the
// unmatched rows into the import_unmatched table, which you then resolve in the app at /resolve
// (candidate search + a mock-card preview per candidate). The in-app import is the same core but
// stages matches for review before committing — use whichever you prefer.
//
// Quantities ADD on re-run: re-running the same file twice double-counts. Clear holdings first
// for a clean retry. Usage: node src/import/collectr.ts path/to/export.csv
import { readFileSync } from 'node:fs';
import { client } from '../db/index.ts';
import { portfolioToContainer } from './csv.ts';
import { runCollectrImport } from './run.ts';

async function main() {
  const path = process.argv[2];
  if (!path) { console.error('usage: node src/import/collectr.ts path/to/export.csv'); process.exit(1); }

  const { matched, unmatched, containers, skipped, watchlisted } = await runCollectrImport(readFileSync(path, 'utf8'));
  console.log(`${matched.length} matched, ${unmatched.length} unmatched, ${skipped} blank, ${watchlisted} watchlist`);
  console.log('note: quantities ADD on re-run — clear holdings first for a clean retry.\n');

  await client.begin(async (tx) => {
    // create each portfolio container with its presumed kind (Main -> unsorted handled below)
    for (const c of containers) {
      await tx`insert into containers (id, user_id, name, kind) values (${c.id}, 'stuart', ${c.name}, ${c.presumedKind})
               on conflict (id) do nothing`;
    }
    // ensure any 'unsorted'-bound container exists (portfolioToContainer maps Main/blank there)
    const unsorted = portfolioToContainer(undefined);
    await tx`insert into containers (id, user_id, name, kind) values (${unsorted.id}, 'stuart', ${unsorted.name}, ${unsorted.kind}) on conflict (id) do nothing`;

    for (const m of matched) {
      await tx`insert into holdings (user_id, card_id, finish, container_id, quantity, condition, grade, paid)
               values ('stuart', ${m.card_id}, ${m.finish}, ${m.container_id}, ${m.quantity}, ${m.condition}, ${m.grade}, ${m.paid})
               on conflict (user_id, card_id, finish, container_id)
               do update set quantity = holdings.quantity + excluded.quantity,
                             condition = coalesce(excluded.condition, holdings.condition),
                             grade = coalesce(excluded.grade, holdings.grade),
                             paid = coalesce(holdings.paid, excluded.paid)`;
    }

    await tx`delete from import_unmatched where user_id = 'stuart'`;
    for (const u of unmatched) {
      await tx`insert into import_unmatched (user_id, fields, reason) values ('stuart', ${tx.json(u.fields)}, ${u.reason})`;
    }
  });

  console.log(`containers: ${containers.length} portfolios (presumed binder/deck by >100 cards)`);
  console.log(`unmatched rows stored — resolve them at /resolve`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

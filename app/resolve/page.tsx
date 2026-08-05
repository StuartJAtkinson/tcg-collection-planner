import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import DeselectableRadio from '../components/DeselectableRadio.tsx';
import MockCard, { type MockFace } from '../components/MockCard.tsx';
import { client } from '../../src/db/index.ts';
import { commitImport, discardImport, resolveImportRows, runImport } from '../../src/actions.ts';
import { findCandidates } from '../../src/import/candidates.ts';
import { GAME_MAP, norm } from '../../src/import/csv.ts';
import { BTN_PRIMARY, BTN_SECONDARY, CHIP_NEUTRAL, CHIP_PLUS } from '../components/chip.ts';
import type { StagedContainer } from '../../src/import/run.ts';

export const dynamic = 'force-dynamic';

const USER = 'stuart';

// Build a minimal mock face straight from an unresolved import row (no catalogue match yet, so
// no oracle text/mana cost/art). Same logic as the now-removed importRowToMockFace helper.
function rowToFace(f: Record<string, string>): MockFace {
  const rarityRaw = f.rarity;
  const r = rarityRaw?.toLowerCase() ?? '';
  let rarityTier: number | null = null;
  if (r.includes('secret') || r.includes('special')) rarityTier = 5;
  else if (r === 'm' || r.includes('mythic') || r.includes('ultra') || r.includes('super')) rarityTier = 4;
  else if (r === 'r' || r.includes('rare')) rarityTier = 3;
  else if (r === 'p' || r.includes('promo')) rarityTier = 3;
  else if (r === 'u' || r.includes('uncommon')) rarityTier = 2;
  else if (r === 'c' || r.includes('common')) rarityTier = 1;
  return {
    name: f.name || '(unknown)',
    rarity: rarityRaw ?? null,
    rarityTier,
    setCode: f.setCode ?? f.set ?? null,
    collectorNumber: f.number ?? null,
    imageUrl: null,
  };
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const sp = await searchParams;
  const batch = sp.batch?.replace(/[^a-z0-9]/gi, '');

  // ---- staged locations step: only reachable straight after Run, via the ?batch token ----
  if (batch) {
    let stage: { containers: StagedContainer[]; matched: unknown[] } | null = null;
    try {
      stage = JSON.parse(readFileSync(path.join(os.tmpdir(), `cc-import-${batch}.json`), 'utf8'));
    } catch { stage = null; }

    if (!stage) {
      return (
        <div>
          <h1 className="mb-3 inline-block border-b-2 border-emerald-500 pb-1 text-xl font-semibold text-white">Import</h1>
          <p className="text-amber-400">That staged import is gone (committed, discarded, or expired). <a href="/resolve" className="underline">Start a new import.</a></p>
        </div>
      );
    }

    return (
      <div>
        <h1 className="mb-3 inline-block border-b-2 border-emerald-500 pb-1 text-xl font-semibold text-white">Import locations</h1>
        <p className="mb-6 max-w-3xl text-sm text-neutral-400">
          {stage.matched.length} cards matched, staged in {stage.containers.length} portfolio{stage.containers.length === 1 ? '' : 's'}. Each was
          presumed a <span className="text-emerald-300">Binder</span> (&gt;100 cards) or <span className="text-sky-300">Deck</span> (≤100) — override
          below, or leave neither and it drops into the unsorted pool. Nothing is saved until you click <span className="text-white">Import</span>;
          leave this page and the batch is dropped.
        </p>

        <form action={commitImport} className="max-w-3xl">
          <input type="hidden" name="batch" value={batch} />
          <div className="mb-4 grid gap-1.5">
            {stage.containers.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm">
                <span className="w-56 shrink-0 truncate">{c.name}</span>
                <span className="w-20 shrink-0 text-xs text-neutral-500">{c.count} cards</span>
                <div className="flex gap-1.5">
                  {(['binder', 'deck'] as const).map((k) => (
                    <label key={k} className={c.presumedKind === k ? CHIP_PLUS : CHIP_NEUTRAL}>
                      <DeselectableRadio name={`kind_${c.id}`} value={k} defaultChecked={c.presumedKind === k} className="sr-only" />
                      {k[0].toUpperCase() + k.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {stage.containers.length === 0 && (
              <p className="text-sm text-neutral-500">No named portfolios — all matched cards go to the unsorted pool.</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button className={BTN_PRIMARY}>Import</button>
            <button formAction={discardImport} className={BTN_SECONDARY}>Discard</button>
          </div>
        </form>
      </div>
    );
  }

  // ---- default view: the import panel + the persistent (DB-backed) unmatched resolver ----
  const unmatched = (await client`
    select id, fields, reason from import_unmatched where user_id = ${USER} order by id`) as unknown as {
    id: number; fields: Record<string, string>; reason: string | null;
  }[];

  const importPanel = (
    <section className="mb-10 max-w-xl rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-3 text-lg font-semibold text-neutral-300">Run an import</h2>
      <form action={runImport} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Source
          <select name="source" defaultValue="collectr" className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100">
            <option value="collectr">Collectr</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          CSV export
          <input type="file" name="file" accept=".csv" required className="text-sm text-neutral-300 file:mr-2 file:rounded file:border-0 file:bg-neutral-700 file:px-2 file:py-1 file:text-neutral-100" />
        </label>
        <button className={BTN_PRIMARY}>Run</button>
      </form>
      <p className="mt-2 text-xs text-neutral-500">Matches are staged for review (binder/deck) before anything is saved. Unmatched cards land in the resolver below.</p>
    </section>
  );

  if (!unmatched.length) {
    return (
      <div>
        <h1 className="mb-3 inline-block border-b-2 border-emerald-500 pb-1 text-xl font-semibold text-white">Import</h1>
        {importPanel}
        <p className="text-sm text-emerald-400">Nothing unresolved — every imported card has been matched.</p>
      </div>
    );
  }

  // candidates + portfolio grouping for the persistent unmatched rows
  const rowsWithCandidates = await Promise.all(
    unmatched.map(async (u) => {
      const f = u.fields ?? {};
      const gameHint = f.game ? GAME_MAP[norm(f.game)] : undefined;
      const unsupported = (u.reason ?? '').startsWith('unsupported game');
      const candidates = unsupported || !f.name ? [] : await findCandidates(f.name, f.set, gameHint, 5);
      return { id: u.id, f, reason: u.reason ?? '', candidates, portfolio: f.portfolio ?? '' };
    }),
  );

  const portfolios = [...new Set(rowsWithCandidates.map((r) => r.portfolio))];
  const groups = portfolios
    .map((portfolio) => ({ portfolio, rows: rowsWithCandidates.filter((r) => r.portfolio === portfolio) }))
    .sort((a, b) => b.rows.length - a.rows.length);

  return (
    <div>
      <h1 className="mb-3 inline-block border-b-2 border-emerald-500 pb-1 text-xl font-semibold text-white">Import</h1>
      {importPanel}

      <h2 className="mb-1 text-lg font-semibold text-neutral-300">Resolve unmatched cards</h2>
      <p className="mb-6 text-sm text-neutral-400">{unmatched.length} unresolved across {groups.length} portfolio{groups.length === 1 ? '' : 's'} — the lowest level of unsorted.</p>

      <form action={resolveImportRows}>
        <div className="flex flex-col gap-10">
          {groups.map((group) => (
            <div key={group.portfolio || '(none)'}>
              <div className="sticky top-12 z-10 mb-3 flex items-center gap-2 border-b border-neutral-800 bg-neutral-950/90 py-1.5 backdrop-blur">
                <span className="text-lg font-semibold">{group.portfolio || 'Main / unsorted'}</span>
                <span className="text-sm text-neutral-500">{group.rows.length} unmatched</span>
              </div>

              <div className="flex flex-col gap-6">
                {group.rows.map(({ id, f, reason, candidates }) => (
                  <div key={id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                    <div className="mb-3 flex items-start gap-4">
                      <div className="shrink-0">
                        <div className="rounded-lg border border-transparent p-1">
                          <MockCard faces={[rowToFace(f)]} />
                        </div>
                        <div className="mt-2 max-w-56 text-xs text-neutral-500">
                          {f.variant && <div>Variant: {f.variant}</div>}
                        </div>
                        <div className="mt-1 max-w-56 text-xs text-amber-400">{reason}</div>
                      </div>

                      {candidates.length === 0 ? (
                        <div className="self-center text-sm text-neutral-500">
                          No catalogue candidates — this game/card isn&apos;t supported yet.
                        </div>
                      ) : (
                        <div className="flex min-w-0 flex-col gap-2">
                          <div className="flex gap-4 overflow-x-auto pb-1">
                            {candidates.map((c) => (
                              <label
                                key={c.id}
                                className="w-56 shrink-0 cursor-pointer rounded-lg border border-transparent p-1 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-500/10"
                              >
                                <DeselectableRadio name={`choice_${id}`} value={c.id} className="sr-only" />
                                <div className="flex h-[313.6px] w-full items-center justify-center overflow-hidden rounded-lg border border-neutral-700">
                                  {c.image_small ? (
                                    <img src={c.image_small} alt={c.name} className="h-full w-full object-contain" />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-neutral-800 p-2 text-center text-xs text-neutral-400">
                                      {c.name}
                                    </div>
                                  )}
                                </div>
                                <div className="mt-1 text-center text-[10px] text-neutral-400">
                                  {c.set_name}
                                  <br />
                                  {Math.round(c.score * 100)}% match
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="fixed bottom-6 right-6 z-20 flex flex-col items-end gap-1">
          <button className={`${BTN_PRIMARY} shadow-lg`}>
            Resolve selected
          </button>
          <span className="rounded bg-neutral-950/90 px-2 py-1 text-xs text-neutral-400">
            Unselected rows stay unresolved for next time.
          </span>
        </div>
      </form>
    </div>
  );
}

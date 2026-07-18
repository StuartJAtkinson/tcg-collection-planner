import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { importRowToMockFace } from '../components/cardToMockFaces.ts';
import DeselectableRadio from '../components/DeselectableRadio.tsx';
import ImportLocations from '../components/ImportLocations.tsx';
import MockCard from '../components/MockCard.tsx';
import { client } from '../../src/db/index.ts';
import { resolveImportRows } from '../../src/actions.ts';
import { findCandidates } from '../../src/import/candidates.ts';
import { GAME_MAP, norm, parseCsv, portfolioToContainer, resolveHeaders } from '../../src/import/csv.ts';

export const dynamic = 'force-dynamic';

export default async function ResolvePage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string }>;
}) {
  const sp = await searchParams;
  const repoRoot = process.cwd();
  const onDisk = readdirSync(repoRoot).filter((f) => f.endsWith('-unmatched.csv'));

  const filePath = sp.file
    ? path.resolve(repoRoot, sp.file)
    : onDisk[0]
      ? path.resolve(repoRoot, onDisk[0])
      : undefined;

  if (!filePath) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">Import</h1>
        <ImportLocations />
        <p className="text-neutral-400">
          No <code>*-unmatched.csv</code> to resolve. Run{' '}
          <code>npm run import:collectr -- your-export.csv</code> to import a Collectr export, or pass{' '}
          <code>?file=path/to/file.csv</code>.
        </p>
      </div>
    );
  }

  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return <div className="text-red-400">Could not read {filePath}</div>;
  }

  const rows = parseCsv(text);
  const [header, ...dataRows] = rows;

  if (!dataRows.length) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-bold">Import</h1>
        <ImportLocations />
        <p className="text-emerald-400">
          {path.basename(filePath)} is empty — everything in it has been resolved.
        </p>
      </div>
    );
  }

  const idx = resolveHeaders(header);
  const reasonIdx = header.length - 1; // 'reason' is always the last column, appended by the importer
  const get = (row: string[], f: string) => (f in idx ? row[idx[f]]?.trim() : undefined);

  // No pagination — every unmatched row renders, grouped by its Collectr portfolio. Resolving
  // a card routes it to that portfolio's container (the location fixed at import time), so a
  // deck showing "3 unmatched" can be found by elimination once its matched cards are in place.
  const rowsWithCandidates = await Promise.all(
    dataRows.map(async (row, i) => {
      const name = get(row, 'name') ?? '';
      const setName = get(row, 'set');
      const gameField = get(row, 'game');
      const reason = row[reasonIdx] ?? '';
      const gameHint = gameField ? GAME_MAP[norm(gameField)] : undefined;
      const unsupported = reason.startsWith('unsupported game');
      const candidates = unsupported || !name ? [] : await findCandidates(name, setName, gameHint, 5);
      return { i, row, reason, candidates, portfolio: get(row, 'portfolio') ?? '' };
    }),
  );

  // group by portfolio; resolve each portfolio's target container (its actual kind if it
  // already exists from import, else the import guess) so the location can be shown
  const portfolios = [...new Set(rowsWithCandidates.map((r) => r.portfolio))];
  const existing = await client`select id, kind, name from containers`;
  const kindById = new Map(existing.map((c) => [c.id, c.kind as string]));
  const groups = portfolios
    .map((portfolio) => {
      const target = portfolioToContainer(portfolio || undefined);
      const kind = kindById.get(target.id) ?? target.kind;
      return { portfolio, target: { ...target, kind }, rows: rowsWithCandidates.filter((r) => r.portfolio === portfolio) };
    })
    .sort((a, b) => b.rows.length - a.rows.length);

  const kindStyle: Record<string, string> = {
    deck: 'bg-sky-500/20 text-sky-300',
    binder: 'bg-emerald-500/20 text-emerald-300',
    unsorted: 'bg-neutral-700 text-neutral-300',
  };

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Import</h1>
      <ImportLocations />
      <h2 className="mb-1 text-lg font-semibold text-neutral-300">Resolve unmatched cards</h2>
      <p className="mb-6 text-sm text-neutral-400">
        {filePath} · {dataRows.length} rows across {groups.length} portfolios
        {onDisk.length > 1 && (
          <span className="ml-3">
            other files:{' '}
            {onDisk.map((f) => (
              <Link key={f} href={`/resolve?file=${encodeURIComponent(f)}`} className="ml-1 underline">
                {f}
              </Link>
            ))}
          </span>
        )}
      </p>

      <form action={resolveImportRows}>
        <input type="hidden" name="file" value={filePath} />
        <div className="flex flex-col gap-10">
          {groups.map((group) => (
            <div key={group.portfolio || '(none)'}>
              {/* portfolio header: name + the location its resolved cards will land in */}
              <div className="sticky top-12 z-10 mb-3 flex items-center gap-2 border-b border-neutral-800 bg-neutral-950/90 py-1.5 backdrop-blur">
                <span className="text-lg font-semibold">{group.portfolio || 'Main / unsorted'}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs uppercase ${kindStyle[group.target.kind] ?? kindStyle.unsorted}`}>
                  → {group.target.kind}
                  {group.target.kind !== 'unsorted' ? `: ${group.target.name}` : ''}
                </span>
                <span className="text-sm text-neutral-500">{group.rows.length} unmatched</span>
              </div>

              <div className="flex flex-col gap-6">
          {group.rows.map(({ i, row, reason, candidates }) => (
            <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <input type="hidden" name={`raw_${i}`} value={JSON.stringify(row)} />
              <input type="hidden" name={`variant_${i}`} value={get(row, 'variant') ?? ''} />
              <input type="hidden" name={`quantity_${i}`} value={get(row, 'quantity') ?? ''} />
              <input type="hidden" name={`paid_${i}`} value={get(row, 'purchasePrice') ?? ''} />
              <input type="hidden" name={`condition_${i}`} value={get(row, 'condition') ?? ''} />
              <input type="hidden" name={`grade_${i}`} value={get(row, 'grade') ?? ''} />
              <input type="hidden" name={`gradingCompany_${i}`} value={get(row, 'gradingCompany') ?? ''} />
              <input type="hidden" name={`portfolio_${i}`} value={get(row, 'portfolio') ?? ''} />

              <div className="mb-3 flex items-start gap-4">
                {/* left: what was scanned, generated as a mock card — the raw import text has
                    no art, so this is the one place a fully vector/font card face earns its
                    keep. Commerce/tracking fields (price paid, condition, grade, quantity,
                    date...) aren't part of the physical card, so they're shown as plain text
                    below rather than folded into the card face. */}
                <div className="shrink-0">
                  {/* same border+padding shell as a candidate label so the mock card's top and
                      bottom line up with the real ones exactly — no label text above it */}
                  <div className="rounded-lg border border-transparent p-1">
                    <MockCard faces={[importRowToMockFace((f) => get(row, f))]} />
                  </div>
                  <div className="mt-2 max-w-56 text-xs text-neutral-500">
                    {get(row, 'variant') && <div>Variant: {get(row, 'variant')}</div>}
                  </div>
                  <div className="mt-1 max-w-56 text-xs text-amber-400">{reason}</div>
                </div>

                {/* right: real candidates from the catalogue, newest print first (a scanned
                    collection skews toward recently-bought cards) — these already have real
                    art, so just show the actual card image rather than re-deriving a mock
                    render. Horizontal scroll instead of wrapping — legibility past a screenful
                    is a browser-zoom concern, not a layout one — with the skip choice below the
                    row rather than occupying a card-sized slot inside it. */}
                {candidates.length === 0 ? (
                  <div className="self-center text-sm text-neutral-500">
                    No catalogue candidates — this game/card isn&apos;t supported yet.
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex gap-4 overflow-x-auto pb-1">
                      {candidates.map((c) => (
                        // radio is sr-only — a real, functional, keyboard-focusable form
                        // control the label still toggles on click, just not rendered as a
                        // circle that would push the card down and mismatch MockCard's top.
                        // Selection reads entirely as the border/background below.
                        <label
                          key={c.id}
                          className="w-56 shrink-0 cursor-pointer rounded-lg border border-transparent p-1 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-500/10"
                        >
                          <DeselectableRadio name={`choice_${i}`} value={c.id} className="sr-only" />
                          {/* fixed height matching MockCard's rendered frame exactly (313.6px
                              = 224px * 7/5, its aspect-[5/7] at w-56) rather than deriving it
                              from width + the image's own aspect ratio, which drifts from
                              MockCard's border/padding thickness */}
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
                    {/* no explicit "skip" option: nothing pre-checked, radio grouping already
                        guarantees at most one candidate highlighted, and a row with no
                        selection simply submits no choice_<i> field — the action only ever
                        processes rows that actually have one */}
                  </div>
                )}
              </div>
            </div>
          ))}
              </div>
            </div>
          ))}
        </div>

        {/* fixed to the right edge rather than a full-width sticky bar — that used to sit on
            top of the card grid whenever the page was tall enough to scroll under it */}
        <div className="fixed bottom-6 right-6 z-20 flex flex-col items-end gap-1">
          <button className="rounded bg-emerald-600 px-4 py-2 font-semibold text-white shadow-lg hover:bg-emerald-500">
            Import selected matches
          </button>
          <span className="rounded bg-neutral-950/90 px-2 py-1 text-xs text-neutral-400">
            Unselected rows stay in the file for next time.
          </span>
        </div>
      </form>
    </div>
  );
}

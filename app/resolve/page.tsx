import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { cardToMockFaces } from '../components/cardToMockFaces.ts';
import MockCard from '../components/MockCard.tsx';
import { resolveImportRows } from '../../src/actions.ts';
import { findCandidates } from '../../src/import/candidates.ts';
import { GAME_MAP, norm, parseCsv, resolveHeaders } from '../../src/import/csv.ts';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;

export default async function ResolvePage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string; page?: string }>;
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
        <h1 className="mb-4 text-2xl font-bold">Resolve unmatched imports</h1>
        <p className="text-neutral-400">
          No <code>*-unmatched.csv</code> found in the project root. Run{' '}
          <code>npm run import:collectr -- your-export.csv</code> first, or pass{' '}
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
        <h1 className="mb-2 text-2xl font-bold">Resolve unmatched imports</h1>
        <p className="text-emerald-400">
          {path.basename(filePath)} is empty — everything in it has been resolved.
        </p>
      </div>
    );
  }

  const idx = resolveHeaders(header);
  const reasonIdx = header.length - 1; // 'reason' is always the last column, appended by the importer
  const get = (row: string[], f: string) => (f in idx ? row[idx[f]]?.trim() : undefined);

  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const totalPages = Math.max(1, Math.ceil(dataRows.length / PAGE_SIZE));
  const pageRows = dataRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const rowsWithCandidates = await Promise.all(
    pageRows.map(async (row, i) => {
      // absolute index into the full file, not just this page — duplicate-content rows (a
      // real thing: the same physical card scanned twice) must resolve independently, so the
      // action removes rows by position, never by matching row content
      const absoluteIndex = (page - 1) * PAGE_SIZE + i;
      const name = get(row, 'name') ?? '';
      const setName = get(row, 'set');
      const gameField = get(row, 'game');
      const reason = row[reasonIdx] ?? '';
      const gameHint = gameField ? GAME_MAP[norm(gameField)] : undefined;
      const unsupported = reason.startsWith('unsupported game');
      const candidates = unsupported || !name ? [] : await findCandidates(name, setName, gameHint, 5);
      return { i: absoluteIndex, row, reason, candidates };
    }),
  );

  const pageHref = (p: number) => `/resolve?file=${encodeURIComponent(sp.file ?? onDisk[0])}&page=${p}`;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Resolve unmatched imports</h1>
      <p className="mb-6 text-sm text-neutral-400">
        {filePath} · {dataRows.length} rows remaining · page {page}/{totalPages}
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
        <div className="flex flex-col gap-6">
          {rowsWithCandidates.map(({ i, row, reason, candidates }) => (
            <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <input type="hidden" name={`raw_${i}`} value={JSON.stringify(row)} />
              <input type="hidden" name={`variant_${i}`} value={get(row, 'variant') ?? ''} />
              <input type="hidden" name={`quantity_${i}`} value={get(row, 'quantity') ?? ''} />
              <input type="hidden" name={`paid_${i}`} value={get(row, 'purchasePrice') ?? ''} />
              <input type="hidden" name={`condition_${i}`} value={get(row, 'condition') ?? ''} />
              <input type="hidden" name={`grade_${i}`} value={get(row, 'grade') ?? ''} />
              <input type="hidden" name={`gradingCompany_${i}`} value={get(row, 'gradingCompany') ?? ''} />

              <div className="mb-3 flex flex-wrap gap-4">
                {/* "here's the import data" panel */}
                <div className="w-64 shrink-0 rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs">
                  <div className="mb-1 font-semibold text-neutral-300">Import data</div>
                  {header.map((h, hi) =>
                    row[hi] ? (
                      <div key={hi} className="flex gap-2">
                        <span className="w-28 shrink-0 text-neutral-500">{h}</span>
                        <span className="break-words text-neutral-200">{row[hi]}</span>
                      </div>
                    ) : null,
                  )}
                  <div className="mt-2 text-amber-400">{reason}</div>
                </div>

                <div className="flex flex-1 flex-wrap gap-4">
                  {candidates.length === 0 ? (
                    <div className="self-center text-sm text-neutral-500">
                      No catalogue candidates — this game/card isn&apos;t supported yet.
                    </div>
                  ) : (
                    candidates.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent p-1 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-500/10"
                      >
                        <input type="radio" name={`choice_${i}`} value={c.id} className="mb-1" />
                        <MockCard faces={cardToMockFaces(c)} />
                        <div className="text-center text-[10px] text-neutral-400">
                          {c.set_name}
                          <br />
                          {Math.round(c.score * 100)}% match
                        </div>
                      </label>
                    ))
                  )}
                  <label className="flex cursor-pointer items-center gap-1 self-center rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-400 has-[:checked]:border-neutral-400 has-[:checked]:text-neutral-200">
                    <input type="radio" name={`choice_${i}`} value="skip" defaultChecked className="mr-1" />
                    None of these / skip
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-neutral-800 bg-neutral-950/95 py-3">
          <button className="rounded bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500">
            Import selected matches
          </button>
          <span className="text-sm text-neutral-500">Rows left as "skip" stay in the file for next time.</span>
        </div>
      </form>

      <div className="mt-6 flex gap-2 text-sm">
        {page > 1 && (
          <Link href={pageHref(page - 1)} className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800">
            Prev
          </Link>
        )}
        {page < totalPages && (
          <Link href={pageHref(page + 1)} className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800">
            Next
          </Link>
        )}
      </div>
    </div>
  );
}

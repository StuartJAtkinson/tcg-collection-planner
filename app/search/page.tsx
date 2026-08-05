// Global card search. Pure facet/sort driven — no text input. The game is a single scope
// toggle: MTG only for now. Game scope is remembered via cookie (see middleware) so it
// defaults to whatever was last used.
import Link from 'next/link';
import { cookies } from 'next/headers';
import { client } from '../../src/db/index.ts';
import { ENABLED_GAMES } from '../../src/games.ts';
import { search } from '../../src/search.ts';
import ComboSlicer from '../components/ComboSlicer.tsx';
import FilterSidebar, { type FilterGroup } from '../components/FilterSidebar.tsx';
import SortBar from '../components/SortBar.tsx';
import SearchResults from './SearchResults.tsx';
import { CHIP_NEUTRAL, CHIP_PLUS } from '../components/chip.ts';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string; kind?: string | string[]; combo?: string | string[]; cmcMin?: string; cmcMax?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const toArr = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]).filter((s) => s !== '');
  // tri-state split: signed values ("+W", "-WU") get peeled off into plus/minus; bare values
  // (no sign) are treated as plus for backward compatibility with old URLs. Empty strings
  // are dropped before splitting so an unfilled filter param round-trips as "no filter".
  const splitSigned = (vs: string[]) => {
    const plus: string[] = [], minus: string[] = [];
    for (const v of vs) {
      if (v.startsWith('+')) plus.push(v.slice(1));
      else if (v.startsWith('-')) minus.push(v.slice(1));
      else plus.push(v);
    }
    return { plus, minus };
  };
  const combos = splitSigned(toArr(sp.combo));
  const kinds = splitSigned(toArr(sp.kind));
  const cmcMin = sp.cmcMin?.trim() ?? '';
  const cmcMax = sp.cmcMax?.trim() ?? '';
  // MTG-only for now. URL param wins, else last-used cookie, else MTG.
  // Honour ENABLED_GAMES so a previously-remembered pokemon choice can't sneak back in.
  const gameCookie = (await cookies()).get('pref_game')?.value;
  const remembered = (sp.game ?? gameCookie ?? 'mtg').trim();
  const game = ENABLED_GAMES.includes(remembered) ? remembered : 'mtg';

  // game is always set (mtg default); run the search.
  const cards = await search({ type: 'all' }, '', {
    game,
    kindPlus: kinds.plus, kindMinus: kinds.minus,
    combosPlus: combos.plus, combosMinus: combos.minus,
    cmcMin, cmcMax,
    sort: sp.sort, offset: 0, limit: 60,
  });

  // query string the client component pages against (same scope, minus offset). Re-emit the
  // signed values so the URL is round-trippable.
  const resultQuery = new URLSearchParams([
    ...(game ? [['game', game]] : []),
    ...kinds.plus.map((k) => ['kind', `+${k}`] as [string, string]),
    ...kinds.minus.map((k) => ['kind', `-${k}`] as [string, string]),
    ...combos.plus.map((c) => ['combo', `+${c}`] as [string, string]),
    ...combos.minus.map((c) => ['combo', `-${c}`] as [string, string]),
    ...(cmcMin ? [['cmcMin', cmcMin]] : []),
    ...(cmcMax ? [['cmcMax', cmcMax]] : []),
    ...(sp.sort ? [['sort', sp.sort]] : []),
  ]).toString();

  const games = (await client`select id, name from games order by id`)
    .filter((g) => ENABLED_GAMES.includes(g.id));

  // game-specific slicers only appear once a game scope is chosen; colour is exact combos
  const gameFacets = game
    ? await client`
        select f.facet, f.value, count(*)::int as n
        from card_facets f join cards c on c.id = f.card_id
        where c.game_id = ${game} and f.facet in ('kind', 'color_combo')
        group by 1, 2 order by 1, length(f.value), 3 desc`
    : [];
  const comboOpts = gameFacets.filter((f) => f.facet === 'color_combo').map((f) => ({ value: f.value as string, n: f.n as number }));
  const kindOpts = gameFacets
    .filter((f) => f.facet === 'kind')
    .map((f) => ({ value: f.value, label: f.value, n: f.n }))
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.label.localeCompare(b.label));
  const showCmc = game === 'mtg';
  const slicers: FilterGroup[] = game
    ? [
        { name: 'kind', label: 'Kind', current: sp.kind, triState: true, options: kindOpts },
        ...(game !== 'mtg' && comboOpts.length ? [{ name: 'combo', label: 'Colour combo', current: sp.combo as any, multi: true, rawLabel: true, triState: true, options: comboOpts.map((c) => ({ value: c.value, label: c.value, n: c.n })) }] : []),
      ]
    : [];

  return (
    <div>
      {/* game scope tabs: same underlined-header style as /g/[game]. Single tab — MTG only
          for now. */}
      <div className="no-print mb-4 flex flex-wrap gap-2">
        {games.map((g) => {
          const href = `/search?game=${g.id}`;
          const active = g.id === game;
          return (
            <Link
              key={g.id}
              href={href}
              className={active ? CHIP_PLUS : CHIP_NEUTRAL}
            >
              {g.name}
            </Link>
          );
        })}
      </div>

      <div className="flex gap-6">
        <FilterSidebar
          slicers={slicers}
          customSlicers={
            <>
              {showCmc && (
                <div className="mb-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Mana value</div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <input type="number" inputMode="numeric" name="cmcMin" defaultValue={cmcMin} min="0" className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 tabular-nums" />
                    <span className="text-neutral-500">to</span>
                    <input type="number" inputMode="numeric" name="cmcMax" defaultValue={cmcMax} min="0" className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 tabular-nums" />
                  </div>
                </div>
              )}
              {game === 'mtg' && comboOpts.length ? <ComboSlicer options={comboOpts} current={sp.combo as any} /> : null}
            </>
          }
          hidden={{ game: game || undefined }}
          clearHref={game ? `/search?game=${game}` : '/search'}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center gap-3">
            <SortBar price />
          </div>
          <SearchResults initial={cards} query={resultQuery} />
        </div>
      </div>
    </div>
  );
}

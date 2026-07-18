// Global card search. Text matches card name + rules/flavor text across both games. The game
// is a single scope toggle (a tab, not an "Any" chip): none = all games, click the active one
// to clear back to all. Picking a game reveals that game's facet slicers. Game scope is
// remembered via cookie (see middleware) so it defaults to whatever was last used.
import Link from 'next/link';
import { cookies } from 'next/headers';
import { client } from '../../src/db/index.ts';
import { searchCards } from '../../src/search.ts';
import ComboSlicer from '../components/ComboSlicer.tsx';
import FilterSidebar, { type FilterGroup } from '../components/FilterSidebar.tsx';
import SortBar from '../components/SortBar.tsx';
import SearchResults from './SearchResults.tsx';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; game?: string; kind?: string; combo?: string | string[]; cmc?: string | string[]; sort?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const toArr = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const combos = toArr(sp.combo);
  const cmcs_sel = toArr(sp.cmc);
  // remembered game scope: URL param wins, else last-used cookie, else all games
  const gameCookie = (await cookies()).get('pref_game')?.value;
  const game = (sp.game ?? gameCookie ?? '').trim();

  // blank text is allowed — it returns the whole cohort (whatever game/slicer scope is set),
  // so Search doubles as a browse. Only skip the query when there's no scope at all (nothing
  // typed and no game/slicer) to avoid an unbounded "everything" fetch.
  const hasScope = !!(q || game || sp.kind || sp.combo || sp.cmc);
  const cards = hasScope
    ? await searchCards({ q, game, kind: sp.kind, combos, cmcs: cmcs_sel, sort: sp.sort, offset: 0, limit: 60 })
    : [];

  // query string the client component pages against (same scope, minus offset)
  const resultQuery = new URLSearchParams([
    ...(q ? [['q', q]] : []),
    ...(game ? [['game', game]] : []),
    ...(sp.kind ? [['kind', sp.kind]] : []),
    ...combos.map((c) => ['combo', c] as [string, string]),
    ...cmcs_sel.map((c) => ['cmc', c] as [string, string]),
    ...(sp.sort ? [['sort', sp.sort]] : []),
  ]).toString();

  const games = await client`select id, name from games order by id`;

  // game-specific slicers only appear once a game scope is chosen; colour is exact combos
  const gameFacets = game
    ? await client`
        select f.facet, f.value, count(*)::int as n
        from card_facets f join cards c on c.id = f.card_id
        where c.game_id = ${game} and f.facet in ('kind', 'color_combo')
        group by 1, 2 order by 1, length(f.value), 3 desc`
    : [];
  const cmcs = game === 'mtg'
    ? await client`
        select c.attrs->>'cmc' as value, count(*)::int as n
        from cards c where c.game_id = 'mtg' and c.attrs->>'cmc' is not null
        group by 1 order by (c.attrs->>'cmc')::numeric`
    : [];
  const comboOpts = gameFacets.filter((f) => f.facet === 'color_combo').map((f) => ({ value: f.value as string, n: f.n as number }));
  const slicers: FilterGroup[] = game
    ? [
        { name: 'kind', label: 'Kind', current: sp.kind, options: gameFacets.filter((f) => f.facet === 'kind').map((f) => ({ value: f.value, label: f.value, n: f.n })) },
        ...(game !== 'mtg' && comboOpts.length ? [{ name: 'combo', label: 'Colour combo', current: combos, multi: true, rawLabel: true, options: comboOpts.map((c) => ({ value: c.value, label: c.value, n: c.n })) }] : []),
        ...(cmcs.length ? [{ name: 'cmc', label: 'Mana value', current: cmcs_sel, multi: true, rawLabel: true, options: (cmcs as any[]).map((c) => ({ value: c.value, label: c.value, n: c.n })) }] : []),
      ]
    : [];

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Search</h1>
      {/* game scope tabs: click the active one to clear back to all games */}
      <div className="no-print mb-4 flex gap-2">
        {games.map((g) => {
          const active = game === g.id;
          // always carry game (empty when toggling the active one off) so middleware records
          // the "all games" choice as the remembered default too
          const href = `/search?${new URLSearchParams({ ...(q ? { q } : {}), game: active ? '' : g.id }).toString()}`;
          return (
            <Link
              key={g.id}
              href={href}
              className={`rounded-t-lg border-b-2 px-3 py-1.5 text-sm font-medium ${
                active ? 'border-emerald-500 text-white' : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {g.name}
            </Link>
          );
        })}
        <span className="self-center text-xs text-neutral-500">{game ? '' : 'all games'}</span>
      </div>

      <div className="flex gap-6">
        <FilterSidebar
          search={{ name: 'q', value: q, placeholder: 'name or rules text…' }}
          slicers={slicers}
          customSlicers={game === 'mtg' && comboOpts.length ? <ComboSlicer options={comboOpts} current={combos} /> : undefined}
          hidden={{ game: game || undefined }}
          clearHref={game ? `/search?game=${game}` : '/search'}
        />
        <div className="min-w-0 flex-1">
          {hasScope && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-neutral-400">
                {q ? 'results' : 'cards'}
                {game ? ` in ${games.find((g) => g.id === game)?.name}` : ''}
              </div>
              <SortBar price />
            </div>
          )}
          {hasScope ? (
            <SearchResults initial={cards} query={resultQuery} />
          ) : (
            <p className="text-sm text-neutral-500">Pick a game or type a name / rules text to browse.</p>
          )}
        </div>
      </div>
    </div>
  );
}

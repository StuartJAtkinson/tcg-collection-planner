// Global card search. Text matches card name + rules/flavor text across both games. The game
// is a single scope toggle (a tab, not an "Any" chip): none = all games, click the active one
// to clear back to all. Picking a game reveals that game's facet slicers. Game scope is
// remembered via cookie (see middleware) so it defaults to whatever was last used.
import Link from 'next/link';
import { cookies } from 'next/headers';
import { client } from '../../src/db/index.ts';
import FilterSidebar, { type FilterGroup } from '../components/FilterSidebar.tsx';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; game?: string; kind?: string; color?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  // remembered game scope: URL param wins, else last-used cookie, else all games
  const gameCookie = (await cookies()).get('pref_game')?.value;
  const game = (sp.game ?? gameCookie ?? '').trim();

  const like = '%' + q + '%';
  const cards = q
    ? await client`
        select c.id, c.name, c.image_small, c.game_id, c.set_id,
               s.code as set_code,
               exists (select 1 from holdings h where h.card_id = c.id) as owned
        from cards c join sets s on s.id = c.set_id
        where (
          c.name ilike ${like}
          or coalesce(c.attrs->>'oracle_text', '') ilike ${like}
          or coalesce(c.attrs->>'flavor_text', '') ilike ${like}
          or coalesce(c.attrs->>'type_line', '') ilike ${like}
          or coalesce(c.attrs->'attacks', '[]'::jsonb)::text ilike ${like}
          or coalesce(c.attrs->'rules', '[]'::jsonb)::text ilike ${like}
        )
        ${game ? client`and c.game_id = ${game}` : client``}
        ${sp.kind ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'kind' and f.value = ${sp.kind})` : client``}
        ${sp.color ? client`and exists (select 1 from card_facets f where f.card_id = c.id and f.facet = 'color' and f.value = ${sp.color})` : client``}
        order by (exists (select 1 from holdings h where h.card_id = c.id)) desc, c.name, s.release_date desc
        limit 120`
    : [];

  const games = await client`select id, name from games order by id`;

  // game-specific slicers only appear once a game scope is chosen
  const gameFacets = game
    ? await client`
        select f.facet, f.value, count(*)::int as n
        from card_facets f join cards c on c.id = f.card_id
        where c.game_id = ${game} and f.facet in ('kind', 'color')
        group by 1, 2 order by 1, 3 desc`
    : [];
  const slicers: FilterGroup[] = game
    ? [
        { name: 'kind', label: 'Kind', current: sp.kind, options: gameFacets.filter((f) => f.facet === 'kind').map((f) => ({ value: f.value, label: f.value, n: f.n })) },
        { name: 'color', label: 'Colour', current: sp.color, options: gameFacets.filter((f) => f.facet === 'color').map((f) => ({ value: f.value, label: f.value, n: f.n })) },
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
          hidden={{ game: game || undefined }}
          clearHref={game ? `/search?game=${game}` : '/search'}
        />
        <div className="min-w-0 flex-1">
          {q && <div className="mb-3 text-sm text-neutral-400">{cards.length} results{game ? ` in ${games.find((g) => g.id === game)?.name}` : ''}</div>}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
            {cards.map((c) => (
              <Link key={c.id} href={`/set/${encodeURIComponent(c.set_id ?? '')}?q=${encodeURIComponent(c.name)}`} className={c.owned ? '' : 'opacity-90'}>
                <div className={`relative overflow-hidden rounded-lg ${c.owned ? 'ring-2 ring-emerald-500' : ''}`}>
                  {c.image_small ? (
                    <img src={c.image_small} alt={c.name} loading="lazy" className="w-full" />
                  ) : (
                    <div className="flex aspect-[5/7] items-center justify-center bg-neutral-800 p-2 text-center text-xs text-neutral-400">
                      {c.name}
                    </div>
                  )}
                </div>
                <div className="mt-1 truncate text-sm">{c.name}</div>
                <div className="text-xs uppercase text-neutral-500">{c.set_code}</div>
              </Link>
            ))}
            {!q && <p className="text-sm text-neutral-500">Type a card name or rules text and press Apply.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';
import { ENABLED_GAMES, MTG_BUCKETS, MTG_DECK_TYPES } from '../../../src/games.ts';
import ChipFormSection from '../../components/ChipFormSection.tsx';

export const dynamic = 'force-dynamic';

// mtg set_type → nav bucket; types not listed (token, memorabilia, minigame, vanguard) stay
// hidden, and deck-shaped products (commander/duel_deck/precons) live on /decks instead of
// here — they're fixed buyable decks, not collectible sets. Masters/reprint sets merge into
// Core (they're "kind of core again": reprint products), and crossover (non-Magic-IP /
// Universes Beyond) sets get their own bucket regardless of set_type via sets.crossover.
// ponytail: taxonomy comes from src/games.ts so /decks' precon list and the six core bucket
// labels can't drift between the two surfaces.
const MTG_NAV_BUCKETS: [string, string[]][] = MTG_BUCKETS
  .filter(([key]) => key !== 'precons')
  .map(([key, label, types]) => [label, types]);

const FORMATS: Record<string, string[]> = {
  mtg: ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper'],
  pokemon: ['standard', 'expanded', 'unlimited'],
};
const properCase = (s: string) => s[0].toUpperCase() + s.slice(1);

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ game: string }>;
  searchParams: Promise<{ kind?: string; format?: string }>;
}) {
  const { game } = await params;
  const { kind: kindParam, format } = await searchParams;

  // URL is the source of truth. Clear (which drops `kind` and `format`) therefore restores
  // the "all categories" default — exactly what the user asked for. Cookie previously tried
  // to remember partial selections across visits, but the result was that Clear looked like
  // it did nothing (the cookie silently re-applied the last partial state).
  const kind = kindParam;

  const allGames = (await client`select id, name from games order by id`).filter((g) => ENABLED_GAMES.includes(g.id));
  const gameRow = allGames.find((g) => g.id === game);
  if (!gameRow) notFound();

  const sets = await client`
    select s.id, s.code, s.name, s.series, s.set_type, s.icon_url, s.crossover,
           to_char(s.release_date, 'YYYY-MM-DD') as released,
           date_part('year', s.release_date)::int as year,
           count(c.id)::int as total,
           count(distinct h.card_id)::int as owned
    from sets s
    join cards c on c.set_id = s.id
    left join holdings h on h.card_id = c.id
    where s.game_id = ${game}
    ${format ? client`and jsonb_exists(s.legalities, ${format})` : client``}
    group by s.id
    order by s.release_date desc`;

  // bucket tabs: mtg by curated set_type groups; pokemon by series (newest first) for the
  // main sets, with promos pulled out of their eras into one trailing Promos bucket — same
  // Main-vs-Promo treatment as mtg. Deck products (trainer kits/starter sets, set_type
  // 'deck') are excluded here entirely and live on /decks, like mtg's precons.
  let tabs: { label: string; sets: any[] }[];
  if (game === 'mtg') {
    const collectible = sets.filter((s) => !MTG_DECK_TYPES.includes(s.set_type));
    tabs = MTG_NAV_BUCKETS.map(([label, types]) => ({
      label,
      sets:
        label === 'Crossovers'
          ? collectible.filter((s) => s.crossover)
          : collectible.filter((s) => !s.crossover && types.includes(s.set_type)),
    }));
  } else {
    const main = sets.filter((s) => s.set_type === null);
    const order = [...new Set(main.map((s) => s.series ?? 'Other'))];
    tabs = order.map((label) => ({ label, sets: main.filter((s) => (s.series ?? 'Other') === label) }));
    tabs.push({ label: 'Promos', sets: sets.filter((s) => s.set_type === 'promo') });
  }
  tabs = tabs.filter((t) => t.sets.length > 0);

  // kind is a multi-select toggle set, comma-separated in the URL / remembered cookie. Absent
  // = "all" (every tab's contents rendered). Sentinel kind=none = user explicitly toggled
  // everything off, so render nothing — lets them pick a single tab cleanly without a giant
  // default grid rendering on top first.
  const selected = new Set(
    kind === undefined || kind === ''
      ? tabs.map((t) => t.label)
      : kind === 'none'
        ? []
        : kind.split(',').filter(Boolean),
  );
  const shown = tabs
    .filter((t) => selected.has(t.label))
    .flatMap((t) => t.sets)
    .sort((a, b) => b.released.localeCompare(a.released)); // flatMap groups by tab; re-sort by date across tabs
  const years = [...new Set(shown.map((s) => s.year))];

  // Format (single-select radio) + kind (multi-select checkbox group) each render inside their
  // own ChipFormSection so a single Apply navigates with the change set, plain GET.

  return (
    <div>
      {/* Page heading — same underlined-header treatment as the top nav's active section,
          so it reads as the page's name. The game tabs sit underneath, switching scope. */}
      <h1 className="mb-2 inline-block border-b-2 border-emerald-500 pb-1 text-xl font-semibold text-white">
        {gameRow.name}
      </h1>
      <nav className="no-print mb-4 flex gap-6 border-b border-neutral-800">
        {allGames.map((g) => {
          const active = g.id === game;
          return (
            <Link
              key={g.id}
              href={`/g/${g.id}`}
              aria-current={active ? 'page' : undefined}
              className={`border-b-2 px-1 pb-2 text-sm font-medium ${
                active
                  ? 'border-emerald-500 text-white'
                  : 'border-transparent text-neutral-300 hover:text-white'
              }`}
            >
              {g.name}
            </Link>
          );
        })}
      </nav>

      <ChipFormSection
        action={`/g/${game}`}
        className="no-print mb-6 flex flex-wrap items-center gap-1.5 text-sm"
        fields={[
          {
            name: 'format',
            kind: 'radio',
            defaultValue: format ?? '',
            options: [
              { value: '', label: 'Any format' },
              ...(FORMATS[game] ?? []).map((f) => ({ value: f, label: properCase(f) })),
            ],
          },
        ]}
        clearHref={`/g/${game}`}
      />

      <div className="no-print mb-6">
        <ChipFormSection
          action={`/g/${game}`}
          className="flex flex-wrap gap-2 text-sm"
          fields={[
            {
              name: 'kind',
              kind: 'multi',
              defaultValue: [...selected],
              options: tabs.map((t) => ({ value: t.label, label: t.label, n: t.sets.length })),
            },
          ]}
          // ChipFormSection owns the multi-select sentinel itself; passing a `kind` hidden
          // here would double-submit on Apply and the filter would never appear to change.
          clearHref={`/g/${game}`}
        />
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-neutral-500">No set kinds selected — pick one above.</p>
      )}

      {years.map((year) => (
        <section key={year} className="mb-8">
          <h2 className="mb-3 border-b border-neutral-800 pb-1 text-lg font-semibold text-neutral-300">{year}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown
              .filter((s) => s.year === year)
              .map((s) => {
                const pct = s.total ? Math.round((100 * s.owned) / s.total) : 0;
                return (
                  <Link
                    key={s.id}
                    href={`/set/${encodeURIComponent(s.id)}`}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 hover:border-neutral-600"
                  >
                    <div className="flex items-center gap-2">
                      {s.icon_url && (
                        <img
                          src={s.icon_url}
                          alt=""
                          loading="lazy"
                          className={`h-6 w-6 shrink-0 ${game === 'mtg' ? 'invert' : ''}`}
                        />
                      )}
                      <div className="truncate font-medium leading-tight">{s.name}</div>
                    </div>
                    <div className="mt-1 text-xs uppercase text-neutral-400">
                      {s.code} · {s.total} cards · {s.released}
                    </div>
                    <div className="mt-2 h-1.5 rounded bg-neutral-800">
                      <div className="h-1.5 rounded bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {s.owned}/{s.total} · {pct}%
                    </div>
                  </Link>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

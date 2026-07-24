import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';
import { ENABLED_GAMES } from '../../../src/games.ts';
import ChipFormSection from '../../components/ChipFormSection.tsx';

export const dynamic = 'force-dynamic';

// mtg set_type → nav bucket; types not listed (token, memorabilia, minigame, vanguard) stay
// hidden, and deck-shaped products (commander/duel_deck/precons) live on /decks instead of
// here — they're fixed buyable decks, not collectible sets. Masters/reprint sets merge into
// Core (they're "kind of core again": reprint products), and crossover (non-Magic-IP /
// Universes Beyond) sets get their own bucket regardless of set_type via sets.crossover.
const MTG_DECK_TYPES = ['commander', 'duel_deck', 'planechase', 'archenemy', 'starter', 'arsenal', 'premium_deck'];
const MTG_BUCKETS: [string, string[]][] = [
  ['Core & Reprints', ['core', 'masters', 'from_the_vault', 'spellbook', 'masterpiece']],
  ['Expansions', ['expansion']],
  ['Crossovers', []], // filled by the crossover flag, not set_type
  ['Draft & Supplemental', ['draft_innovation', 'eternal', 'funny']],
  ['Secret Lair & Boxes', ['box']],
  ['Promos', ['promo']],
];

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

  // remembered default: URL param wins; else the last-applied kind (cookie); else seeded Core
  const kindCookie = (await cookies()).get('pref_kind')?.value;
  const kind = kindParam ?? kindCookie;

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
  let tabs: { label: string; sets: typeof sets }[];
  if (game === 'mtg') {
    const collectible = sets.filter((s) => !MTG_DECK_TYPES.includes(s.set_type));
    tabs = MTG_BUCKETS.map(([label, types]) => ({
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
  // = seeded default (Core & Reprints); explicit sentinel kind=none = user toggled everything
  // off — show nothing, so a single kind can then be picked cleanly without a big default grid
  // rendering on top first.
  const selected = new Set(
    kind === undefined
      ? [tabs.find((t) => t.label === 'Core & Reprints')?.label ?? tabs[0]?.label]
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
      <h1 className="mb-2 text-2xl font-bold">Collections</h1>
      {/* games as tabs under Collections */}
      <div className="no-print mb-4 flex gap-2">
        {allGames.map((g) => (
          <Link
            key={g.id}
            href={`/g/${g.id}`}
            className={`rounded-t-lg border-b-2 px-3 py-1.5 text-sm font-medium ${
              g.id === game
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {g.name}
          </Link>
        ))}
      </div>

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
        rowId="g-format"
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
          rowId="g-kinds"
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

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';

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
  const { kind, format } = await searchParams;

  const [gameRow] = await client`select id, name from games where id = ${game}`;
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

  // bucket tabs: mtg by curated set_type groups, pokemon by series (newest first)
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
    const order = [...new Set(sets.map((s) => s.series ?? 'Other'))];
    tabs = order.map((label) => ({ label, sets: sets.filter((s) => (s.series ?? 'Other') === label) }));
  }
  tabs = tabs.filter((t) => t.sets.length > 0);

  // kind is a multi-select toggle set, comma-separated in the URL. A missing param means
  // "first visit" and defaults to Expansions; the explicit sentinel kind=none means the user
  // toggled everything off — show nothing, so a single kind can then be picked cleanly
  // without the default's big grid rendering on top first.
  const selected = new Set(
    kind === undefined
      ? [tabs.find((t) => t.label === 'Expansions')?.label ?? tabs[0]?.label]
      : kind === 'none'
        ? []
        : kind.split(',').filter(Boolean),
  );
  const shown = tabs
    .filter((t) => selected.has(t.label))
    .flatMap((t) => t.sets)
    .sort((a, b) => b.released.localeCompare(a.released)); // flatMap groups by tab; re-sort by date across tabs
  const years = [...new Set(shown.map((s) => s.year))];

  const tabHref = (label: string) => {
    const next = new Set(selected);
    next.has(label) ? next.delete(label) : next.add(label);
    const kindParam = [...next].join(',') || 'none';
    return `/g/${game}?kind=${encodeURIComponent(kindParam)}${format ? `&format=${encodeURIComponent(format)}` : ''}`;
  };

  // format chips: single-select toggle — clicking the active one clears it ("select none")
  const formatHref = (f: string) => {
    const kindParam = [...selected].join(',') || (kind !== undefined ? 'none' : '');
    const parts = [];
    if (kindParam) parts.push(`kind=${encodeURIComponent(kindParam)}`);
    if (format !== f) parts.push(`format=${encodeURIComponent(f)}`);
    return `/g/${game}${parts.length ? `?${parts.join('&')}` : ''}`;
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{gameRow.name}</h1>
        <div className="no-print flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-xs uppercase text-neutral-500">Format</span>
          {FORMATS[game]?.map((f) => (
            <Link
              key={f}
              href={formatHref(f)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                format === f
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                  : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
              }`}
            >
              {properCase(f)}
            </Link>
          ))}
        </div>
      </div>

      <div className="no-print mb-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.label}
            href={tabHref(t.label)}
            className={`rounded-full border px-3 py-1 text-sm ${
              selected.has(t.label)
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            }`}
          >
            {t.label} <span className="text-neutral-500">{t.sets.length}</span>
          </Link>
        ))}
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

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';

export const dynamic = 'force-dynamic';

// mtg set_type → nav bucket; types not listed (token, memorabilia, minigame, vanguard) stay hidden
const MTG_BUCKETS: [string, string[]][] = [
  ['Core', ['core']],
  ['Expansions', ['expansion']],
  ['Masters & Reprints', ['masters', 'from_the_vault', 'premium_deck', 'spellbook', 'masterpiece']],
  ['Commander & Precons', ['commander', 'duel_deck', 'planechase', 'archenemy', 'starter', 'arsenal']],
  ['Draft & Supplemental', ['draft_innovation', 'eternal', 'funny']],
  ['Secret Lair & Boxes', ['box']],
  ['Promos', ['promo']],
];

const FORMATS: Record<string, string[]> = {
  mtg: ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper'],
  pokemon: ['standard', 'expanded', 'unlimited'],
};

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
    select s.id, s.code, s.name, s.series, s.set_type, s.icon_url,
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
    tabs = MTG_BUCKETS.map(([label, types]) => ({
      label,
      sets: sets.filter((s) => types.includes(s.set_type)),
    }));
  } else {
    const order = [...new Set(sets.map((s) => s.series ?? 'Other'))];
    tabs = order.map((label) => ({ label, sets: sets.filter((s) => (s.series ?? 'Other') === label) }));
  }
  tabs = tabs.filter((t) => t.sets.length > 0);
  const active = tabs.find((t) => t.label === kind) ?? tabs.find((t) => t.label === 'Expansions') ?? tabs[0];
  const years = active ? [...new Set(active.sets.map((s) => s.year))] : [];

  const tabHref = (label: string) =>
    `/g/${game}?kind=${encodeURIComponent(label)}${format ? `&format=${encodeURIComponent(format)}` : ''}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{gameRow.name}</h1>
        <form method="get" className="no-print flex items-center gap-2 text-sm">
          {active && <input type="hidden" name="kind" value={active.label} />}
          <select
            name="format"
            defaultValue={format ?? ''}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          >
            <option value="">All formats</option>
            {FORMATS[game]?.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <button className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800">Apply</button>
        </form>
      </div>

      <div className="no-print mb-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.label}
            href={tabHref(t.label)}
            className={`rounded-full border px-3 py-1 text-sm ${
              t === active
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            }`}
          >
            {t.label} <span className="text-neutral-500">{t.sets.length}</span>
          </Link>
        ))}
      </div>

      {years.map((year) => (
        <section key={year} className="mb-8">
          <h2 className="mb-3 border-b border-neutral-800 pb-1 text-lg font-semibold text-neutral-300">{year}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {active!.sets
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

// Nearest-complete-set advisor. For every set you've started, two completion measures:
//   exact    — slots filled by the exact printing (normal completion, same as everywhere else)
//   for-play — slots also count when ANY owned printing shares the slot's oracle identity
//              (cards.oracle_id: true oracle for mtg, dex-number/name for pokemon) — "I have
//              Dark Ritual, just not this set's copy"
// Ranked by for-play coverage, so the top of the list answers "which master set am I closest
// to finishing if I let my for-play copies fill slots?" — with the cost to buy only the slots
// no printing covers. Display-only, like the For Play badge: real completion stays exact-print.
import Link from 'next/link';
import { client } from '../../src/db/index.ts';
import { ENABLED_GAMES } from '../../src/games.ts';
import ChipFormSection from '../components/ChipFormSection.tsx';

export const dynamic = 'force-dynamic';

const HIDDEN_TYPES = ['token', 'memorabilia', 'minigame', 'vanguard'];
const DECK_TYPES = ['commander', 'duel_deck', 'planechase', 'archenemy', 'starter', 'arsenal', 'premium_deck'];

// "Collection Aim" — which kinds of set count as collection goals. Precon decks are buyable
// products, not collections; promos/draft/boxes rarely hold unique cards (2-3 at most, like
// promos) so they're asides, off by default. Crossovers are collectable and on by default.
const AIM_BUCKETS: [string, string, string[]][] = [
  ['core', 'Core & Reprints', ['core', 'masters', 'from_the_vault', 'spellbook', 'masterpiece']],
  ['expansions', 'Expansions', ['expansion']],
  ['crossovers', 'Crossovers', []], // via sets.crossover, not set_type
  ['draft', 'Draft & Supplemental', ['draft_innovation', 'eternal', 'funny']],
  ['boxes', 'Secret Lair & Boxes', ['box']],
  ['promos', 'Promos', ['promo']],
  ['precons', 'Precon decks', DECK_TYPES],
];
const DEFAULT_AIM = ['core', 'expansions', 'crossovers'];

export default async function AdvisorPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string; min?: string; aim?: string }>;
}) {
  const sp = await searchParams;
  const game = sp.game ?? 'mtg';
  // tiny promo "sets" complete themselves trivially; default to sets of 10+ cards
  const minSize = Math.max(1, parseInt(sp.min ?? '10', 10) || 10);

  // pokemon's aim vocabulary is simpler: main sets vs promos vs trainer-kit deck products
  // (set_type derived at import); default is main sets only, same spirit as mtg's default
  const POKEMON_AIM: [string, string][] = [
    ['main', 'Main sets'],
    ['promos', 'Promos'],
    ['precons', 'Trainer kits'],
  ];
  const defaultAim = game === 'mtg' ? DEFAULT_AIM : ['main'];

  // same missing-vs-explicit-none URL convention as the master-sets kind tabs
  const aim = new Set(
    sp.aim === undefined ? defaultAim : sp.aim === 'none' ? [] : sp.aim.split(',').filter(Boolean),
  );
  const allowedTypes = AIM_BUCKETS.filter(
    ([key]) => aim.has(key) && key !== 'crossovers' && key !== 'precons',
  ).flatMap(([, , types]) => types);

  const rows = await client`
    with owned_cards as (
      select distinct card_id from holdings
    ),
    owned_oracles as (
      select distinct c.oracle_id
      from holdings h join cards c on c.id = h.card_id
      where c.oracle_id is not null
    ),
    latest_prices as (
      select distinct on (card_id) card_id, usd
      from prices
      order by card_id, (finish = 'nonfoil') desc, as_of desc
    )
    select s.id, s.code, s.name, s.set_type, s.icon_url, s.crossover,
           to_char(s.release_date, 'YYYY-MM-DD') as released,
           count(c.id)::int as total,
           count(*) filter (where oc.card_id is not null)::int as owned_exact,
           count(*) filter (where oc.card_id is not null or oo.oracle_id is not null)::int as covered,
           sum(lp.usd) filter (where oc.card_id is null and oo.oracle_id is null)::float as cost_missing
    from sets s
    join cards c on c.set_id = s.id
    left join owned_cards oc on oc.card_id = c.id
    left join owned_oracles oo on oo.oracle_id = c.oracle_id
    left join latest_prices lp on lp.card_id = c.id
    where s.game_id = ${game} and (s.set_type is null or s.set_type != all(${HIDDEN_TYPES}))
    ${
      game === 'mtg'
        ? client`and (
            case
              when s.set_type = any(${DECK_TYPES}) then ${aim.has('precons')}
              when s.crossover then ${aim.has('crossovers')}
              else s.set_type = any(${allowedTypes})
            end
          )`
        : client`and (
            case
              when s.set_type = 'deck' then ${aim.has('precons')}
              when s.set_type = 'promo' then ${aim.has('promos')}
              else ${aim.has('main')}
            end
          )`
    }
    group by s.id
    having count(c.id) >= ${minSize}
       and count(*) filter (where oc.card_id is not null or oo.oracle_id is not null) > 0
    order by count(*) filter (where oc.card_id is not null or oo.oracle_id is not null)::float / count(c.id) desc,
             count(c.id) - count(*) filter (where oc.card_id is not null or oo.oracle_id is not null) asc
    limit 40`;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Nearest-complete sets</h1>
      <p className="mb-6 max-w-3xl text-sm text-neutral-400">
        Sets you&apos;ve started, ranked by coverage when <span className="text-amber-400">for-play copies</span> (any
        owned printing of the same card, per oracle identity) fill slots alongside{' '}
        <span className="text-emerald-400">exact prints</span>. Cost is for the slots no printing covers. Real
        completion elsewhere stays exact-print — this is the &quot;what should I finish next&quot; view.
      </p>

      {/* Game nav (path changes, not filters): Magic / Pokémon tabs. Switching game resets
          aim to that game's default — the two games' aim keys don't overlap, so carrying one
          across would silently filter everything out. */}
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        {(
          [
            ['mtg', 'Magic'],
            ['pokemon', 'Pokémon'],
          ] as const
        ).filter(([id]) => ENABLED_GAMES.includes(id)).map(([id, label]) => (
          <Link
            key={id}
            href={`/advisor?game=${id}&min=${minSize}`}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              game === id
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* min set size — a small free-form number input + Apply, separate from Collection Aim
          below so you can type any value without the chip layout forcing a preset. */}
      <form method="get" action="/advisor" className="mb-3 flex items-center gap-1 text-sm text-neutral-400">
        <input type="hidden" name="game" value={game} />
        {sp.aim && <input type="hidden" name="aim" value={sp.aim} />}
        min set size
        <input
          type="number"
          name="min"
          defaultValue={minSize}
          className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        />
        <button className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800">Apply</button>
      </form>

      {/* Collection Aim chips are multi-select; toggling everything off posts the explicit
          'none' sentinel so we don't snap back to the seeded default. */}
      <ChipFormSection
        action="/advisor"
        className="no-print mb-6 flex flex-wrap items-center gap-1.5 text-sm"
        fields={[
          {
            name: 'aim',
            kind: 'multi',
            defaultValue: [...aim],
            options: (game === 'mtg' ? AIM_BUCKETS : POKEMON_AIM).map(([k, l]) => ({ value: k, label: l })),
          },
        ]}
        hidden={{ game, min: String(minSize) }}
        rowId="advisor-aim"
        clearHref={`/advisor?game=${game}&min=${minSize}`}
      />

      <div className="flex flex-col gap-2">
        {rows.map((s) => {
          const exactPct = (100 * s.owned_exact) / s.total;
          const coveredPct = (100 * s.covered) / s.total;
          const missing = s.total - s.covered;
          return (
            <Link
              key={s.id}
              href={`/set/${encodeURIComponent(s.id)}`}
              className="flex items-center gap-4 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 hover:border-neutral-600"
            >
              {s.icon_url && (
                <img src={s.icon_url} alt="" loading="lazy" className={`h-6 w-6 shrink-0 ${game === 'mtg' ? 'invert' : ''}`} />
              )}
              <div className="w-64 min-w-0 shrink-0">
                <div className="truncate font-medium">
                  {s.name}
                  {s.crossover && (
                    <span className="ml-1 rounded bg-purple-500/20 px-1 text-[10px] uppercase text-purple-300">crossover</span>
                  )}
                </div>
                <div className="text-xs uppercase text-neutral-500">
                  {s.code} · {s.set_type ?? ''} · {s.released}
                </div>
              </div>
              {/* stacked bar: exact prints in emerald, extra for-play coverage in amber */}
              <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-neutral-800">
                <div className="absolute inset-y-0 left-0 bg-amber-500/70" style={{ width: `${coveredPct}%` }} />
                <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${exactPct}%` }} />
              </div>
              <div className="w-44 shrink-0 text-right text-sm">
                <span className="font-semibold text-neutral-100">{Math.round(coveredPct)}%</span>
                <span className="text-neutral-500"> covered · {Math.round(exactPct)}% exact</span>
              </div>
              <div className="w-40 shrink-0 text-right text-sm text-neutral-400">
                {missing} missing
                {s.cost_missing != null && (
                  <span className="text-neutral-500"> · ${s.cost_missing.toFixed(0)}</span>
                )}
              </div>
            </Link>
          );
        })}
        {rows.length === 0 && <p className="text-neutral-500">No started sets of {minSize}+ cards for this game.</p>}
      </div>
    </div>
  );
}

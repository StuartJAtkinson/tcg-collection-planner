// Three-tab deck creation flow:
//   manual  → redirects to /resolve (the existing Collectr CSV import; final stage lets you
//             pick a single portfolio as 'deck' so the import lands as one deck)
//   sealed  → pick a precon set; the deck starts populated with every card in that set
//   scratch → empty deck, name only (deck_source='scratch')
//
// Tab chosen via ?tab=. Default is manual — it covers the most common path (Collectr
// export). The deck_source column on containers tracks which path each deck came from.
import Link from 'next/link';
import { client } from '../../../src/db/index.ts';
import { MTG_DECK_TYPES } from '../../../src/games.ts';
import { createDeckFromSealed, createDeckScratch } from '../../../src/actions.ts';
import { BTN_PRIMARY, CHIP_NEUTRAL, CHIP_PLUS } from '../../components/chip.ts';

export const dynamic = 'force-dynamic';

type Tab = 'manual' | 'sealed' | 'scratch';
const TAB_LABELS: Record<Tab, string> = {
  manual: 'Manual import',
  sealed: 'From a sealed product',
  scratch: 'From scratch',
};

export default async function NewDeckPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = (sp.tab as Tab) in TAB_LABELS ? (sp.tab as Tab) : 'manual';

  const preconSets = tab === 'sealed'
    ? await client`
        select s.id, s.code, s.name, s.game_id, s.icon_url, s.crossover,
               to_char(s.release_date, 'YYYY-MM-DD') as released,
               count(c.id)::int as card_count
        from sets s
        join cards c on c.set_id = s.id
        where s.set_type = any(${MTG_DECK_TYPES})
        group by s.id
        order by s.release_date desc nulls last`
    : [];

  const tabHref = (t: Tab) => `/decks/new?tab=${t}`;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="inline-block border-b-2 border-emerald-500 pb-1 text-xl font-semibold text-white">New deck</h1>
        <Link href="/decks" className="text-sm text-neutral-400 hover:text-white">← back to decks</Link>
      </div>
      <p className="mb-6 text-sm text-neutral-400">
        Three ways to start a deck — pick whichever fits the cards in front of you.
      </p>

      <div className="mb-6 flex flex-wrap gap-1.5 text-sm">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            className={t === tab ? CHIP_PLUS : CHIP_NEUTRAL}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </div>

      {tab === 'manual' && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-2 text-lg font-semibold">Manual import</h2>
          <p className="mb-4 text-sm text-neutral-400">
            Paste a Collectr CSV export and choose &quot;deck&quot; for one portfolio on the next screen — every card in
            that portfolio lands in the new deck. Anything not assigned to a deck goes to the
            unsorted pool as usual.
          </p>
          <Link
            href="/resolve"
            className={BTN_PRIMARY}
          >
            Open importer →
          </Link>
        </section>
      )}

      {tab === 'sealed' && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">Pick a preconstructed product</h2>
          <p className="mb-4 text-sm text-neutral-400">
            The deck starts with every card in that set at quantity 1 (nonfoil). Rename on the
            next screen if you want — the deck is tagged <code className="text-neutral-300">deck_source=&apos;sealed&apos;</code>.
          </p>
          {preconSets.length === 0 ? (
            <p className="text-sm text-neutral-500">No precon sets in the catalogue yet.</p>
          ) : (
            <form action={createDeckFromSealed} className="space-y-3">
              <label className="block text-sm">
                <span className="text-neutral-400">Deck name</span>
                <input
                  name="name"
                  required
                  maxLength={100}
                  placeholder="(optional — defaults to the set name)"
                  className="mt-1 block w-full max-w-md rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {preconSets.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-3 rounded border border-neutral-800 bg-neutral-900 p-2 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-500/10"
                  >
                    <input type="radio" name="set_id" value={s.id} required className="sr-only" />
                    {s.icon_url && (
                      <img src={s.icon_url} alt="" className={`h-6 w-6 ${s.game_id === 'mtg' ? 'invert' : ''}`} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.name}</div>
                      <div className="text-xs uppercase text-neutral-400">
                        {s.code} · {s.card_count} cards · {s.released}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <button className={BTN_PRIMARY}>
                Create deck
              </button>
            </form>
          )}
        </section>
      )}

      {tab === 'scratch' && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="mb-2 text-lg font-semibold">From scratch</h2>
          <p className="mb-4 text-sm text-neutral-400">
            Empty deck — add cards via the search bar on the next screen. Tagged
            <code className="mx-1 text-neutral-300">deck_source=&apos;scratch&apos;</code> so the
            Decks page knows it wasn&apos;t born from a precon.
          </p>
          <form action={createDeckScratch} className="flex max-w-md gap-2">
            <input
              name="name"
              autoFocus
              required
              maxLength={100}
              placeholder="Deck name"
              className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            />
            <button className={BTN_PRIMARY}>
              Create
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

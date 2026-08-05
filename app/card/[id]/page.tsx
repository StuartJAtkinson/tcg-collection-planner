// Single Card page — a Gatherer-style all-printings view. Printings are listed first (every
// version sharing this card's oracle identity, newest set first), then the full card detail:
// the vector MockCard render beside a Gatherer-style attribute table, plus a functional
// "you own" summary. Reuses the shared display elements: MockCard (mockup), VanillaCard
// (real-image tile) and OwnershipStrip (ownership indicators).
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { client } from '../../../src/db/index.ts';
import { holdCte } from '../../../src/ownership.ts';
import MockCard from '../../components/MockCard.tsx';
import VanillaCard from '../../components/VanillaCard.tsx';
import OwnershipStrip from '../../components/OwnershipStrip.tsx';
import { cardToMockFaces, type MockCardSource } from '../../components/cardToMockFaces.ts';

export const dynamic = 'force-dynamic';

type Printing = MockCardSource & {
  id: string;
  set_id: string;
  set_name: string;
  released: string | null;
  owned: boolean;
  for_play: boolean;
  set_nonfoil: number; set_foil: number; deck_nonfoil: number; deck_foil: number; func_total: number;
  usd: number | null;
};

// {2}{W}{U/P}{T} inline mana/tap symbols using the same Mana font the MockCard uses.
function ManaText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{([^}]+)\}$/);
        if (!m) return <span key={i}>{p}</span>;
        const cls = m[1].toLowerCase().replace('/', '').replace('t', 'tap').replace('q', 'untap');
        return <i key={i} className={`ms ms-cost ms-${cls} align-middle text-[13px]`} title={m[1]} />;
      })}
    </>
  );
}

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [ref] = await client`select id, oracle_id, name, game_id from cards where id = ${id}`;
  if (!ref) notFound();

  // group key: all printings share oracle_id (Gatherer's all-printings concept); fall back to
  // this single card when it has no oracle identity.
  const printings = (await client`
    with ${holdCte},
    oracle_total as (
      select c.oracle_id, sum(coalesce(hd.set_nonfoil,0) + coalesce(hd.set_foil,0))::int as total
      from cards c left join hold hd on hd.card_id = c.id
      where c.oracle_id is not null group by c.oracle_id
    )
    select c.id, c.set_id, c.name, c.collector_number, c.rarity_raw, c.rarity_tier,
           c.image_small, c.image_large, c.artist, c.attrs, c.game_id,
           s.code as set_code, s.name as set_name, s.icon_url as set_icon_url,
           to_char(s.release_date, 'YYYY-MM-DD') as released,
           coalesce((select array_agg(f.value) from card_facets f where f.card_id = c.id and f.facet = 'color'), '{}') as colors,
           coalesce(hd.owned_finishes, '{}') <> '{}' as owned,
           coalesce(hd.set_nonfoil, 0) as set_nonfoil, coalesce(hd.set_foil, 0) as set_foil,
           coalesce(hd.deck_nonfoil, 0) as deck_nonfoil, coalesce(hd.deck_foil, 0) as deck_foil,
           coalesce(ot.total, 0) as func_total,
           (hd.card_id is null and ot.total > 0) as for_play,
           p.usd::float as usd
    from cards c join sets s on s.id = c.set_id
    left join hold hd on hd.card_id = c.id
    left join oracle_total ot on ot.oracle_id = c.oracle_id
    left join lateral (
      select usd from prices p where p.card_id = c.id
      order by (p.finish = 'nonfoil') desc, p.as_of desc limit 1
    ) p on true
    where ${ref.oracle_id ? client`c.oracle_id = ${ref.oracle_id}` : client`c.id = ${id}`}
    order by s.release_date desc nulls last, c.collector_number`) as unknown as Printing[];

  const current = printings.find((p) => p.id === id) ?? printings[0];
  const attrs = current.attrs ?? {};
  const faces = cardToMockFaces(current);

  // functional "you own" rollup across every printing (foils tracked separately)
  const own = printings.reduce(
    (a, p) => ({
      nf: a.nf + p.set_nonfoil, foil: a.foil + p.set_foil,
      printings: a.printings + (p.owned ? 1 : 0),
    }),
    { nf: 0, foil: 0, printings: 0 },
  );
  const funcTotal = printings[0]?.func_total ?? 0;

  // Gatherer-style detail rows, per game. Only show what exists.
  const isMtg = current.game_id === 'mtg';
  const detail: [string, ReactNode][] = isMtg
    ? [
        ['Mana Cost', attrs.mana_cost ? <ManaText text={attrs.mana_cost} /> : null],
        ['Mana Value', attrs.cmc != null ? String(attrs.cmc) : null],
        ['Types', attrs.type_line ?? null],
        ['Card Text', attrs.oracle_text ? <span className="whitespace-pre-line"><ManaText text={attrs.oracle_text} /></span> : null],
        ['Flavor', attrs.flavor_text ? <span className="whitespace-pre-line italic text-neutral-400">{attrs.flavor_text}</span> : null],
        [attrs.loyalty ? 'Loyalty' : 'P/T', attrs.loyalty ?? (attrs.power != null ? `${attrs.power} / ${attrs.toughness}` : null)],
        ['Colour Identity', Array.isArray(attrs.color_identity) && attrs.color_identity.length ? attrs.color_identity.join('') : (isMtg ? 'Colourless' : null)],
        ['Keywords', Array.isArray(attrs.keywords) && attrs.keywords.length ? attrs.keywords.join(', ') : null],
      ]
    : [
        ['HP', attrs.hp ?? null],
        ['Types', Array.isArray(attrs.types) ? attrs.types.join(' · ') : null],
        ['Subtypes', Array.isArray(attrs.subtypes) ? attrs.subtypes.join(' · ') : null],
        ['Abilities', Array.isArray(attrs.abilities) && attrs.abilities.length
          ? <span className="whitespace-pre-line">{attrs.abilities.map((x: any) => `${x.name}: ${x.text}`).join('\n\n')}</span> : null],
        ['Attacks', Array.isArray(attrs.attacks) && attrs.attacks.length
          ? <span className="whitespace-pre-line">{attrs.attacks.map((x: any) => `${(x.cost ?? []).join('')} ${x.name}${x.damage ? ` — ${x.damage}` : ''}${x.text ? `\n${x.text}` : ''}`).join('\n\n')}</span> : null],
        ['Weakness', Array.isArray(attrs.weaknesses) ? attrs.weaknesses.map((w: any) => `${w.type} ${w.value}`).join(', ') : null],
        ['Resistance', Array.isArray(attrs.resistances) ? attrs.resistances.map((w: any) => `${w.type} ${w.value}`).join(', ') : null],
        ['Retreat', Array.isArray(attrs.retreatCost) ? String(attrs.retreatCost.length) : null],
        ['Rules', Array.isArray(attrs.rules) ? <span className="whitespace-pre-line">{attrs.rules.join('\n')}</span> : null],
        ['Flavor', attrs.flavorText ? <span className="italic text-neutral-400">{attrs.flavorText}</span> : null],
      ];

  return (
    <div>
      <div className="mb-1 text-sm text-neutral-400">
        <Link href={`/g/${current.game_id}`} className="hover:text-white">{isMtg ? 'Magic' : 'Pokémon'}</Link>
        {' · '}
        <Link href={`/set/${encodeURIComponent(current.set_id)}`} className="hover:text-white">{current.set_name}</Link>
      </div>
      <h1 className="mb-4 flex items-center gap-3 text-2xl font-bold">
        {current.name}
        {isMtg && attrs.mana_cost && <span className="text-2xl"><ManaText text={attrs.mana_cost} /></span>}
      </h1>

      {/* PRINTINGS FIRST — every version sharing this oracle identity */}
      <section className="mb-8">
        <h2 className="mb-3 border-b border-neutral-800 pb-1 text-lg font-semibold text-neutral-300">
          {printings.length} printing{printings.length > 1 ? 's' : ''}
        </h2>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
          {printings.map((p) => (
            <div key={p.id} className={`flex gap-1 ${p.id === current.id ? 'rounded-lg ring-2 ring-sky-500/60' : ''} ${p.owned ? '' : 'opacity-90'}`}>
              <div className="min-w-0 flex-1">
                <Link href={`/card/${encodeURIComponent(p.id)}`} className="block">
                  <VanillaCard card={{ name: p.name, imageSmall: p.image_small, owned: p.owned, forPlay: p.for_play, foil: p.set_foil > 0 }} />
                </Link>
                <div className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
                  {p.set_icon_url && <img src={p.set_icon_url} alt="" className={`h-4 w-4 ${isMtg ? 'invert' : ''}`} />}
                  <span className="uppercase">{p.set_code}</span>
                  <span className="text-neutral-600">#{p.collector_number}</span>
                  {p.usd != null && <span className="ml-auto">${p.usd.toFixed(2)}</span>}
                </div>
                <div className="truncate text-xs text-neutral-500">{p.set_name}</div>
              </div>
              {p.owned && (
                <OwnershipStrip counts={{ funcTotal: p.func_total, setNonfoil: p.set_nonfoil, setFoil: p.set_foil, deckNonfoil: p.deck_nonfoil, deckFoil: p.deck_foil }} setIconUrl={p.set_icon_url} game={current.game_id} />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* DETAIL: mockup + Gatherer table + functional summary */}
      <section className="flex flex-wrap gap-8">
        <div className="w-72 shrink-0">
          <MockCard faces={faces} />
        </div>

        <div className="min-w-0 flex-1">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            {detail.map(([label, value]) =>
              value == null || value === '' ? null : (
                <div key={label} className="contents">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</dt>
                  <dd className="text-neutral-200">{value}</dd>
                </div>
              ),
            )}
            <div className="contents">
              <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Rarity</dt>
              <dd className="text-neutral-200">{current.rarity_raw ?? '—'}</dd>
            </div>
            <div className="contents">
              <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Artist</dt>
              <dd className="text-neutral-200">{current.artist ?? '—'}</dd>
            </div>
            <div className="contents">
              <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Number</dt>
              <dd className="text-neutral-200">#{current.collector_number} · {current.set_name} ({current.released})</dd>
            </div>
          </dl>
        </div>

        {/* functional "you own" sidebar across all printings */}
        <aside className="w-[21rem] shrink-0 self-start rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 text-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">You own</div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-emerald-400">{funcTotal}</span>
            <span className="text-neutral-400">functional {funcTotal === 1 ? 'copy' : 'copies'}</span>
          </div>
          <ul className="mt-3 space-y-1 text-neutral-300">
            <li>{own.nf} nonfoil · <span className="text-amber-400">{own.foil} foil</span></li>
            <li>{own.printings} of {printings.length} printings owned</li>
            {funcTotal > 0 && <li className="text-neutral-400">counts as owned for play</li>}
          </ul>
        </aside>
      </section>
    </div>
  );
}

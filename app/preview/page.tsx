// Permanent dev/QA tool for iterating on MockCard's design against real catalogue data — the
// live app never renders MockCard against a card with real mana cost/rules text (the only
// production usage is /resolve's "Scanned as" panel, which is deliberately data-sparse), so
// there was no way to actually see e.g. mana symbols without a one-off throwaway page. This
// replaces that: pick any card by name, see MockCard next to the real image side by side.
import { cardToMockFaces } from '../components/cardToMockFaces.ts';
import MockCard from '../components/MockCard.tsx';
import { client } from '../../src/db/index.ts';

export const dynamic = 'force-dynamic';

const FIELDS = client`
  c.id, c.name, c.collector_number, c.rarity_raw, c.rarity_tier, c.image_small, c.image_large,
  c.set_id, c.game_id, c.artist, c.attrs, s.code as set_code, s.name as set_name,
  coalesce((select array_agg(f.value) from card_facets f where f.card_id = c.id and f.facet = 'color'), '{}') as colors`;

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const sp = await searchParams;
  const name = sp.name ?? 'Rafiq of the Many';

  const rows = await client`
    select ${FIELDS} from cards c join sets s on s.id = c.set_id
    where c.name ilike ${'%' + name + '%'} order by c.name limit 12`;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">MockCard preview</h1>
      <p className="mb-4 text-sm text-neutral-400">
        Search any card by name to see MockCard rendered next to the real image.
      </p>
      <form className="mb-6 flex gap-2">
        <input
          type="search"
          name="name"
          defaultValue={name}
          placeholder="card name…"
          className="w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
        <button className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800">Search</button>
      </form>

      <div className="flex flex-wrap gap-8">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-col items-center gap-2">
            <div className="text-sm text-neutral-400">{r.name} — {r.set_name}</div>
            <div className="flex items-start gap-4">
              <MockCard faces={cardToMockFaces(r as any)} />
              {r.image_small && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.image_small} alt={r.name} className="w-56 rounded-lg border border-neutral-700" />
              )}
            </div>
          </div>
        ))}
        {!rows.length && <p className="text-neutral-500">No cards matching "{name}".</p>}
      </div>
    </div>
  );
}

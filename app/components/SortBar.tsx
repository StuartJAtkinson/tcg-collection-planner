'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// Click a field: add it ascending, click again to flip descending. Right-click removes it.
// Click order is precedence order; the number badge shows it. Encoded in ?sort=name.a,rarity.d.
const FIELDS: [string, string][] = [
  ['name', 'Name'],
  ['set', 'Set'],
  ['number', 'Number'],
  ['rarity', 'Rarity'],
  ['mv', 'Mana'],
  ['color', 'Colour'],
];

type Term = { f: string; d: 'a' | 'd' };
const parse = (raw: string | null): Term[] =>
  (raw ?? '')
    .split(',')
    .filter(Boolean)
    .map((t) => {
      const [f, d] = t.split('.');
      return { f, d: d === 'd' ? 'd' : 'a' } as Term;
    });

export default function SortBar({ price = false }: { price?: boolean }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const terms = parse(sp.get('sort'));
  const fields = price ? [...FIELDS, ['price', 'Price'] as [string, string]] : FIELDS;

  const apply = (next: Term[]) => {
    const params = new URLSearchParams(sp.toString());
    if (next.length) params.set('sort', next.map((t) => `${t.f}.${t.d}`).join(','));
    else params.delete('sort');
    router.push(`${pathname}?${params}`);
  };
  const left = (f: string) => {
    const i = terms.findIndex((t) => t.f === f);
    apply(i < 0 ? [...terms, { f, d: 'a' }] : terms.map((t, j) => (j === i ? { ...t, d: t.d === 'a' ? 'd' : 'a' } : t)));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-neutral-500">Sort:</span>
      {fields.map(([f, label]) => {
        const i = terms.findIndex((t) => t.f === f);
        const on = i >= 0;
        return (
          <button
            key={f}
            onClick={() => left(f)}
            onContextMenu={(e) => {
              e.preventDefault();
              apply(terms.filter((t) => t.f !== f));
            }}
            title="Click: add / flip direction · Right-click: remove"
            className={`rounded-full border px-2 py-0.5 ${on ? 'border-emerald-500 bg-emerald-600/20 text-emerald-100' : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'}`}
          >
            {on && <span className="mr-1 text-emerald-400">{i + 1}</span>}
            {label}
            {on && <span className="ml-1">{terms[i].d === 'a' ? '↑' : '↓'}</span>}
          </button>
        );
      })}
    </div>
  );
}

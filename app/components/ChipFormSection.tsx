'use client';
import { useEffect, useState } from 'react';
import { CHIP_NEUTRAL, CHIP_PLUS } from './chip.ts';

// Standardized chip-row filter for surfaces that don't use the full FilterSidebar (the master
// Sets page, /binders and /search's game tabs). Each chip is a
// styled button — chips are NOT form inputs, so they never participate in form submission.
// The form posts one hidden input per field, carrying the joined/delimited current value,
// with the Apply button disabled while it equals the URL.
//
// Ponytail: this avoided an earlier duplicate-name bug where a server-side hidden and a live
// checkbox both had the same name — the form posted both, the first won, the page appeared
// to never change. Keeping the chips as <button type="button">s and the form-submitter as a
// single controlled hidden is the cleanest fix.

type Opt = { value: string; label: string; n?: number };
type Field = {
  name: string;
  kind: 'radio' | 'multi';
  options: Opt[];
  defaultValue?: string | string[];
  // Multi-select: sentinel value for "nothing checked" so the server can distinguish "user
  // toggled all off" from "user never visited this field". Defaults to 'none' if absent.
  uncheckedValue?: string;
  joiner?: string; // default ','
};

const joinMulti = (vals: Set<string>, joiner: string, sentinel: string) =>
  vals.size === 0 ? sentinel : [...vals].sort().join(joiner);
const initSet = (v: Field['defaultValue']): Set<string> =>
  new Set(Array.isArray(v) ? v : v ? [v] : []);

export default function ChipFormSection({
  action,
  fields,
  hidden,
  clearHref,
  className,
}: {
  action?: string;
  fields: Field[];
  // Foreign-to-the-form hidden params (e.g. `game` from /search). NEVER use a key that
  // matches `fields[].name` — collision with the per-field hidden below would cause the form
  // to post duplicate params and the page would never appear to change.
  hidden?: Record<string, string | undefined>;
  clearHref?: string;
  className: string;
}) {
  const [sel, setSel] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, initSet(f.defaultValue)])),
  );
  const [dirty, setDirty] = useState(false);

  const computeDirty = () => {
    if (typeof window === 'undefined') return false;
    const url = new URLSearchParams(window.location.search);
    for (const f of fields) {
      const want = url.get(f.name) ?? '';
      const cur = sel[f.name] ?? new Set();
      if (f.kind === 'radio') {
        const got = [...cur][0] ?? '';
        if (got !== want) return true;
      } else {
        const got = joinMulti(cur, f.joiner ?? ',', f.uncheckedValue ?? 'none');
        if (got !== want) return true;
      }
    }
    return false;
  };

  useEffect(() => {
    setDirty(computeDirty());
    const onPop = () => setDirty(computeDirty());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const toggleMulti = (name: string, value: string) =>
    setSel((prev) => {
      const next = new Set(prev[name]);
      next.has(value) ? next.delete(value) : next.add(value);
      return { ...prev, [name]: next };
    });
  const setRadio = (name: string, value: string) =>
    setSel((prev) => ({ ...prev, [name]: new Set([value]) }));

  return (
    <form method="get" action={action} className={className}>
      {hidden && Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {fields.map((f) => {
        const cur = sel[f.name] ?? new Set();
        const sentinel = f.uncheckedValue ?? 'none';
        const joiner = f.joiner ?? ',';
        const posted = f.kind === 'radio' ? ([...cur][0] ?? '') : joinMulti(cur, joiner, sentinel);
        return (
          <fieldset key={f.name} className="contents">
            <legend className="sr-only">{f.name}</legend>
            {/* The single submitter for this field. Reads from `sel`; the chips above are
                inert buttons so they never post anything. */}
            <input type="hidden" name={f.name} value={posted} />
            {f.options.map((o) => {
              const on = cur.has(o.value);
              return (
                <button
                  key={o.value || '(none)'}
                  type="button"
                  onClick={() =>
                    f.kind === 'radio' ? setRadio(f.name, o.value) : toggleMulti(f.name, o.value)
                  }
                  aria-pressed={f.kind === 'radio' ? on : undefined}
                  className={on ? CHIP_PLUS : CHIP_NEUTRAL}
                >
                  {o.label}
                  {o.n != null && o.n ? <span className="text-neutral-500"> {o.n}</span> : null}
                </button>
              );
            })}
          </fieldset>
        );
      })}
      <button
        type="submit"
        disabled={!dirty}
        className={CHIP_NEUTRAL}
      >
        Apply
      </button>
      {clearHref && (
        <a
          href={clearHref}
          className={CHIP_NEUTRAL}
        >
          Clear
        </a>
      )}
    </form>
  );
}
